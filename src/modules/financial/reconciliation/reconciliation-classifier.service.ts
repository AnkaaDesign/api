import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  BankTransactionSubtype,
  BankTransactionType,
  Prisma,
  ReconciliationCategory,
  ReconciliationSource,
  ReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ReconciliationAliasService } from './reconciliation-alias.service';

// Transactions that aren't NF are *self-justifying* — the category itself is
// the reconciliation. Only NF requires a FiscalDocument match to count as
// resolved.
export const SELF_JUSTIFYING_CATEGORIES: ReadonlySet<ReconciliationCategory> = new Set([
  ReconciliationCategory.TRIBUTO,
  ReconciliationCategory.FOLHA,
  ReconciliationCategory.TRANSFERENCIA,
  ReconciliationCategory.TARIFA_BANCARIA,
  ReconciliationCategory.CONVENIO,
  ReconciliationCategory.PRO_LABORE,
  ReconciliationCategory.ALUGUEL,
  ReconciliationCategory.ESTORNO,
  ReconciliationCategory.OUTROS,
]);

// Counterparty CPF/CNPJ → category. Highest-priority rule in the classifier:
// fires before alias lookup and memo regex. Use this when the counterparty
// identity alone determines the category regardless of how the bank formats
// the memo. Keys are digits-only (no punctuation) — the classifier strips
// non-digits before lookup.
//
// Move to a DB-backed config table when the list outgrows ~20 entries or
// admins start needing to edit it from the UI.
const COUNTERPARTY_CATEGORY_RULES: Readonly<Record<string, ReconciliationCategory>> = {
  // Owners — pró-labore draws.
  '06856214995': ReconciliationCategory.PRO_LABORE, // Sergio Rodrigues
  '07332960923': ReconciliationCategory.PRO_LABORE, // Genivaldo Rodrigues
};

// Ordered: longest/most-specific patterns first so e.g. "MANUTENCAO DE TITULOS"
// catches before any generic OUTROS rule we might add later.
interface CategoryRule {
  category: ReconciliationCategory;
  pattern: RegExp;
}

const MEMO_RULES: readonly CategoryRule[] = [
  // TARIFA_BANCARIA — explicit fee memos. Subtype=TARIFA is a separate fast path.
  { category: ReconciliationCategory.TARIFA_BANCARIA, pattern: /^\s*tarifa\b/i },
  { category: ReconciliationCategory.TARIFA_BANCARIA, pattern: /^\s*manutencao\s+de\s+titulos/i },

  // TRIBUTO — DARF and arrecadação codes.
  { category: ReconciliationCategory.TRIBUTO, pattern: /^\s*debito\s+arrecadacao/i },
  { category: ReconciliationCategory.TRIBUTO, pattern: /\bdarf\b/i },
  { category: ReconciliationCategory.TRIBUTO, pattern: /\bgps\b/i },

  // FOLHA — payroll debits. Sicredi format is "DEB. FOLHA PAGTO-..." but be liberal.
  { category: ReconciliationCategory.FOLHA, pattern: /\bfolha\s+pagto\b/i },
  { category: ReconciliationCategory.FOLHA, pattern: /\bfolha\s+de\s+pagamento\b/i },

  // TRANSFERENCIA — investment in/out, internal account moves. Multiple memo
  // variants observed in Sicredi extracts.
  { category: ReconciliationCategory.TRANSFERENCIA, pattern: /aplic\.?\s*financ/i },
  { category: ReconciliationCategory.TRANSFERENCIA, pattern: /\bcaptacao\b/i },
  { category: ReconciliationCategory.TRANSFERENCIA, pattern: /aplic\s+fundos/i },
  { category: ReconciliationCategory.TRANSFERENCIA, pattern: /resg\s+fundos/i },
  { category: ReconciliationCategory.TRANSFERENCIA, pattern: /resg\.?\s*aplic/i },
  { category: ReconciliationCategory.TRANSFERENCIA, pattern: /resgate\s+aplic/i },
  { category: ReconciliationCategory.TRANSFERENCIA, pattern: /plano\s+int\s+capital/i },

  // CONVENIO — utility / convênio debits (SAMAE, COPEL, etc.).
  { category: ReconciliationCategory.CONVENIO, pattern: /^\s*debito\s+convenios/i },

  // ESTORNO — PIX devolutions / refunds.
  { category: ReconciliationCategory.ESTORNO, pattern: /^\s*devolucao\s+pix/i },
];

