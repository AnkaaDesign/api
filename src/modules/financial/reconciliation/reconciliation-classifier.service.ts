import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  BankTransactionSubtype,
  BankTransactionType,
  Prisma,
  ReconciliationSource,
  ReconciliationStatus,
  TransactionCategory,
  TransactionCategoryKind,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ReconciliationAliasService } from './reconciliation-alias.service';
import { TransactionCategoryService } from './transaction-category.service';
import { isMarketplaceMemo } from './marketplace';

// Counterparty CPF/CNPJ → transaction-category slug. Highest-priority rule:
// fires before alias lookup and memo regex. Use when counterparty identity
// alone determines the category regardless of how the bank formats the memo.
// Keys are digits-only.
//
// (DB-backed config table is the eventual home — see ReconciliationCategoryRule
// in the design notes — but the hardcoded set stays correct in the meantime.)
const COUNTERPARTY_CATEGORY_RULES: Readonly<Record<string, string>> = {
  // Owners — pró-labore draws.
  '06856214995': 'pro-labore', // Sergio Rodrigues
  '07332960923': 'pro-labore', // Genivaldo Rodrigues
  // Landlords — monthly rent PIX (paid to CPF, no NF-e to match against).
  '33034206968': 'aluguel', // Marcos Antonio Pelisson
  '70564949949': 'aluguel', // Sandro Furlan Bochi
};

interface CategoryRule {
  slug: string;
  pattern: RegExp;
}

// Ordered: most-specific patterns first.
const MEMO_RULES: readonly CategoryRule[] = [
  { slug: 'tarifa-bancaria', pattern: /^\s*tarifa\b/i },
  { slug: 'tarifa-bancaria', pattern: /^\s*manutencao\s+de\s+titulos/i },
  { slug: 'tributo', pattern: /^\s*debito\s+arrecadacao/i },
  { slug: 'tributo', pattern: /\bdarf\b/i },
  { slug: 'tributo', pattern: /\bgps\b/i },
  { slug: 'folha', pattern: /\bfolha\s+pagto\b/i },
  { slug: 'folha', pattern: /\bfolha\s+de\s+pagamento\b/i },
  { slug: 'transferencia', pattern: /aplic\.?\s*financ/i },
  { slug: 'transferencia', pattern: /\bcaptacao\b/i },
  { slug: 'transferencia', pattern: /aplic\s+fundos/i },
  { slug: 'transferencia', pattern: /resg\s+fundos/i },
  { slug: 'transferencia', pattern: /resg\.?\s*aplic/i },
  { slug: 'transferencia', pattern: /resgate\s+aplic/i },
  { slug: 'transferencia', pattern: /plano\s+int\s+capital/i },
  { slug: 'convenio', pattern: /^\s*debito\s+convenios/i },
  { slug: 'estorno', pattern: /^\s*devolucao\s+pix/i },
];

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
  reconciliationStatus: ReconciliationStatus;
}

/**
 * Pattern + alias driven classifier. Decides whether a transaction expects an
 * NF (→ scoring matcher) or carries a transaction-only category (Aluguel,
 * Folha, …) that resolves it on its own.
 *
 * Precedence:
 *   1. Counterparty CPF/CNPJ hardcoded rule.
 *   2. Alias hit with a learned category.
 *   3. Subtype=TARIFA fast path.
 *   4. Memo regex rules.
 *   5. Marketplace DEBIT → expects NF (value-only matcher pass).
 *   6. Fallthrough: expects NF when a counterparty CNPJ/CPF is present, else
 *      leave unclassified.
 *
 * Already-RECONCILED transactions are skipped — never undoes a confirmed match.
 */
@Injectable()
export class ReconciliationClassifierService {
  private readonly logger = new Logger(ReconciliationClassifierService.name);

  constructor(
    @Inject(forwardRef(() => PrismaService)) private readonly prisma: PrismaService,
    private readonly aliasService: ReconciliationAliasService,
    private readonly categories: TransactionCategoryService,
  ) {}

