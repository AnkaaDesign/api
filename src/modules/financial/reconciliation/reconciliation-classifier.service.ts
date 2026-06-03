import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  BankTransactionSubtype,
  BankTransactionType,
  Prisma,
  ReconciliationSource,
  ReconciliationStatus,
  TransactionCategory,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TransactionCategoryService } from './transaction-category.service';
import { CategoryFusionService } from './learning/category-fusion.service';
import { ClassifierSignalInput, DecisionTier, FusedDecision } from './learning/category-signal';

export interface ClassificationResult {
  // True → the scoring matcher should try to link a FiscalDocument (old "NF").
  expectsFiscalDocument: boolean;
  // Transaction-only category to assign (resolves the transaction), or null.
  category: TransactionCategory | null;
  source: ReconciliationSource;
  // True when assigning a resolving category — caller flips status to RECONCILED.
  shouldReconcile: boolean;
  reason: string;
}

export interface ClassifierInput {
  id: string;
  type: BankTransactionType;
  subtype: BankTransactionSubtype;
  memo: string | null;
  counterpartyCnpjCpf: string | null;
  counterpartyName?: string | null;
  amount?: number | Prisma.Decimal | null;
  reconciliationStatus: ReconciliationStatus;
}

/**
 * Thin entry point over the {@link CategoryFusionService}. Builds a signal input
 * from a transaction, asks the fusion engine for a decision, and (for the
 * persist paths) applies it. The actual precedence/learning lives in the
 * learners + fusion spine; this service only adapts to the legacy
 * ClassificationResult shape and preserves the MANUAL/RECONCILED skip guards.
 */
@Injectable()
export class ReconciliationClassifierService {
  private readonly logger = new Logger(ReconciliationClassifierService.name);

  constructor(
    @Inject(forwardRef(() => PrismaService)) private readonly prisma: PrismaService,
    private readonly categories: TransactionCategoryService,
    private readonly fusion: CategoryFusionService,
  ) {}

  private toSignalInput(tx: ClassifierInput): ClassifierSignalInput {
    return {
      id: tx.id,
      type: tx.type,
      subtype: tx.subtype,
      memo: tx.memo ?? null,
      counterpartyCnpjCpf: tx.counterpartyCnpjCpf ?? null,
      counterpartyName: tx.counterpartyName ?? null,
      amount: tx.amount != null ? Number(tx.amount) : 0,
      reconciliationStatus: tx.reconciliationStatus,
    };
  }

  private async toResult(decision: FusedDecision): Promise<ClassificationResult> {
    let category: TransactionCategory | null = null;
    if (decision.tier === DecisionTier.AUTO_APPLY && decision.categoryId) {
      category = (await this.categories.snapshot()).byId.get(decision.categoryId) ?? null;
    }
    return {
      expectsFiscalDocument: decision.expectsFiscalDocument,
      category,
      source: ReconciliationSource.AUTO,
      shouldReconcile: decision.shouldReconcile,
      reason: decision.reason,
    };
  }

  /** Pure classification — no DB write. */
  async classify(tx: ClassifierInput): Promise<ClassificationResult> {
    const decision = await this.fusion.classify(this.toSignalInput(tx));
    return this.toResult(decision);
  }

  /**
   * Classify a single transaction and persist the result. Skips RECONCILED and
   * MANUAL rows — never undoes a confirmed match nor stomps a hand-set category.
   */
  async classifyAndPersist(
    txId: string,
    prismaTx?: Prisma.TransactionClient,
  ): Promise<ClassificationResult | null> {
    const db = prismaTx ?? this.prisma;
    const tx = await db.bankTransaction.findUnique({
      where: { id: txId },
      select: {
        id: true,
        type: true,
        subtype: true,
        memo: true,
        counterpartyCnpjCpf: true,
        counterpartyName: true,
        amount: true,
        reconciliationStatus: true,
        categorySource: true,
      },
    });
    if (!tx) return null;
    if (tx.reconciliationStatus === ReconciliationStatus.RECONCILED) return null;
    if (tx.categorySource === ReconciliationSource.MANUAL) return null;

    const decision = await this.fusion.classify(this.toSignalInput(tx));
    await this.fusion.applyDecision(txId, decision, prismaTx);
    return this.toResult(decision);
  }

  /**
   * Classify every transaction matching the where clause. Defaults to the
   * not-yet-classified / still-pending safe set.
   */
  async classifyBatch(
    where?: Prisma.BankTransactionWhereInput,
  ): Promise<{ processed: number; reconciled: number; byCategory: Record<string, number> }> {
    const filter: Prisma.BankTransactionWhereInput = where ?? {
      OR: [{ classifiedAt: null }, { reconciliationStatus: ReconciliationStatus.PENDING }],
      reconciliationStatus: {
        in: [ReconciliationStatus.PENDING, ReconciliationStatus.RECONCILED],
      },
    };

    const txs = await this.prisma.bankTransaction.findMany({
      where: filter,
      select: {
        id: true,
        type: true,
        subtype: true,
        memo: true,
        counterpartyCnpjCpf: true,
        counterpartyName: true,
        amount: true,
        reconciliationStatus: true,
        categorySource: true,
      },
    });

    const byCategory: Record<string, number> = {};
    let reconciled = 0;
    for (const tx of txs) {
      if (tx.reconciliationStatus === ReconciliationStatus.RECONCILED) continue;
      if (tx.categorySource === ReconciliationSource.MANUAL) continue;
      try {
        const decision = await this.fusion.classify(this.toSignalInput(tx));
        await this.fusion.applyDecision(tx.id, decision);
        const key = await this.tallyKey(decision);
        byCategory[key] = (byCategory[key] ?? 0) + 1;
        if (decision.shouldReconcile) reconciled += 1;
      } catch (err) {
        this.logger.warn(`Failed to classify transaction ${tx.id}: ${err}`);
      }
    }
    return { processed: txs.length, reconciled, byCategory };
  }

  private async tallyKey(decision: FusedDecision): Promise<string> {
    if (decision.tier === DecisionTier.SUGGEST) return 'suggest';
    if (decision.tier === DecisionTier.AUTO_APPLY && decision.categoryId) {
      const cat = (await this.categories.snapshot()).byId.get(decision.categoryId);
      return cat?.slug ?? 'auto';
    }
    return decision.expectsFiscalDocument ? 'nf' : 'unclassified';
  }
}