export interface ClassificationResult {
  category: ReconciliationCategory;
  source: ReconciliationSource;
  // True when the result implies a status change (RECONCILED for self-justifying
  // categories). Caller decides whether to flip the status — useful so the
  // service layer can apply the same rules for both fresh imports and reclassify.
  shouldReconcile: boolean;
  // Short reason string suitable for ignoredReason or notes.
  reason: string;
}

export interface ClassifierInput {
  id: string;
  type: BankTransactionType;
  subtype: BankTransactionSubtype;
  memo: string | null;
  counterpartyCnpjCpf: string | null;
  reconciliationStatus: ReconciliationStatus;
  category: ReconciliationCategory;
}

/**
 * Pattern + alias driven classifier. Tags each transaction with a category and,
 * for self-justifying categories (everything except NF/UNCLASSIFIED), flips the
 * status to RECONCILED so it stops polluting the unreconciled counter.
 *
 * Order of precedence:
 *   1. Alias hit with non-null category (PRO_LABORE / ALUGUEL / user-trained).
 *   2. Subtype=TARIFA fast path.
 *   3. Memo regex rules.
 *   4. Fallthrough: NF when there's a counterparty CNPJ/CPF, UNCLASSIFIED otherwise.
 *
 * Already-reconciled transactions are skipped — the classifier never undoes a
 * confirmed NF match.
 */
@Injectable()
export class ReconciliationClassifierService {
  private readonly logger = new Logger(ReconciliationClassifierService.name);

  constructor(
    @Inject(forwardRef(() => PrismaService)) private readonly prisma: PrismaService,
    private readonly aliasService: ReconciliationAliasService,
  ) {}

  /**
   * Pure classification — no DB write. Useful for previews and tests.
   */
  async classify(tx: ClassifierInput): Promise<ClassificationResult> {
    // 0. Counterparty CPF/CNPJ hardcoded rules (highest priority — admin
    // config that overrides aliases and memo regex). Sergio/Genivaldo pró-
    // labore lives here; landlords/recurring partners can be added the same way.
    if (tx.counterpartyCnpjCpf) {
      const digits = tx.counterpartyCnpjCpf.replace(/\D/g, '');
      const ruleCategory = COUNTERPARTY_CATEGORY_RULES[digits];
      if (ruleCategory) {
        return {
          category: ruleCategory,
          source: ReconciliationSource.AUTO,
          shouldReconcile: SELF_JUSTIFYING_CATEGORIES.has(ruleCategory),
          reason: `Contraparte configurada (${digits})`,
        };
      }
    }

    // 1. Alias lookup. resolve() handles the ambiguity guard and disabled rows.
    const alias = await this.aliasService.resolve(tx.memo, tx.type);
    if (alias?.category) {
      return {
        category: alias.category,
        source: ReconciliationSource.AUTO,
        shouldReconcile: SELF_JUSTIFYING_CATEGORIES.has(alias.category),
        reason: `Alias confirmado (${alias.confirmedCount}x)`,
      };
    }

    // 2. Subtype-driven fast path.
    if (tx.subtype === BankTransactionSubtype.TARIFA) {
      return {
        category: ReconciliationCategory.TARIFA_BANCARIA,
        source: ReconciliationSource.AUTO,
        shouldReconcile: true,
        reason: 'Subtype TARIFA',
      };
    }

    // 3. Memo regex rules.
    const memo = tx.memo ?? '';
    for (const rule of MEMO_RULES) {
      if (rule.pattern.test(memo)) {
        return {
          category: rule.category,
          source: ReconciliationSource.AUTO,
          shouldReconcile: SELF_JUSTIFYING_CATEGORIES.has(rule.category),
          reason: `Regra de memo: ${rule.pattern.source.slice(0, 40)}`,
        };
      }
    }

    // 4. Fallthrough: NF if we have a counterparty (matcher will try to link
    // against a FiscalDocument), UNCLASSIFIED otherwise.
    if (tx.counterpartyCnpjCpf) {
      return {
        category: ReconciliationCategory.NF,
        source: ReconciliationSource.AUTO,
        shouldReconcile: false,
        reason: 'Default NF (contraparte identificada)',
      };
    }
    return {
      category: ReconciliationCategory.UNCLASSIFIED,
      source: ReconciliationSource.AUTO,
      shouldReconcile: false,
      reason: 'Sem padrão identificável',
    };
  }