  /** Pure classification — no DB write. */
  async classify(tx: ClassifierInput): Promise<ClassificationResult> {
    // 1. Counterparty CPF/CNPJ hardcoded rules.
    if (tx.counterpartyCnpjCpf) {
      const digits = tx.counterpartyCnpjCpf.replace(/\D/g, '');
      const slug = COUNTERPARTY_CATEGORY_RULES[digits];
      if (slug) {
        const cat = await this.categories.resolveBySlug(slug);
        if (cat) return this.txOnly(cat, `Contraparte configurada (${digits})`);
      }
    }

    // 2. Alias lookup with a learned category.
    const alias = await this.aliasService.resolve(tx.memo, tx.type);
    if (alias?.categoryId) {
      const cat = (await this.categories.snapshot()).byId.get(alias.categoryId);
      if (cat) return this.txOnly(cat, `Alias confirmado (${alias.confirmedCount}x)`);
    }

    // 3. Subtype fast path.
    if (tx.subtype === BankTransactionSubtype.TARIFA) {
      const cat = await this.categories.resolveBySlug('tarifa-bancaria');
      if (cat) return this.txOnly(cat, 'Subtype TARIFA');
    }

    // 4. Memo regex rules.
    const memo = tx.memo ?? '';
    for (const rule of MEMO_RULES) {
      if (rule.pattern.test(memo)) {
        const cat = await this.categories.resolveBySlug(rule.slug);
        if (cat) return this.txOnly(cat, `Regra de memo: ${rule.pattern.source.slice(0, 40)}`);
      }
    }

    // 5. Marketplace DEBIT → expects NF (value-only matcher pass).
    if (tx.type === BankTransactionType.DEBIT && isMarketplaceMemo(tx.memo)) {
      return {
        expectsFiscalDocument: true,
        category: null,
        source: ReconciliationSource.AUTO,
        shouldReconcile: false,
        reason: 'Pagamento marketplace (conciliação por valor)',
      };
    }

    // 6. Fallthrough.
    if (tx.counterpartyCnpjCpf) {
      return {
        expectsFiscalDocument: true,
        category: null,
        source: ReconciliationSource.AUTO,
        shouldReconcile: false,
        reason: 'Default NF (contraparte identificada)',
      };
    }
    return {
      expectsFiscalDocument: false,
      category: null,
      source: ReconciliationSource.AUTO,
      shouldReconcile: false,
      reason: 'Sem padrão identificável',
    };
  }

  private txOnly(category: TransactionCategory, reason: string): ClassificationResult {
    return {
      expectsFiscalDocument: false,
      category,
      source: ReconciliationSource.AUTO,
      shouldReconcile: category.isResolving,
      reason,
    };
  }

  /**
   * Classify a single transaction and persist the result. Skips RECONCILED rows.
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
        reconciliationStatus: true,
        categorySource: true,
      },
    });
    if (!tx) return null;
    if (tx.reconciliationStatus === ReconciliationStatus.RECONCILED) return null;
    // Never let auto-classification overwrite a category the user set by hand.
    if (tx.categorySource === ReconciliationSource.MANUAL) return null;

    const result = await this.classify(tx);
    await this.applyResult(txId, result, prismaTx);
    return result;
  }

  /** Persists a classification result (expects-NF flag + transaction-only tag). */
  private async applyResult(
    txId: string,
    result: ClassificationResult,
    prismaTx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = prismaTx ?? this.prisma;
    await db.bankTransaction.update({
      where: { id: txId },
      data: {
        expectsFiscalDocument: result.expectsFiscalDocument,
        categorySource: ReconciliationSource.AUTO,
        classifiedAt: new Date(),
        ...(result.shouldReconcile
          ? {
              reconciliationStatus: ReconciliationStatus.RECONCILED,
              reconciliationSource: ReconciliationSource.AUTO,
            }
          : {}),
      },
    });

    // Reconcile the single AUTO transaction-only tag with the classification.
    await db.bankTransactionCategory.deleteMany({
      where: {
        transactionId: txId,
        source: ReconciliationSource.AUTO,
        category: { kind: TransactionCategoryKind.TRANSACTION_ONLY },
      },
    });
    if (result.category) {
      await db.bankTransactionCategory.upsert({
        where: {
          transactionId_categoryId: { transactionId: txId, categoryId: result.category.id },
        },
        create: {
          transactionId: txId,
          categoryId: result.category.id,
          source: ReconciliationSource.AUTO,
        },
        update: { source: ReconciliationSource.AUTO },
      });
    }
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
        reconciliationStatus: true,
        categorySource: true,
      },
    });

    const byCategory: Record<string, number> = {};
    let reconciled = 0;
    for (const tx of txs) {
      if (tx.reconciliationStatus === ReconciliationStatus.RECONCILED) continue;
      // Skip transactions the user manually categorized — auto must not stomp MANUAL.
      if (tx.categorySource === ReconciliationSource.MANUAL) continue;
      try {
        const result = await this.classify(tx);
        await this.applyResult(tx.id, result);
        const key = result.category?.slug ?? (result.expectsFiscalDocument ? 'nf' : 'unclassified');
        byCategory[key] = (byCategory[key] ?? 0) + 1;
        if (result.shouldReconcile) reconciled += 1;
      } catch (err) {
        this.logger.warn(`Failed to classify transaction ${tx.id}: ${err}`);
      }
    }
    return { processed: txs.length, reconciled, byCategory };
  }
}
