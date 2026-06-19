import { Injectable, Logger } from '@nestjs/common';
import { BankTransactionSubtype, BankTransactionType } from '@prisma/client';
import { ReconciliationAliasService } from '../reconciliation-alias.service';
import { TransactionCategoryService } from '../transaction-category.service';
import { isMarketplaceMemo } from '../marketplace';
import {
  CategoryLearner,
  CategorySignal,
  ClassifierSignalInput,
  LearningSource,
} from './category-signal';

// Counterparty CPF/CNPJ → transaction-category slug. Day-one fallback that fires
// before any learning has accumulated; once the CounterpartyLearningService is
// seeded (ADMIN_SEEDED) the two simply agree. Keys are digits-only.
const COUNTERPARTY_CATEGORY_RULES: Readonly<Record<string, string>> = {
  '06856214995': 'pro-labore', // Sergio Rodrigues
  '07332960923': 'pro-labore', // Genivaldo Rodrigues
  '33034206968': 'aluguel', // Marcos Antonio Pelisson
  '70564949949': 'aluguel', // Sandro Furlan Bochi
  '04368898000106': 'energia-eletrica', // COPEL DISTRIBUICAO
  '78079639000100': 'agua', // SAMAE IBIPORA
  '40432544000147': 'internet-telefone', // CLARO MOVEL
  '08890343000180': 'internet-telefone', // PRTURBO INTERNET WIRELESS LTDA
};

interface MemoRule {
  slug: string;
  pattern: RegExp;
  // Restrict a rule to one money-flow direction. Outflow-semantic rules
  // (tarifa/tributo/folha) must NOT fire on a CREDIT; income rules
  // (rendimento/juros) must NOT fire on a DEBIT. Omit for direction-neutral.
  direction?: BankTransactionType;
}

// Ordered: most-specific patterns first.
const MEMO_RULES: readonly MemoRule[] = [
  { slug: 'tarifa-bancaria', pattern: /^\s*tarifa\b/i, direction: BankTransactionType.DEBIT },
  { slug: 'tarifa-bancaria', pattern: /^\s*manutencao\s+de\s+titulos/i, direction: BankTransactionType.DEBIT },
  { slug: 'tributo', pattern: /^\s*debito\s+arrecadacao/i, direction: BankTransactionType.DEBIT },
  { slug: 'tributo', pattern: /\bdarf\b/i, direction: BankTransactionType.DEBIT },
  { slug: 'tributo', pattern: /\bgps\b/i, direction: BankTransactionType.DEBIT },
  { slug: 'folha', pattern: /\bfolha\s+pagto\b/i, direction: BankTransactionType.DEBIT },
  { slug: 'folha', pattern: /\bfolha\s+de\s+pagamento\b/i, direction: BankTransactionType.DEBIT },
  // Investment in/out and refunds are direction-neutral (resgate is a CREDIT,
  // aplicação a DEBIT — same "transferência" category either way).
  { slug: 'transferencia', pattern: /aplic\.?\s*financ/i },
  { slug: 'transferencia', pattern: /\bcaptacao\b/i },
  { slug: 'transferencia', pattern: /aplic\s+fundos/i },
  { slug: 'transferencia', pattern: /resg\s+fundos/i },
  { slug: 'transferencia', pattern: /resg\.?\s*aplic/i },
  { slug: 'transferencia', pattern: /resgate\s+aplic/i },
  { slug: 'transferencia', pattern: /plano\s+int\s+capital/i },
  { slug: 'estorno', pattern: /^\s*devolucao\s+pix/i },
  // ENTRADA income: bank yield / interest credited (never a payable).
  { slug: 'rendimentos', pattern: /\brendimento/i, direction: BankTransactionType.CREDIT },
  { slug: 'rendimentos', pattern: /\bjuros\b/i, direction: BankTransactionType.CREDIT },
];

/**
 * Re-expresses the legacy precedence ladder (hardcoded counterparty rules,
 * memo-alias, TARIFA subtype, memo regexes, marketplace) as CategorySignals so
 * the fusion engine reproduces today's behavior on day one and the new learners
 * layer evidence on top without touching classify().
 *
 * Its nominal `source` is ALIAS (used by the fusion reversal-routing map); the
 * signals it emits carry their own per-source provenance.
 */
@Injectable()
export class LadderLearner implements CategoryLearner {
  readonly source = LearningSource.ALIAS;
  private readonly logger = new Logger(LadderLearner.name);