  /**
   * Classify a single transaction and persist the result. Returns the resolved
   * category. Skips transactions already RECONCILED — those are committed.
   */
  async classifyAndPersist(
    txId: string,
    prismaTx?: Prisma.TransactionClient,
  ): Promise<ReconciliationCategory | null> {
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
        category: true,
      },
    });
    if (!tx) return null;
    // Don't touch transactions already reconciled by a real NF/manual match.
    if (tx.reconciliationStatus === ReconciliationStatus.RECONCILED) return tx.category;

    const result = await this.classify(tx);

    await db.bankTransaction.update({
      where: { id: txId },
      data: {
        category: result.category,
        categorySource: result.source,
        classifiedAt: new Date(),
        ...(result.shouldReconcile
          ? {
              reconciliationStatus: ReconciliationStatus.RECONCILED,
              reconciliationSource: ReconciliationSource.AUTO,
            }
          : {}),
      },
    });

    return result.category;
  }

  /**
   * Classify every transaction matching the where clause. Used by the
   * "Reclassificar" admin action and for post-migration backfill.
   *
   * The where clause defaults to "still unclassified or still pending" so
   * already-decided rows are left alone.
   */
  async classifyBatch(
    where?: Prisma.BankTransactionWhereInput,
  ): Promise<{ processed: number; reconciled: number; byCategory: Record<string, number> }> {
    const filter: Prisma.BankTransactionWhereInput = where ?? {
      OR: [
        { category: ReconciliationCategory.UNCLASSIFIED },
        { reconciliationStatus: ReconciliationStatus.PENDING },
      ],
      // Never touch rows currently being held in PARTIAL/DISPUTED states.
      AND: [
        {
          reconciliationStatus: {
            in: [ReconciliationStatus.PENDING, ReconciliationStatus.RECONCILED],
          },
        },
      ],
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
        category: true,
      },
    });

    const byCategory: Record<string, number> = {};
    let reconciled = 0;

    for (const tx of txs) {
      if (tx.reconciliationStatus === ReconciliationStatus.RECONCILED) continue;
      const result = await this.classify(tx);
      try {
        await this.prisma.bankTransaction.update({
          where: { id: tx.id },
          data: {
            category: result.category,
            categorySource: result.source,
            classifiedAt: new Date(),
            ...(result.shouldReconcile
              ? {
                  reconciliationStatus: ReconciliationStatus.RECONCILED,
                  reconciliationSource: ReconciliationSource.AUTO,
                }
              : {}),
          },
        });
        byCategory[result.category] = (byCategory[result.category] ?? 0) + 1;
        if (result.shouldReconcile) reconciled += 1;
      } catch (err) {
        this.logger.warn(`Failed to classify transaction ${tx.id}: ${err}`);
      }
    }

    return { processed: txs.length, reconciled, byCategory };
  }
}
