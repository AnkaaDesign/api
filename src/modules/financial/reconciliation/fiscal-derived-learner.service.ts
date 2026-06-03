import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { LearnedRuleSource, Prisma, TransactionCategoryKind } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { RecurrenceLearnerService } from './recurrence-learner.service';
import { memoFingerprint } from './text-normalization';
import {
  CategoryLearner,
  CategorySignal,
  ClassifierSignalInput,
  LearningSource,
} from './learning/category-signal';

/**
 * NF-emitter / NF-line-derived learner.
 *
 * Two distinct learned signals live here:
 *  - {@link LearningSource.NF_EMITTER}: a prior "this emitter CNPJ resolves to
 *    category X", learned from confirmed matches (NOT from a single unmatched
 *    tx). It can resolve a transaction if the category is TRANSACTION_ONLY.
 *  - {@link LearningSource.NF_LINE_DERIVED}: enrichment derived from the
 *    fiscal document's line categories. NEVER resolving — suggestion only.
 *
 * All public hooks are best-effort and MUST NOT throw.
 */

/** Below this purity (top net / total net) an emitter prior is too noisy to trust. */
const MIN_PRIOR_PURITY = 0.6;
/** Top category must beat a different runner-up by at least this ratio to be unambiguous. */
const AMBIGUITY_GUARD_RATIO = 2;

/** Aggregated per-category line evidence for one fiscal document. */
export interface LineCategoryAgg {
  categoryId: string;
  kind: TransactionCategoryKind;
  /** Share of the document's line value carried by this category, 0..1. */
  lineValueShare: number;
  /** Classifier confidence for the category, 0..100. */
  confidence: number;
}

/** Strip everything but digits. */
function cnpjDigits(v: string | null | undefined): string | null {
  if (!v) return null;
  const digits = String(v).replace(/\D+/g, '');
  return digits.length > 0 ? digits : null;
}

/** Root (first 8 digits) of a 14-digit CNPJ, else null. */
function cnpjRoot(v: string | null | undefined): string | null {
  const digits = cnpjDigits(v);
  if (!digits || digits.length !== 14) return null;
  return digits.slice(0, 8);
}

@Injectable()
export class FiscalDerivedLearnerService implements CategoryLearner {
  private readonly logger = new Logger(FiscalDerivedLearnerService.name);