  constructor(
    private readonly aliasService: ReconciliationAliasService,
    private readonly categories: TransactionCategoryService,
  ) {}

  async collect(tx: ClassifierSignalInput): Promise<CategorySignal[]> {
    const out: CategorySignal[] = [];
    try {
      const snap = await this.categories.snapshot();

      // 1. Counterparty CPF/CNPJ hardcoded rule. DEBIT-only: every entry maps to
      // an outflow payee (pró-labore, aluguel, energia, água, internet), so it
      // must never categorize an incoming credit from the same counterparty.
      if (tx.type === BankTransactionType.DEBIT && tx.counterpartyCnpjCpf) {
        const digits = tx.counterpartyCnpjCpf.replace(/\D/g, '');
        const slug = COUNTERPARTY_CATEGORY_RULES[digits];
        if (slug) {
          const cat = snap.bySlug.get(slug);
          if (cat) {
            out.push({
              source: LearningSource.COUNTERPARTY_HARDCODE,
              categoryId: cat.id,
              counterpartyCnpjCpf: digits,
              confidence: 1.0,
              provenance: `Contraparte configurada (${digits})`,
            });
          }
        }
      }

      // 2. Memo-alias with a learned category.
      const alias = await this.aliasService.resolve(tx.memo, tx.type);
      if (alias?.categoryId) {
        const cat = snap.byId.get(alias.categoryId);
        if (cat) {
          out.push({
            source: LearningSource.ALIAS,
            categoryId: cat.id,
            counterpartyCnpjCpf: alias.counterpartyCnpjCpf,
            confidence: this.aliasService.aliasConfidence(alias),
            provenance: `Alias confirmado (${alias.confirmedCount}x)`,
            ruleRef: alias.id,
          });
        }
      }

      // 3. Subtype fast path (income/fee subtypes resolve to a category).
      const subtypeSlug =
        tx.subtype === BankTransactionSubtype.TARIFA
          ? 'tarifa-bancaria'
          : tx.subtype === BankTransactionSubtype.RENDIMENTO
            ? 'rendimentos'
            : tx.subtype === BankTransactionSubtype.ESTORNO
              ? 'estorno'
              : null;
      if (subtypeSlug) {
        const cat = snap.bySlug.get(subtypeSlug);
        if (cat) {
          out.push({
            source: LearningSource.SUBTYPE,
            categoryId: cat.id,
            confidence: 1.0,
            provenance: `Subtype ${tx.subtype}`,
          });
        }
      }

      // 4. Memo regex rules (first match wins), honoring the rule's direction.
      const memo = tx.memo ?? '';
      for (const rule of MEMO_RULES) {
        if (rule.direction && rule.direction !== tx.type) continue;
        if (rule.pattern.test(memo)) {
          const cat = snap.bySlug.get(rule.slug);
          if (cat) {
            out.push({
              source: LearningSource.MEMO_REGEX,
              categoryId: cat.id,
              confidence: 1.0,
              provenance: `Regra de memo: ${rule.pattern.source.slice(0, 40)}`,
            });
          }
          break;
        }
      }

      // 5. Marketplace DEBIT → expects NF (value-only matcher pass).
      if (tx.type === BankTransactionType.DEBIT && isMarketplaceMemo(tx.memo)) {
        out.push({
          source: LearningSource.MARKETPLACE,
          confidence: 0.6,
          expectsFiscalDocument: true,
          provenance: 'Pagamento marketplace (conciliação por valor)',
        });
      }
    } catch (err) {
      this.logger.warn(`LadderLearner.collect failed for ${tx.id}: ${err}`);
    }
    return out;
  }

  async recordReversal(tx: ClassifierSignalInput, signal: CategorySignal): Promise<void> {
    // Only the alias tier is learnable; the rest are static code rules (no-op).
    if (signal.source !== LearningSource.ALIAS) return;
    const counterparty = signal.counterpartyCnpjCpf;
    if (!counterparty) return;
    try {
      await this.aliasService.recordReversal({
        memo: tx.memo,
        txType: tx.type as BankTransactionType,
        counterpartyCnpjCpf: counterparty,
      });
    } catch (err) {
      this.logger.warn(`LadderLearner.recordReversal failed: ${err}`);
    }
  }

  async recordConfirmation(): Promise<void> {
    // Alias confirmations are captured by the match/categorize write paths; the
    // static ladder rules don't learn. No-op.
  }
}