  readonly source = LearningSource.NF_EMITTER;

  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prisma: PrismaService,
    private readonly recurrence: RecurrenceLearnerService,
  ) {}

  /**
   * One match-completion entry point used by BOTH the manual and auto match
   * paths. Reads the transaction's resulting category tags + matched documents
   * from the DB (so it stays decoupled from the item-category classifier's
   * internals), reinforces the emitter priors, and records a recurrence
   * observation per category. Best-effort — never throws into the match action.
   */
  async learnFromTransaction(
    transactionId: string,
    opts: { manual: boolean },
  ): Promise<void> {
    try {
      const tx = await this.prisma.bankTransaction.findUnique({
        where: { id: transactionId },
        select: {
          id: true,
          counterpartyCnpjCpf: true,
          counterpartyName: true,
          ownerCnpj: true,
          postedAt: true,
          amount: true,
          memo: true,
        },
      });
      if (!tx) return;

      const matches = await this.prisma.reconciliationMatch.findMany({
        where: { transactionId, reversedAt: null, fiscalDocumentId: { not: null } },
        select: {
          fiscalDocument: { select: { emitCnpj: true, destCnpj: true, destCpf: true } },
        },
      });
      const docs = matches
        .map(m => m.fiscalDocument)
        .filter((d): d is { emitCnpj: string; destCnpj: string | null; destCpf: string | null } =>
          Boolean(d),
        );

      const tags = await this.prisma.bankTransactionCategory.findMany({
        where: { transactionId },
        select: {
          categoryId: true,
          confidence: true,
          allocatedAmount: true,
          category: { select: { kind: true } },
        },
      });
      const total =
        tags.reduce((acc, t) => acc + Math.abs(Number(t.allocatedAmount ?? 0)), 0) ||
        Math.abs(Number(tx.amount)) ||
        1;
      const lineCategories: LineCategoryAgg[] = tags.map(t => ({
        categoryId: t.categoryId,
        kind: t.category.kind,
        lineValueShare: Math.abs(Number(t.allocatedAmount ?? 0)) / total,
        confidence: t.confidence ?? 0,
      }));

      if (docs.length > 0) {
        await this.learnFromMatch(
          { id: tx.id, counterpartyCnpjCpf: tx.counterpartyCnpjCpf, ownerCnpj: tx.ownerCnpj },
          docs,
          lineCategories,
          opts,
        );
      }

      const key = cnpjDigits(tx.counterpartyCnpjCpf) ?? memoFingerprint(tx.memo);
      if (key) {
        for (const lc of lineCategories) {
          await this.recurrence.recordCadence({
            counterpartyKey: key,
            counterpartyLabel: tx.counterpartyName,
            categoryId: lc.categoryId,
            transactionId: tx.id,
            occurredAt: tx.postedAt,
            amount: Number(tx.amount),
          });
        }
      }
    } catch (err) {
      this.logger.warn(`learnFromTransaction failed: ${(err as Error)?.message ?? err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Learning from confirmed matches
  // ---------------------------------------------------------------------------

  /**
   * Reinforce emitter priors from a confirmed bank-tx ↔ fiscal-doc match.
   * For each fiscal document we take the dominant line category and, if it is
   * strong enough, record a prior keyed by the emitter CNPJ.
   */
  async learnFromMatch(
    tx: { id: string; counterpartyCnpjCpf: string | null; ownerCnpj: string | null },
    fiscalDocs: Array<{ emitCnpj: string; destCnpj?: string | null; destCpf?: string | null }>,
    lineCategories: LineCategoryAgg[],
    opts: { manual: boolean },
    prismaTx?: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      const db = prismaTx ?? this.prisma;

      // Dominant line category across the match (max line-value share).
      let dominant: LineCategoryAgg | null = null;
      for (const lc of lineCategories) {
        if (!dominant || lc.lineValueShare > dominant.lineValueShare) {
          dominant = lc;
        }
      }

      for (const doc of fiscalDocs) {
        const emitter = cnpjDigits(doc.emitCnpj);
        if (!emitter) continue;
        const root = cnpjRoot(doc.emitCnpj);

        if (
          dominant &&
          dominant.lineValueShare >= 0.7 &&
          dominant.confidence >= 75
        ) {
          await this.recordPrior(db, {
            emitter,
            root,
            categoryId: dominant.categoryId,
            kind: dominant.kind,
            source: opts.manual ? LearnedRuleSource.MANUAL : LearnedRuleSource.AUTO,
          });
        }

        // A manual confirmation also pins every TRANSACTION_ONLY line category
        // for this emitter (those are the categories that actually resolve a tx).
        if (opts.manual) {
          for (const lc of lineCategories) {
            if (lc.kind !== TransactionCategoryKind.TRANSACTION_ONLY) continue;
            await this.recordPrior(db, {
              emitter,
              root,
              categoryId: lc.categoryId,
              kind: lc.kind,
              source: LearnedRuleSource.MANUAL,
            });
          }
        }
      }
    } catch (err) {
      this.logger.warn(`learnFromMatch failed: ${(err as Error)?.message ?? err}`);
    }
  }

  /** Upsert + reinforce a single emitter→category prior. */
  private async recordPrior(
    db: Prisma.TransactionClient | PrismaService,
    args: {
      emitter: string;
      root: string | null;
      categoryId: string;
      kind: TransactionCategoryKind;
      source: LearnedRuleSource;
    },
  ): Promise<void> {
    const isManual = args.source === LearnedRuleSource.MANUAL;
    const now = new Date();

    await db.emitterCategoryPrior.upsert({
      where: {
        emitterCnpj_categoryId: {
          emitterCnpj: args.emitter,
          categoryId: args.categoryId,
        },
      },
      create: {
        emitterCnpj: args.emitter,
        emitterRoot: args.root ?? args.emitter.slice(0, 8),
        categoryId: args.categoryId,
        categoryKind: args.kind,
        source: args.source,
        confirmedCount: 1,
        rejectedCount: 0,
        firstObservedAt: now,
        lastConfirmedAt: now,
      },
      update: {
        confirmedCount: { increment: 1 },
        lastConfirmedAt: now,
        categoryKind: args.kind,
        ...(isManual
          ? {
              source: LearnedRuleSource.MANUAL,
              disabledAt: null,
              rejectedCount: 0,
            }
          : {}),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Prediction
  // ---------------------------------------------------------------------------

  /** Predict a category for an emitter (the unmatched tx's counterparty). */
  async predictCategory(emitterCnpj: string | null): Promise<CategorySignal | null> {
    const emitter = cnpjDigits(emitterCnpj);
    if (!emitter) return null;

    let rows = await this.prisma.emitterCategoryPrior.findMany({
      where: { emitterCnpj: emitter, disabledAt: null },
    });

    let matchedByRoot = false;
    const root = cnpjRoot(emitter);
    if (rows.length === 0 && root) {
      rows = await this.prisma.emitterCategoryPrior.findMany({
        where: { emitterRoot: root, disabledAt: null },
      });
      matchedByRoot = true;
    }

    if (rows.length === 0) return null;

    // Net positive evidence per row.
    const scored = rows
      .map((r) => ({
        row: r,
        net: Math.max(0, r.confirmedCount - r.rejectedCount),
      }))
      .sort((a, b) => b.net - a.net);

    const top = scored[0];
    const totalNet = scored.reduce((acc, s) => acc + s.net, 0);
    if (totalNet <= 0 || top.net <= 0) return null;

    // Ambiguity guard: a runner-up of a DIFFERENT category must be clearly weaker.
    const runnerUp = scored.find((s) => s.row.categoryId !== top.row.categoryId);
    if (runnerUp && runnerUp.net > 0 && top.net < runnerUp.net * AMBIGUITY_GUARD_RATIO) {
      return null;
    }

    const purity = top.net / totalNet;
    if (purity < MIN_PRIOR_PURITY) return null;

    const sampleFactor = Math.min(1, top.net / 5);
    const rootPenalty = matchedByRoot ? 0.85 : 1;
    const confidence = Math.min(0.92, purity * sampleFactor * rootPenalty);

    const resolving = top.row.categoryKind === TransactionCategoryKind.TRANSACTION_ONLY;

    return {
      source: LearningSource.NF_EMITTER,
      categoryId: top.row.categoryId,
      counterpartyCnpjCpf: emitter,
      confidence,
      provenance: `emitter prior ${matchedByRoot ? '(root)' : '(exact)'} purity=${purity.toFixed(2)} net=${top.net}`,
      expectsFiscalDocument: !resolving,
      ruleRef: top.row.id,
    };
  }

  // ---------------------------------------------------------------------------
  // CategoryLearner interface
  // ---------------------------------------------------------------------------

  async collect(tx: ClassifierSignalInput): Promise<CategorySignal[]> {
    try {
      // For an unmatched bank tx, the emitter we have learned about is the
      // counterparty CNPJ.
      const sig = await this.predictCategory(tx.counterpartyCnpjCpf);
      return sig ? [sig] : [];
    } catch (err) {
      this.logger.warn(`collect failed: ${(err as Error)?.message ?? err}`);
      return [];
    }
  }

  /**
   * Build the enrichment signal derived from a fiscal document's line
   * categories. NEVER resolving — it only suggests a category.
   */
  buildLineDerivedSignal(lineCategories: LineCategoryAgg[]): CategorySignal | null {
    let top: LineCategoryAgg | null = null;
    for (const lc of lineCategories) {
      if (!top || lc.lineValueShare > top.lineValueShare) {
        top = lc;
      }
    }
    if (!top) return null;
    if (top.lineValueShare < 0.7 || top.confidence < 75) return null;

    const confidence = Math.min(0.9, (top.confidence / 100) * top.lineValueShare);

    return {
      source: LearningSource.NF_LINE_DERIVED,
      categoryId: top.categoryId,
      confidence,
      provenance: `nf line-derived share=${top.lineValueShare.toFixed(2)} conf=${top.confidence}`,
    };
  }

  async recordReversal(tx: ClassifierSignalInput, signal: CategorySignal): Promise<void> {
    try {
      const emitter = cnpjDigits(tx.counterpartyCnpjCpf);
      if (!signal.categoryId || !emitter) return;

      const row = await this.prisma.emitterCategoryPrior.findUnique({
        where: {
          emitterCnpj_categoryId: {
            emitterCnpj: emitter,
            categoryId: signal.categoryId,
          },
        },
      });
      if (!row) return;

      const nextRejected = row.rejectedCount + 1;
      const shouldDisable =
        row.source !== LearnedRuleSource.MANUAL &&
        nextRejected >= 2 &&
        nextRejected > row.confirmedCount;

      await this.prisma.emitterCategoryPrior.update({
        where: { id: row.id },
        data: {
          rejectedCount: nextRejected,
          ...(shouldDisable ? { disabledAt: new Date() } : {}),
        },
      });
    } catch (err) {
      this.logger.warn(`recordReversal failed: ${(err as Error)?.message ?? err}`);
    }
  }

  async recordConfirmation(tx: ClassifierSignalInput, categoryId: string): Promise<void> {
    // No-op: emitter priors are learned from confirmed bank-tx ↔ NF matches
    // (see learnFromMatch), not from a single confirmed transaction which
    // carries no fiscal document. Confirmation reinforcement flows through
    // learnFromMatch instead. Kept as a best-effort empty body.
    return;
  }
}
