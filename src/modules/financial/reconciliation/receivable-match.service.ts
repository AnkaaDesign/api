import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FiscalDocumentOperation,
  FiscalDocumentType,
  Prisma,
  ReconciliationMatchType,
  ReconciliationSource,
  ReconciliationStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TaskQuoteStatusCascadeService } from '@modules/production/task-quote/task-quote-status-cascade.service';
import { nameSimilarity } from './text-normalization';
import { RECON_ADVISORY_LOCK_KEY } from './reconciliation-matcher.service';

/** How far apart (days) a credit's postedAt and an installment's dueDate may be
 *  for an automatic receivable match. Wider than the boleto bridge — non-boleto
 *  receipts (PIX/TED) are paid early or late far more loosely than boletos. */
const RECEIVABLE_WINDOW_DAYS = 20;
const AMOUNT_TOLERANCE = 0.05;

/** Auto-match boundary (0-100 confidence), mirroring the saída NF matcher's
 *  threshold + runner-up gap discipline. A UNIQUE exact-value candidate always
 *  auto-matches (value+date is already strong); when several exact-value
 *  candidates compete, the winner must clear the bar AND beat the runner-up by
 *  the gap (disambiguated by counterparty CNPJ/name + date proximity). */
const AUTO_SCORE_THRESHOLD = 80;
const AUTO_RUNNER_UP_GAP = 15;

// ---------------------------------------------------------------------------
// Identity-first matching (the dominant real-world pattern in this DB).
//
// Empirically, the value-first scan finds ZERO candidates for ~100% of pending
// credits, because: receivables are overwhelmingly boletos OR already marked
// PAID before the OFX arrives, and B2B customers pay many invoices in one PIX
// (a lump sum that equals no single installment). So we resolve WHO paid first
// (CNPJ in the PIX memo, or a fuzzy name hit on the customer), then reconcile
// the credit WITHIN that customer's receivables — open AND recently-paid
// (link-only clearance), single AND batch (pay-all / subset-sum).
// ---------------------------------------------------------------------------

/** Counterparty name similarity (0-1) to AUTO-resolve a single paying customer.
 *  nameSimilarity already strips OFX prefixes (PIX_CRED) + legal forms (LTDA),
 *  so a clean hit is trustworthy; a runner-up above MIN makes it ambiguous. */
const NAME_AUTO_SIM = 0.85;
const NAME_RUNNERUP_SIM = 0.6;
/** Minimum similarity for a customer to be offered as a SUGGESTION (manual UI). */
const NAME_SUGGEST_SIM = 0.45;

/** Aggregate amount tolerance for a single OR batch match: a flat floor (bank
 *  fees / centavo drift) OR a fraction of the credit, whichever is larger. */
const MATCH_ABS_TOLERANCE = 2;
const MATCH_PCT_TOLERANCE = 0.005;

/** When LINKING a credit to an already-PAID installment (clearance without
 *  re-settling), the installment must have been paid within this window of the
 *  credit, so a historical lookback can never link an ancient receipt to a new
 *  credit (or vice-versa). */
const PAID_LINK_WINDOW_DAYS = 45;

/** Subset-sum is bounded: above this many matchable installments we only try the
 *  cheap "pay-all / windowed-all" sums and otherwise defer to the manual UI,
 *  rather than exploring 2^N subsets. Covers the real "paid their whole balance"
 *  pattern at O(1) and small partial batches at O(2^N). */
const SUBSET_SUM_MAX_ITEMS = 14;

/** Open installment statuses an incoming receipt may settle. */
const OPEN_INSTALLMENT_STATUSES = ['PENDING', 'PROCESSING', 'OVERDUE'] as const;

/** Date window (days) for the boleto-slip allocation: how far a collection
 *  credit's postedAt and a PAID slip's paidAt may drift (settlement lag). Mirrors
 *  BOLETO_BRIDGE_WINDOW_DAYS on the deterministic bridge. */
const BOLETO_SLIP_WINDOW_DAYS = 5;

/** Fallback own-company CNPJ (digits) for the NF-link stamp, matching
 *  backfill-saida-fiscaldoc-nfse-link.ts. */
const DEFAULT_COMPANY_CNPJ = '13636938000144';

const aggregateTolerance = (amount: number): number =>
  Math.max(MATCH_ABS_TOLERANCE, Math.abs(amount) * MATCH_PCT_TOLERANCE);

/** Slug of the service-revenue category every reconciled receivable receipt is
 *  tagged with, so the entrada side carries an accounting classification (the
 *  inflow analog of the saída's NF-item-derived categories). Seeded by migration
 *  20260621100100_seed_service_revenue_category. */
const SERVICE_REVENUE_CATEGORY_SLUG = 'receita-servicos';

const onlyDigits = (v: string | null | undefined): string => (v || '').replace(/\D/g, '');

type RawCredit = {
  id: string;
  postedAt: Date;
  amount: Prisma.Decimal | number;
  type: string;
  counterpartyName: string | null;
  counterpartyCnpjCpf?: string | null;
  /** OFX subtype — used to gate the boleto-slip allocation to BOLETO credits. */
  subtype?: string | null;
  /** Raw memo — the collection batch code (COBxxxxxx) is a weak same-batch key. */
  memo?: string | null;
};

/** A candidate installment enriched with its customer identity for scoring, plus
 *  the task/invoice context the manual UI renders (mirrors the NF candidate card). */
type ScoredCandidate = {
  id: string;
  amount: number;
  /** Already-received amount (partial allocations). */
  paidAmount: number;
  /** Outstanding balance = amount − paidAmount, what a new credit can settle. */
  remaining: number;
  invoiceId: string | null;
  dueDate: Date;
  number: number;
  /** Installment status (PENDING / OVERDUE / PARTIAL …) for the UI badge. */
  status: string;
  customerName: string | null;
  customerCnpjCpf: string | null;
  /** 0-100 fused confidence (value + date proximity + CNPJ + name). */
  confidence: number;
  /** Task-quote context (faturamento detail target) — null for non-task receivables. */
  taskId: string | null;
  taskName: string | null;
  taskSerialNumber: string | null;
  /** Total NF/invoice value + how many parcelas it has, for the card. */
  invoiceTotal: number | null;
  totalInstallments: number | null;
};

/** How the paying customer was resolved from a credit:
 *  - `cnpj`      exact 14/11-digit document on file → auto-appliable.
 *  - `cnpj-raiz` the payer is a different branch (filial) of a known client —
 *                same 8-digit company root, different /000X branch. A strong
 *                SUGGESTION, never auto (a sibling entity may be billed apart).
 *  - `name`      fuzzy corporate/fantasy-name similarity. */
type MatchVia = 'cnpj' | 'cnpj-raiz' | 'name';

/** A minimal customer row for in-memory identity resolution. */
type CustomerIdentity = {
  id: string;
  cnpjCpf: string | null; // digits-only document, when on file
  fantasyName: string | null;
  corporateName: string | null;
};

/** In-memory index built once per scan: a digits→customer map for instant CNPJ
 *  hits, plus the full list for fuzzy name resolution. */
type CustomerIdentityIndex = {
  byDocument: Map<string, string>; // cnpj/cpf digits → customerId
  customers: CustomerIdentity[];
};

/** A customer's installment eligible to be settled or linked by an incoming
 *  credit (open, or recently-paid-but-unlinked). */
type MatchableInstallment = {
  id: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  status: string;
  dueDate: Date;
  paidAt: Date | null;
  invoiceId: string | null;
  isPaid: boolean;
};

/** One installment a credit will settle/link, with the amount attributed to it. */
type ReceivableAllocation = {
  installmentId: string;
  invoiceId: string | null;
  /** Amount of THIS credit attributed to the installment. */
  amount: number;
  /** The installment is already PAID — link for clearance, do not re-settle. */
  linkOnly: boolean;
};

/** A PAID, UNBRIDGED Sicredi slip a collection credit may bridge to (single) or
 *  sum into (lump COB batch). Its installment is already PAID by the webhook, so
 *  the bridge only links the bank line — it never re-settles the installment. */
type SlipCandidate = {
  id: string;
  amount: number;
  paidAt: Date | null;
  nossoNumero: string;
  installmentId: string;
  invoiceId: string | null;
  customerId: string | null;
};

/**
 * ENTRADA conciliation — the inflow analog of the saída NF matcher.
 *
 * Our receivables live in Invoice → Installment (task quotes, external
 * operations, customer configs). Sicredi boletos WE issue already reconcile
 * through the BankSlip bridge (`onBankSlipPaid`). This service closes the
 * remaining gap: it matches incoming bank CREDITs (PIX/TED/cash) against open
 * NON-boleto installments, marks them paid, recalculates the invoice and
 * cascades the task-quote status — exactly what the Sicredi webhook does for
 * boletos. Conservative auto-match (unique value+date), with a manual path for
 * the Contas a Receber UI.
 */
@Injectable()
export class ReceivableMatchService {
  private readonly logger = new Logger(ReceivableMatchService.name);
  /** Memoized id of the service-revenue category (slug never changes). */
  private serviceRevenueCategoryId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cascadeService: TaskQuoteStatusCascadeService,
    private readonly config: ConfigService,
  ) {}

  /** Master switch for the identity-first pipeline (CNPJ/name → customer →
   *  single/batch/link-paid). Off ⇒ falls back to the legacy value-first scan. */
  private get identityMatchEnabled(): boolean {
    return this.config.get<boolean>('RECEIVABLE_IDENTITY_MATCH_ENABLED', true);
  }
  /** Allow auto-LINKING a credit to an already-PAID installment (clearance only). */
  private get linkPaidEnabled(): boolean {
    return this.config.get<boolean>('RECEIVABLE_LINK_PAID_ENABLED', true);
  }
  /** Allow auto-matching one credit against a BATCH of installments (lump sum). */
  private get batchMatchEnabled(): boolean {
    return this.config.get<boolean>('RECEIVABLE_BATCH_MATCH_ENABLED', true);
  }
  /** Learn the payer's CNPJ onto the Customer record after a confident match. */
  private get backfillCnpjEnabled(): boolean {
    return this.config.get<boolean>('RECEIVABLE_AUTO_BACKFILL_CNPJ', true);
  }
  /** Master switch for the boleto-slip allocation (collection settlements → PAID
   *  Sicredi slips). Off ⇒ collection credits stay for the deterministic bridge /
   *  manual UI. */
  private get boletoSlipMatchEnabled(): boolean {
    return this.config.get<boolean>('RECEIVABLE_BOLETO_SLIP_MATCH_ENABLED', true);
  }
  /** Own-company CNPJ (digits) for the NF-link stamp. */
  private get companyCnpjDigits(): string {
    return (this.config.get<string>('COMPANY_CNPJ') || DEFAULT_COMPANY_CNPJ).replace(/\D/g, '');
  }

  /** Resolve (and cache) the seeded service-revenue category id. Returns null if
   *  the seed migration hasn't run, so tagging degrades gracefully. */
  private async resolveServiceRevenueCategoryId(
    db: Prisma.TransactionClient,
  ): Promise<string | null> {
    if (this.serviceRevenueCategoryId) return this.serviceRevenueCategoryId;
    const cat = await db.transactionCategory.findUnique({
      where: { slug: SERVICE_REVENUE_CATEGORY_SLUG },
      select: { id: true },
    });
    this.serviceRevenueCategoryId = cat?.id ?? null;
    return this.serviceRevenueCategoryId;
  }

  /** Tag a reconciled CREDIT with the service-revenue category (idempotent), so
   *  the entrada carries an accounting classification just like a saída derives
   *  one from its NF items. `allocatedAmount` is the share settled by this credit.
   *  Always AUTO — the tag is derived from the match, not a hand-picked category,
   *  so every unmatch path that drops AUTO tags cleans it up automatically. */
  private async tagServiceRevenue(
    db: Prisma.TransactionClient,
    transactionId: string,
    allocatedAmount: Prisma.Decimal,
  ): Promise<void> {
    const categoryId = await this.resolveServiceRevenueCategoryId(db);
    if (!categoryId) return;
    await db.bankTransactionCategory.upsert({
      where: { transactionId_categoryId: { transactionId, categoryId } },
      create: {
        transactionId,
        categoryId,
        source: ReconciliationSource.AUTO,
        allocatedAmount,
      },
      update: { allocatedAmount, source: ReconciliationSource.AUTO },
    });
  }

  /** Drop the service-revenue tag when an inflow match is reversed. */
  private async untagServiceRevenue(
    db: Prisma.TransactionClient,
    transactionId: string,
  ): Promise<void> {
    const categoryId = await this.resolveServiceRevenueCategoryId(db);
    if (!categoryId) return;
    await db.bankTransactionCategory.deleteMany({ where: { transactionId, categoryId } });
  }

  // ---------------------------------------------------------------------------
  // Auto-match scan (driven by the reconciliation scheduler)
  // ---------------------------------------------------------------------------

  async matchInflowAll(): Promise<number> {
    return this.matchInflowWhere({});
  }

  async matchInflowDateRange(start: Date, end: Date): Promise<number> {
    return this.matchInflowWhere({ postedAt: { gte: start, lte: end } });
  }

  /** Match a specific set of credits — used on OFX import so incoming PIX/TED
   *  receipts auto-conciliate immediately (parity with the saída matcher), not
   *  only at the 04:00 daily cron. */
  async matchInflowByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.matchInflowWhere({ id: { in: ids } });
  }

  /**
   * READ-ONLY efficacy report — runs the exact identity-first resolution +
   * allocation planning over every pending credit WITHOUT mutating anything, so
   * the impact of the matcher can be sized before a sweep actually runs (the
   * dry-run the rollout plan calls for). Buckets each credit into would-auto,
   * suggestion (customer + value resolved but identity ambiguous → one-click),
   * resolved-no-value, and unresolved.
   */
  async simulateInflowMatching(extra: Prisma.BankTransactionWhereInput = {}): Promise<{
    totalPending: number;
    totalPendingValue: number;
    wouldAutoMatch: {
      count: number;
      value: number;
      byVia: Record<MatchVia, number>;
      byKind: Record<string, number>;
    };
    suggestion: { count: number; value: number };
    resolvedNoValue: { count: number; value: number };
    unresolved: { count: number; value: number };
    samples: Array<{
      amount: number;
      counterparty: string | null;
      via: MatchVia | null;
      auto: boolean;
      kind: string | null;
      installments: number;
    }>;
  }> {
    const credits = await this.prisma.bankTransaction.findMany({
      where: { type: 'CREDIT', reconciliationStatus: ReconciliationStatus.PENDING, bankSlipId: null, ...extra },
      select: { id: true, postedAt: true, amount: true, type: true, counterpartyName: true, counterpartyCnpjCpf: true },
      orderBy: { amount: 'desc' },
    });
    const index = await this.buildCustomerIdentityIndex();

    const report = {
      totalPending: credits.length,
      totalPendingValue: 0,
      wouldAutoMatch: {
        count: 0,
        value: 0,
        byVia: { cnpj: 0, 'cnpj-raiz': 0, name: 0 } as Record<MatchVia, number>,
        byKind: {} as Record<string, number>,
      },
      suggestion: { count: 0, value: 0 },
      resolvedNoValue: { count: 0, value: 0 },
      unresolved: { count: 0, value: 0 },
      samples: [] as Array<{
        amount: number;
        counterparty: string | null;
        via: MatchVia | null;
        auto: boolean;
        kind: string | null;
        installments: number;
      }>,
    };

    for (const tx of credits) {
      const amount = Math.abs(Number(tx.amount));
      report.totalPendingValue += amount;
      const resolved = this.resolveCustomer(tx, index);
      let via: MatchVia | null = resolved?.via ?? null;
      let auto = false;
      let kind: string | null = null;
      let installments = 0;

      if (resolved) {
        const plan = await this.planCustomerMatch(tx, resolved.customerId, resolved.via);
        if (plan) {
          kind = plan.kind;
          installments = plan.allocations.length;
          if (resolved.auto) {
            auto = true;
            report.wouldAutoMatch.count += 1;
            report.wouldAutoMatch.value += amount;
            report.wouldAutoMatch.byVia[resolved.via] += 1;
            report.wouldAutoMatch.byKind[plan.kind] = (report.wouldAutoMatch.byKind[plan.kind] ?? 0) + 1;
          } else {
            report.suggestion.count += 1;
            report.suggestion.value += amount;
          }
        } else {
          report.resolvedNoValue.count += 1;
          report.resolvedNoValue.value += amount;
        }
      } else {
        report.unresolved.count += 1;
        report.unresolved.value += amount;
      }

      if (report.samples.length < 30) {
        report.samples.push({ amount, counterparty: tx.counterpartyName, via, auto, kind, installments });
      }
    }

    return report;
  }

  // ---------------------------------------------------------------------------
  // Identity-based suggestion (manual UI one-click) — surfaces the SAME plan the
  // auto path would apply for credits that don't clear the auto bar (ambiguous
  // name, or value the operator should eyeball), including the already-paid
  // link-only batches the plain `allocate` endpoint can't express.
  // ---------------------------------------------------------------------------

  /** The identity-resolved allocation plan for a credit, for the conciliation
   *  panel — null when no customer resolves or the value doesn't reconcile. */
  async getReceivableSuggestion(transactionId: string): Promise<{
    suggestion: {
      customerId: string;
      customerName: string | null;
      via: MatchVia;
      auto: boolean;
      confidence: number;
      kind: string;
      totalAmount: number;
      allocations: Array<{ installmentId: string; amount: number; linkOnly: boolean; number: number; dueDate: Date }>;
    } | null;
  }> {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: { id: true, postedAt: true, amount: true, type: true, counterpartyName: true, counterpartyCnpjCpf: true },
    });
    if (!tx || tx.type !== 'CREDIT') return { suggestion: null };

    const index = await this.buildCustomerIdentityIndex();
    const resolved = this.resolveCustomer(tx, index);
    if (!resolved) return { suggestion: null };
    const plan = await this.planCustomerMatch(tx, resolved.customerId, resolved.via);
    if (!plan) return { suggestion: null };

    const [customer, installments] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: resolved.customerId },
        select: { fantasyName: true, corporateName: true },
      }),
      this.prisma.installment.findMany({
        where: { id: { in: plan.allocations.map(a => a.installmentId) } },
        select: { id: true, number: true, dueDate: true },
      }),
    ]);
    const meta = new Map(installments.map(i => [i.id, i]));

    return {
      suggestion: {
        customerId: resolved.customerId,
        customerName: customer?.fantasyName ?? customer?.corporateName ?? null,
        via: resolved.via,
        auto: resolved.auto,
        confidence: plan.confidence,
        kind: plan.kind,
        totalAmount: plan.allocations.reduce((s, a) => s + a.amount, 0),
        allocations: plan.allocations.map(a => ({
          installmentId: a.installmentId,
          amount: a.amount,
          linkOnly: a.linkOnly,
          number: meta.get(a.installmentId)?.number ?? 0,
          dueDate: meta.get(a.installmentId)?.dueDate ?? tx.postedAt,
        })),
      },
    };
  }

  /** Confirm the identity suggestion for a credit (operator one-click). Re-resolves
   *  under the live state and applies via the shared allocation path, so it handles
   *  multi-installment batches AND already-paid link-only clearance that the plain
   *  `allocate` endpoint rejects. Learns the payer document on success. */
  async confirmReceivableSuggestion(transactionId: string, userId?: string) {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: { id: true, postedAt: true, amount: true, type: true, counterpartyName: true, counterpartyCnpjCpf: true, reconciliationStatus: true },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada.');
    if (tx.type !== 'CREDIT') throw new BadRequestException('Conciliação de entrada requer um crédito.');
    if (tx.reconciliationStatus !== ReconciliationStatus.PENDING) {
      throw new BadRequestException('Esta transação já foi conciliada.');
    }

    const index = await this.buildCustomerIdentityIndex();
    const resolved = this.resolveCustomer(tx, index);
    if (!resolved) throw new BadRequestException('Nenhum cliente pôde ser identificado para esta entrada.');
    const plan = await this.planCustomerMatch(tx, resolved.customerId, resolved.via);
    if (!plan) throw new BadRequestException('Nenhuma combinação de parcelas corresponde ao valor recebido.');

    await this.applyReceivableAllocation(tx, plan.allocations, ReconciliationSource.MANUAL, userId);
    await this.learnCustomerDocument(resolved.customerId, tx.counterpartyCnpjCpf);
    return {
      success: true,
      message: `Recebimento conciliado a ${plan.allocations.length} parcela(s) com sucesso.`,
    };
  }

  private async matchInflowWhere(extra: Prisma.BankTransactionWhereInput): Promise<number> {
    const credits = await this.prisma.bankTransaction.findMany({
      where: {
        type: 'CREDIT',
        reconciliationStatus: ReconciliationStatus.PENDING,
        bankSlipId: null, // boletos go through the Sicredi bridge
        ...extra,
      },
      select: {
        id: true,
        postedAt: true,
        amount: true,
        type: true,
        counterpartyName: true,
        counterpartyCnpjCpf: true,
        subtype: true,
        memo: true,
      },
    });
    if (credits.length === 0) return 0;

    // Build the customer-identity index ONCE per scan (386 customers is cheap) so
    // every credit resolves its payer in memory instead of re-querying.
    const identity = this.identityMatchEnabled ? await this.buildCustomerIdentityIndex() : null;

    let matched = 0;
    for (const credit of credits) {
      try {
        if (await this.tryReceivableInstallmentMatch(credit, identity)) matched += 1;
      } catch (err) {
        this.logger.error(`Inflow match failed for tx ${credit.id}: ${err}`);
      }
    }
    return matched;
  }

  /**
   * Auto-match a CREDIT against a customer's receivables. Identity-first:
   *   1. resolve the paying customer (CNPJ in the memo, or a clean fuzzy name hit);
   *   2. within that customer's matchable installments (open AND recently-paid,
   *      boleto AND not), try a single exact-value installment, then a batch
   *      (one PIX paying many invoices — the dominant B2B pattern);
   *   3. apply — open installments are settled, already-PAID ones are LINKED
   *      (clearance only), and the payer's CNPJ is learned onto the customer.
   * Falls back to the legacy value-first scan when no customer resolves, and
   * always stamps the best confidence (topMatchScore) so the extrato shows
   * "Pendente · N%" even when nothing auto-applies.
   */
  private async tryReceivableInstallmentMatch(
    tx: RawCredit,
    identity: CustomerIdentityIndex | null,
  ): Promise<boolean> {
    // Live status guard — a sibling pass may have reconciled it already.
    const live = await this.prisma.bankTransaction.findUnique({
      where: { id: tx.id },
      select: { reconciliationStatus: true },
    });
    if (!live || live.reconciliationStatus !== ReconciliationStatus.PENDING) return false;

    // ── Boleto-slip allocation (collection settlements) ────────────────────
    // Collection credits (LIQ.COBRANCA) carry NO CNPJ/name — their real identity
    // is the Sicredi-synced PAID BankSlip. Resolve slip-first (single or lump COB
    // batch) BEFORE the CNPJ/name identity path, which can never resolve them.
    if (tx.subtype === 'BOLETO' && this.boletoSlipMatchEnabled) {
      if (await this.tryBoletoSlipAllocation(tx)) return true;
    }

    // ── Identity-first path ────────────────────────────────────────────────
    let identityFloor: number | null = null;
    if (identity) {
      const resolved = this.resolveCustomer(tx, identity);
      if (resolved) {
        if (resolved.auto) {
          const plan = await this.planCustomerMatch(tx, resolved.customerId, resolved.via);
          if (plan) {
            await this.applyReceivableAllocation(
              tx,
              plan.allocations,
              ReconciliationSource.AUTO,
              undefined,
              plan.confidence,
            );
            await this.learnCustomerDocument(resolved.customerId, tx.counterpartyCnpjCpf);
            this.logger.log(
              `Inflow tx ${tx.id} auto-matched to customer ${resolved.customerId} ` +
                `via ${resolved.via} (${plan.kind}, ${plan.allocations.length} parcela(s), conf ${plan.confidence})`,
            );
            return true;
          }
          // Customer resolved but value doesn't reconcile → record the near-miss.
          await this.stampTopScore(tx.id, resolved.score);
          return false;
        }
        // Resolved below the auto bar (raiz branch or fuzzy name): a one-click
        // suggestion is available. Carry its score as the triage floor so the
        // credit still surfaces as a near-miss when value-first finds nothing.
        identityFloor = resolved.score;
      }
    }

    // ── Legacy value-first fallback (kept so identity-off can't regress) ────
    return this.tryValueFirstMatch(tx, identityFloor);
  }

  /** The original value-first auto-match: an open NON-boleto installment whose
   *  exact value+date is unique (or a clear scored winner). Retained as a
   *  fallback for credits where no customer could be resolved. */
  private async tryValueFirstMatch(
    tx: RawCredit,
    floorScore: number | null = null,
  ): Promise<boolean> {
    const candidates = await this.findScoredCandidates(tx, { exactValueOnly: true });
    if (candidates.length === 0) {
      await this.stampTopScore(tx.id, floorScore);
      return false;
    }

    const [best, runnerUp] = candidates;
    const isUnique = candidates.length === 1;
    const clearWinner =
      best.confidence >= AUTO_SCORE_THRESHOLD &&
      (!runnerUp || best.confidence - runnerUp.confidence >= AUTO_RUNNER_UP_GAP);

    if (isUnique || clearWinner) {
      await this.settleInstallment(tx, best.id, ReconciliationSource.AUTO, undefined, best.confidence);
      this.logger.log(
        `Inflow tx ${tx.id} value-matched to installment ${best.id} (conf ${best.confidence}${isUnique ? ', unique' : ''})`,
      );
      return true;
    }

    // Ambiguous → leave for manual, but surface how close the best one is
    // (the higher of the value-first best and any identity near-miss).
    await this.stampTopScore(tx.id, Math.max(best.confidence, floorScore ?? 0));
    return false;
  }

  private async stampTopScore(transactionId: string, score: number | null): Promise<void> {
    await this.prisma.bankTransaction
      .update({ where: { id: transactionId }, data: { topMatchScore: score } })
      .catch(() => undefined);
  }

  // ---------------------------------------------------------------------------
  // Identity-first matching helpers
  // ---------------------------------------------------------------------------

  /** Load every customer once for in-memory payer resolution. 386 rows ≈ free. */
  private async buildCustomerIdentityIndex(): Promise<CustomerIdentityIndex> {
    const rows = await this.prisma.customer.findMany({
      select: { id: true, cnpj: true, cpf: true, fantasyName: true, corporateName: true },
    });
    const byDocument = new Map<string, string>();
    const customers: CustomerIdentity[] = rows.map(r => {
      const doc = onlyDigits(r.cnpj ?? r.cpf ?? null) || null;
      if (doc) byDocument.set(doc, r.id);
      return { id: r.id, cnpjCpf: doc, fantasyName: r.fantasyName, corporateName: r.corporateName };
    });
    return { byDocument, customers };
  }

  /** Resolve the paying customer from a credit. CNPJ/CPF (when the bank parsed it
   *  into the memo) is exact and unambiguous; otherwise a fuzzy name hit, which
   *  only AUTO-applies on a clean, unambiguous winner. `auto=false` results still
   *  feed the suggestion path. */
  private resolveCustomer(
    tx: RawCredit,
    index: CustomerIdentityIndex,
  ): { customerId: string; via: MatchVia; score: number; auto: boolean } | null {
    const txDoc = onlyDigits(tx.counterpartyCnpjCpf);
    if (txDoc) {
      const byDoc = index.byDocument.get(txDoc);
      if (byDoc) return { customerId: byDoc, via: 'cnpj', score: 100, auto: true };

      // Payer is a different branch (filial) of a known client: two CNPJs of the
      // same company share the 8-digit raiz (root) and differ only in the /000X
      // branch + check digits. Resolve on the raiz when it points at EXACTLY one
      // customer — a strong suggestion, but never auto (a distinct sibling entity
      // in the same group could legitimately own that branch).
      if (txDoc.length === 14) {
        const raiz = txDoc.slice(0, 8);
        const roots = index.customers.filter(
          c => !!c.cnpjCpf && c.cnpjCpf.length === 14 && c.cnpjCpf.slice(0, 8) === raiz,
        );
        if (roots.length === 1) {
          return { customerId: roots[0].id, via: 'cnpj-raiz', score: 90, auto: false };
        }
      }
    }

    const name = tx.counterpartyName;
    if (!name) return null;
    let bestId: string | null = null;
    let bestSim = 0;
    let secondSim = 0;
    for (const c of index.customers) {
      const sim = Math.max(nameSimilarity(name, c.fantasyName), nameSimilarity(name, c.corporateName));
      if (sim > bestSim) {
        secondSim = bestSim;
        bestSim = sim;
        bestId = c.id;
      } else if (sim > secondSim) {
        secondSim = sim;
      }
    }
    if (!bestId || bestSim < NAME_SUGGEST_SIM) return null;
    const auto = bestSim >= NAME_AUTO_SIM && secondSim < NAME_RUNNERUP_SIM;
    return { customerId: bestId, via: 'name', score: Math.round(bestSim * 100), auto };
  }

  /** Build an allocation plan for a credit against one customer's receivables:
   *  a single exact installment, a "paid the whole (windowed) balance" batch, or
   *  a bounded subset-sum — returning null when the value can't be reconciled. */
  private async planCustomerMatch(
    tx: RawCredit,
    customerId: string,
    via: MatchVia,
  ): Promise<{ allocations: ReceivableAllocation[]; kind: string; confidence: number } | null> {
    const creditAbs = Math.abs(Number(tx.amount));
    const matchable = await this.gatherMatchableInstallments(customerId, tx.postedAt);
    if (matchable.length === 0) return null;

    const best = this.findBestAllocation(creditAbs, matchable, tx.postedAt);
    if (!best) return null;

    const anyPaid = best.items.some(i => i.isPaid);
    const isBatch = best.items.length > 1;
    if (anyPaid && !this.linkPaidEnabled) return null;
    if (isBatch && !this.batchMatchEnabled) return null;

    const allocations: ReceivableAllocation[] = best.items.map(i => ({
      installmentId: i.id,
      invoiceId: i.invoiceId,
      amount: i.isPaid ? i.amount : i.remaining,
      linkOnly: i.isPaid,
    }));
    const confidence =
      via === 'cnpj'
        ? isBatch
          ? 95
          : 97
        : via === 'cnpj-raiz'
          ? isBatch
            ? 88
            : 93
          : isBatch
            ? 85
            : 90;
    return { allocations, kind: best.kind, confidence };
  }

  /** A customer's installments an incoming credit may settle (open) or LINK
   *  (recently-paid, clearance only) — excluding any already cleared via an
   *  installment match or a boleto slip already linked to a bank line. */
  private async gatherMatchableInstallments(
    customerId: string,
    postedAt: Date,
  ): Promise<MatchableInstallment[]> {
    const paidLower = new Date(postedAt.getTime() - PAID_LINK_WINDOW_DAYS * 86_400_000);
    const paidUpper = new Date(postedAt.getTime() + PAID_LINK_WINDOW_DAYS * 86_400_000);

    const statusOr: Prisma.InstallmentWhereInput[] = [
      { status: { in: OPEN_INSTALLMENT_STATUSES as unknown as Prisma.EnumInstallmentStatusFilter['in'] } },
    ];
    if (this.linkPaidEnabled) {
      statusOr.push({ status: 'PAID', paidAt: { gte: paidLower, lte: paidUpper } });
    }

    const installments = await this.prisma.installment.findMany({
      where: {
        AND: [
          {
            OR: [
              { invoice: { customerId } },
              { customerConfig: { customer: { id: customerId } } },
              { externalOperation: { customer: { id: customerId } } },
            ],
          },
          { OR: statusOr },
        ],
        // Not already conciliated via an installment match…
        reconciliationMatches: { none: { reversedAt: null } },
        // …nor via a boleto slip already linked to a bank credit (avoid double clearance).
        NOT: { bankSlip: { transactions: { some: {} } } },
      },
      select: {
        id: true,
        amount: true,
        paidAmount: true,
        status: true,
        dueDate: true,
        paidAt: true,
        invoiceId: true,
      },
      orderBy: { dueDate: 'asc' },
      take: 200,
    });

    return installments.map(i => {
      const amount = Number(i.amount);
      const paidAmount = Number(i.paidAmount ?? 0);
      return {
        id: i.id,
        amount,
        paidAmount,
        remaining: Math.max(0, amount - paidAmount),
        status: i.status,
        dueDate: i.dueDate,
        paidAt: i.paidAt,
        invoiceId: i.invoiceId,
        isPaid: i.status === 'PAID',
      };
    });
  }

  /** Pick the best reconciling set for a credit against a customer's matchable
   *  installments: single exact → windowed "pay-all" batch → bounded subset-sum.
   *  Attributed value is the outstanding balance (open) or the face (already-paid
   *  link). Returns null when nothing sums to the credit within tolerance. */
  private findBestAllocation(
    creditAbs: number,
    matchable: MatchableInstallment[],
    postedAt: Date,
  ): { items: MatchableInstallment[]; kind: string } | null {
    const tol = aggregateTolerance(creditAbs);
    const attr = (i: MatchableInstallment): number => (i.isPaid ? i.amount : i.remaining);
    const refDate = (i: MatchableInstallment): Date => i.paidAt ?? i.dueDate;
    const daysFrom = (i: MatchableInstallment): number =>
      Math.abs(refDate(i).getTime() - postedAt.getTime()) / 86_400_000;

    // 1. Single installment whose value matches — prefer OPEN, then date-closest.
    const singles = matchable
      .filter(i => Math.abs(attr(i) - creditAbs) <= tol)
      .sort((a, b) => (a.isPaid ? 1 : 0) - (b.isPaid ? 1 : 0) || daysFrom(a) - daysFrom(b));
    if (singles.length > 0) return { items: [singles[0]], kind: 'single' };

    // 2. Batch — one transfer paying several invoices. Try tightening windows
    //    around the payment date first (precise), then the whole balance.
    for (const w of [10, 20, 45, Infinity]) {
      const set = w === Infinity ? matchable : matchable.filter(i => daysFrom(i) <= w);
      if (set.length >= 2) {
        const sum = set.reduce((s, i) => s + attr(i), 0);
        if (Math.abs(sum - creditAbs) <= aggregateTolerance(creditAbs)) {
          return { items: set, kind: `batch:${w === Infinity ? 'all' : w + 'd'}` };
        }
      }
    }

    // 3. Bounded subset-sum for small sets (partial batches the windows missed).
    if (matchable.length <= SUBSET_SUM_MAX_ITEMS) {
      const subset = this.subsetSum(matchable, creditAbs, tol, attr);
      if (subset && subset.length >= 2) return { items: subset, kind: 'subset' };
    }

    return null;
  }

  /** Bounded DFS subset-sum (≤ SUBSET_SUM_MAX_ITEMS items). Returns the first
   *  subset (size ≥ 2) whose attributed sum is within tolerance of the target,
   *  exploring high-value-first so a few large invoices resolve before many tiny
   *  ones. Pruned when the running sum overshoots, so worst case is ~2^N nodes. */
  private subsetSum<T>(
    items: T[],
    target: number,
    tol: number,
    attr: (i: T) => number,
  ): T[] | null {
    const sorted = items.map(i => ({ i, v: attr(i) })).sort((a, b) => b.v - a.v);
    const n = sorted.length;
    const chosen: T[] = [];
    let found: T[] | null = null;

    const dfs = (idx: number, sum: number): void => {
      if (found) return;
      if (chosen.length >= 2 && Math.abs(sum - target) <= tol) {
        found = [...chosen];
        return;
      }
      if (idx >= n || sum > target + tol) return;
      chosen.push(sorted[idx].i);
      dfs(idx + 1, sum + sorted[idx].v);
      chosen.pop();
      if (!found) dfs(idx + 1, sum);
    };
    dfs(0, 0);
    return found;
  }

  // ---------------------------------------------------------------------------
  // Boleto-slip allocation (collection settlements)
  // ---------------------------------------------------------------------------

  /**
   * Slip-first reconciliation for a collection CREDIT (subtype BOLETO). These
   * carry no CNPJ/name — their identity is the Sicredi-synced PAID BankSlip — and
   * the memo's COBxxxxxx is a batch/carteira code, NOT a per-boleto id. Resolve
   * candidate PAID, UNBRIDGED slips in the settlement window and:
   *   - single slip whose liquidation equals the credit → bridge it (1:1 boleto);
   *   - lump collection (one credit = a same-day COB batch) → sum a set of slips
   *     to the credit (same-paidAt-day groups first, then bounded subset-sum) and
   *     bridge them all.
   * The installments are already PAID (webhook), so this only links the bank line
   * + stamps the NF — it never re-settles the installment. Idempotent under the
   * shared advisory lock + @@unique([transactionId, bankSlipId]).
   */
  private async tryBoletoSlipAllocation(tx: RawCredit): Promise<boolean> {
    const creditAbs = Math.abs(Number(tx.amount));
    const tol = aggregateTolerance(creditAbs);
    const lower = new Date(tx.postedAt.getTime() - BOLETO_SLIP_WINDOW_DAYS * 86_400_000);
    const upper = new Date(tx.postedAt.getTime() + BOLETO_SLIP_WINDOW_DAYS * 86_400_000);

    // PAID, UNBRIDGED slips (no linked bank line AND no active reconciliation
    // match) within the window whose value fits inside the credit.
    const rows = await this.prisma.bankSlip.findMany({
      where: {
        status: 'PAID',
        transactions: { none: {} },
        reconciliationMatches: { none: { reversedAt: null } },
        paidAt: { gte: lower, lte: upper },
        paidAmount: { gt: 0, lte: creditAbs + tol },
      },
      select: {
        id: true,
        paidAmount: true,
        paidAt: true,
        nossoNumero: true,
        installmentId: true,
        installment: { select: { invoiceId: true, invoice: { select: { customerId: true } } } },
      },
      orderBy: { paidAt: 'asc' },
    });
    if (rows.length === 0) return false;

    const cands: SlipCandidate[] = rows.map(s => ({
      id: s.id,
      amount: Number(s.paidAmount ?? 0),
      paidAt: s.paidAt,
      nossoNumero: s.nossoNumero,
      installmentId: s.installmentId,
      invoiceId: s.installment?.invoiceId ?? null,
      customerId: s.installment?.invoice?.customerId ?? null,
    }));

    const dateDelta = (paidAt: Date | null): number =>
      paidAt ? Math.abs(paidAt.getTime() - tx.postedAt.getTime()) : Infinity;

    // 1. Single slip whose liquidation equals the credit — the common 1:1 boleto.
    //    Prefer the slip whose paidAt is closest to the credit (settlement lag).
    const exacts = cands
      .filter(c => Math.abs(c.amount - creditAbs) <= tol)
      .sort((a, b) => dateDelta(a.paidAt) - dateDelta(b.paidAt));
    let chosen: SlipCandidate[] | null = exacts.length > 0 ? [exacts[0]] : null;
    let kind = 'boleto-single';

    // 2. Lump collection — one credit settles a same-day COB batch of boletos.
    if (!chosen) {
      const batch = this.findSlipBatch(cands, creditAbs, tol, tx.postedAt);
      if (batch) {
        chosen = batch;
        kind = 'boleto-batch';
      }
    }
    if (!chosen) return false;

    return this.applyBoletoSlipAllocation(tx, chosen, kind, creditAbs);
  }

  /** Sum a set of PAID slips to the credit. The Sicredi COB batch liquidates on a
   *  single day, so try same-paidAt-day groups (nearest the credit first) — the
   *  whole day's sum, then a bounded subset within it — before a bounded
   *  subset-sum over the whole window. Returns a set of ≥ 2 slips or null. */
  private findSlipBatch(
    cands: SlipCandidate[],
    creditAbs: number,
    tol: number,
    postedAt: Date,
  ): SlipCandidate[] | null {
    const dayKey = (paidAt: Date | null): string =>
      paidAt ? paidAt.toISOString().slice(0, 10) : 'null';

    const byDay = new Map<string, SlipCandidate[]>();
    for (const c of cands) {
      const key = dayKey(c.paidAt);
      const grp = byDay.get(key);
      if (grp) grp.push(c);
      else byDay.set(key, [c]);
    }

    const dayDelta = (key: string): number => {
      if (key === 'null') return Infinity;
      return Math.abs(new Date(`${key}T00:00:00.000Z`).getTime() - postedAt.getTime());
    };
    const days = [...byDay.entries()].sort((a, b) => dayDelta(a[0]) - dayDelta(b[0]));

    for (const [, grp] of days) {
      if (grp.length < 2) continue;
      const sum = grp.reduce((s, c) => s + c.amount, 0);
      if (Math.abs(sum - creditAbs) <= tol) return grp; // whole-day COB batch
      if (grp.length <= SUBSET_SUM_MAX_ITEMS) {
        const sub = this.subsetSum(grp, creditAbs, tol, c => c.amount);
        if (sub && sub.length >= 2) return sub;
      }
    }

    // Fallback: bounded subset-sum across the whole window (batches spanning days).
    if (cands.length <= SUBSET_SUM_MAX_ITEMS) {
      const sub = this.subsetSum(cands, creditAbs, tol, c => c.amount);
      if (sub && sub.length >= 2) return sub;
    }
    return null;
  }

  /** Link a collection credit to its PAID slip(s): one BANK_SLIP_BRIDGE match per
   *  slip, mark the credit reconciled, tag service revenue, and stamp each slip's
   *  NF link. Runs under the shared advisory lock (serializes against the matcher
   *  bridge + webhook) and re-verifies every slip is still unbridged. The single
   *  bankSlipId FK is set ONLY for a 1:1 match; a batch relies on the match rows
   *  (unmatchInflow already reverses installment-less bridge matches by txId). */
  private async applyBoletoSlipAllocation(
    tx: RawCredit,
    slips: SlipCandidate[],
    kind: string,
    creditAbs: number,
  ): Promise<boolean> {
    const abs = new Decimal(creditAbs);
    const cob = (tx.memo ?? '').match(/COB\d+/i)?.[0] ?? null;

    const committed = await this.prisma.$transaction(async db => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(${RECON_ADVISORY_LOCK_KEY})`;

      // Credit must still be pending + unlinked.
      const live = await db.bankTransaction.findUnique({
        where: { id: tx.id },
        select: { bankSlipId: true, reconciliationStatus: true },
      });
      if (!live || live.bankSlipId || live.reconciliationStatus !== ReconciliationStatus.PENDING) {
        return false;
      }

      // Re-verify every chosen slip is still unbridged under the lock.
      for (const s of slips) {
        const free = await db.bankSlip.findFirst({
          where: {
            id: s.id,
            transactions: { none: {} },
            reconciliationMatches: { none: { reversedAt: null } },
          },
          select: { id: true },
        });
        if (!free) return false;
      }

      for (const s of slips) {
        await db.reconciliationMatch.create({
          data: {
            transactionId: tx.id,
            bankSlipId: s.id,
            // Each bridge match carries the value THIS slip actually settled — a
            // batch (LIQ.COBRANCA lote) is the sum of its boletos, not an even
            // split of the credit. A 1:1 bridge uses the credit amount (== slip).
            allocatedAmount: slips.length === 1 ? abs : new Decimal(s.amount),
            matchType: ReconciliationMatchType.BANK_SLIP_BRIDGE,
            confidenceScore: slips.length === 1 ? 98 : 90,
            notes:
              `Conciliação ${kind} boleto ${s.nossoNumero}` +
              (cob ? ` (lote ${cob})` : ''),
          },
        });
      }

      await db.bankTransaction.update({
        where: { id: tx.id },
        data: {
          // Only a 1:1 bridge can carry the scalar FK; a batch is anchored by its
          // match rows (and the RECONCILED status keeps it out of every re-scan).
          bankSlipId: slips.length === 1 ? slips[0].id : null,
          reconciliationStatus: ReconciliationStatus.RECONCILED,
          reconciliationSource: ReconciliationSource.AUTO,
          topMatchScore: null,
          expectsFiscalDocument: true,
        },
      });
      await this.tagServiceRevenue(db, tx.id, abs);

      // Close the broken hop: credit → slip → installment → invoice → NF.
      for (const s of slips) {
        if (s.invoiceId) await this.stampNfLinkForInvoice(db, s.invoiceId);
      }
      return true;
    });

    if (committed) {
      this.logger.log(
        `Inflow tx ${tx.id} boleto-slip matched (${kind}, ${slips.length} slip(s), R$ ${creditAbs.toFixed(2)})`,
      );
    }
    return committed;
  }

  /** Stamp FiscalDocument.nfseDocumentId for the SAIDA doc generated from this
   *  invoice's NfseDocument (match by nf number + own emitter CNPJ, never steal a
   *  link). Idempotent — mirror of backfill-saida-fiscaldoc-nfse-link.ts. */
  private async stampNfLinkForInvoice(
    db: Prisma.TransactionClient,
    invoiceId: string,
  ): Promise<void> {
    const nfses = await db.nfseDocument.findMany({
      where: { invoiceId, nfseNumber: { not: null } },
      select: { id: true, nfseNumber: true },
    });
    const companyDigits = this.companyCnpjDigits;
    for (const nfse of nfses) {
      if (nfse.nfseNumber == null) continue;
      const claimed = await db.fiscalDocument.findFirst({
        where: { nfseDocumentId: nfse.id },
        select: { id: true },
      });
      if (claimed) continue;
      const docs = await db.fiscalDocument.findMany({
        where: {
          operationType: FiscalDocumentOperation.SAIDA,
          docType: FiscalDocumentType.NFSE,
          nfseDocumentId: null,
          nfNumber: String(nfse.nfseNumber),
        },
        select: { id: true, emitCnpj: true },
      });
      const own = docs.find(d => (d.emitCnpj ?? '').replace(/\D/g, '') === companyDigits);
      if (!own) continue;
      await db.fiscalDocument.update({
        where: { id: own.id },
        data: { nfseDocumentId: nfse.id },
      });
    }
  }

  /** Apply an allocation plan: settle OPEN installments, LINK already-paid ones
   *  (clearance, no re-settle), recompute their invoices, mark the credit
   *  reconciled, tag service revenue, and cascade each installment's task-quote
   *  status. Idempotent via the (transactionId, installmentId) unique index. */
  private async applyReceivableAllocation(
    tx: { id: string; postedAt: Date; amount: Prisma.Decimal | number },
    allocations: ReceivableAllocation[],
    source: ReconciliationSource,
    userId?: string,
    confidence?: number,
  ): Promise<void> {
    const creditAbs = Math.abs(Number(tx.amount));
    const totalAttr = allocations.reduce((s, a) => s + a.amount, 0);
    const matchType =
      source === ReconciliationSource.MANUAL
        ? ReconciliationMatchType.MANUAL
        : ReconciliationMatchType.VALUE_DATE;
    const invoiceIds = new Set<string>();

    await this.prisma.$transaction(async db => {
      for (const a of allocations) {
        if (!a.linkOnly) {
          const inst = await db.installment.findUniqueOrThrow({
            where: { id: a.installmentId },
            select: { amount: true },
          });
          await db.installment.update({
            where: { id: a.installmentId },
            data: { status: 'PAID', paidAmount: inst.amount, paidAt: tx.postedAt },
          });
        }
        await db.reconciliationMatch.create({
          data: {
            transactionId: tx.id,
            installmentId: a.installmentId,
            allocatedAmount: new Decimal(a.amount),
            matchType,
            confidenceScore: confidence ?? 90,
            matchedByUserId: userId ?? null,
          },
        });
        if (a.invoiceId) invoiceIds.add(a.invoiceId);
      }
      for (const invoiceId of invoiceIds) await this.recalcInvoice(db, invoiceId);

      const fullyAllocated = Math.abs(totalAttr - creditAbs) <= aggregateTolerance(creditAbs);
      await db.bankTransaction.update({
        where: { id: tx.id },
        data: {
          reconciliationStatus: fullyAllocated
            ? ReconciliationStatus.RECONCILED
            : ReconciliationStatus.PARTIAL,
          reconciliationSource: source,
          topMatchScore: null,
        },
      });
      await this.tagServiceRevenue(db, tx.id, new Decimal(totalAttr));
    });

    for (const a of allocations) {
      await this.cascadeService.cascadeFromInstallment(a.installmentId).catch(() => undefined);
    }
  }

  /** Learn the payer's CNPJ/CPF onto the customer after a confident match, so the
   *  NEXT payment from them resolves by exact document (no fuzzy guess). Only
   *  fills an empty slot and never overwrites a different document; a @unique
   *  collision (another customer owns it) is swallowed. */
  private async learnCustomerDocument(
    customerId: string,
    txCnpjCpf: string | null | undefined,
  ): Promise<void> {
    if (!this.backfillCnpjEnabled) return;
    const doc = onlyDigits(txCnpjCpf);
    if (!doc) return;
    const field = doc.length === 14 ? 'cnpj' : doc.length === 11 ? 'cpf' : null;
    if (!field) return;

    const cust = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { cnpj: true, cpf: true },
    });
    if (!cust) return;
    if (onlyDigits(cust.cnpj) === doc || onlyDigits(cust.cpf) === doc) return; // already known
    if (cust[field]) return; // slot occupied by a different document — don't overwrite

    try {
      await this.prisma.customer.update({ where: { id: customerId }, data: { [field]: doc } });
      this.logger.log(`Learned ${field} ${doc} for customer ${customerId} from a reconciled credit`);
    } catch (err) {
      this.logger.debug(`Skipped ${field} backfill for customer ${customerId}: ${err}`);
    }
  }

  /**
   * Find open installments for a credit and score each 0-100 by value exactness,
   * due-date proximity, counterparty CNPJ and counterparty name similarity. The
   * single source of candidate confidence for BOTH the auto path and the manual
   * UI (so the panel never shows a score the auto path silently can't act on).
   */
  private async findScoredCandidates(
    tx: { postedAt: Date; amount: Prisma.Decimal | number; counterpartyName?: string | null; counterpartyCnpjCpf?: string | null },
    opts: { exactValueOnly: boolean; windowDays?: number },
  ): Promise<ScoredCandidate[]> {
    const abs = Math.abs(Number(tx.amount));
    const windowDays = opts.windowDays ?? RECEIVABLE_WINDOW_DAYS;
    const lower = new Date(tx.postedAt.getTime() - windowDays * 86_400_000);
    const upper = new Date(tx.postedAt.getTime() + windowDays * 86_400_000);

    const amountFilter: Prisma.DecimalFilter = opts.exactValueOnly
      ? { gte: abs - AMOUNT_TOLERANCE, lte: abs + AMOUNT_TOLERANCE }
      : { gt: 0 };

    const installments = await this.prisma.installment.findMany({
      where: {
        status: { in: OPEN_INSTALLMENT_STATUSES as unknown as Prisma.EnumInstallmentStatusFilter['in'] },
        bankSlip: null, // boleto installments settle via the Sicredi bridge
        amount: amountFilter,
        dueDate: { gte: lower, lte: upper },
        // Auto path: never touch an installment that already has a live match.
        // Manual path: open-but-partially-allocated installments (status still
        // PENDING/OVERDUE, balance remaining) stay eligible so the operator can
        // top them up via allocate — only fully-settled (PAID) ones drop out,
        // and those are already excluded by the open-status filter above.
        ...(opts.exactValueOnly ? { reconciliationMatches: { none: { reversedAt: null } } } : {}),
      },
      include: {
        invoice: {
          select: {
            customer: { select: { fantasyName: true, corporateName: true, cnpj: true, cpf: true } },
            taskId: true,
            totalAmount: true,
            task: { select: { id: true, name: true, serialNumber: true } },
            _count: { select: { installments: true } },
          },
        },
        customerConfig: {
          select: {
            customer: { select: { fantasyName: true, corporateName: true, cnpj: true, cpf: true } },
            quote: { select: { task: { select: { id: true, name: true, serialNumber: true } } } },
          },
        },
        externalOperation: { select: { customer: { select: { fantasyName: true, corporateName: true, cnpj: true, cpf: true } } } },
      },
      orderBy: { dueDate: 'asc' },
      take: 50,
    });

    const txCnpj = onlyDigits(tx.counterpartyCnpjCpf);
    return installments
      .map(inst => {
        const customer =
          inst.invoice?.customer ?? inst.customerConfig?.customer ?? inst.externalOperation?.customer ?? null;
        const amount = Number(inst.amount);
        const paidAmount = Number(inst.paidAmount ?? 0);
        const remaining = Math.max(0, amount - paidAmount);
        const customerCnpjCpf = onlyDigits(customer?.cnpj ?? customer?.cpf ?? null) || null;
        const customerName = customer?.fantasyName ?? customer?.corporateName ?? null;
        // Task-quote context: prefer the invoice's task, else the customerConfig's
        // quote task (TASK_QUOTE receivables without a materialized invoice).
        const task = inst.invoice?.task ?? inst.customerConfig?.quote?.task ?? null;
        // Score against the outstanding balance so a partially-paid installment
        // surfaced in the manual path scores on what the credit can still settle.
        const confidence = this.scoreCandidate({
          txAbs: abs,
          txPostedAt: tx.postedAt,
          txName: tx.counterpartyName ?? null,
          txCnpj,
          instAmount: remaining > 0 ? remaining : amount,
          instDueDate: inst.dueDate,
          custName: customerName,
          custCnpj: customerCnpjCpf,
        });
        return {
          id: inst.id,
          amount,
          paidAmount,
          remaining,
          invoiceId: inst.invoiceId,
          dueDate: inst.dueDate,
          number: inst.number,
          status: inst.status,
          customerName,
          customerCnpjCpf,
          confidence,
          taskId: task?.id ?? inst.invoice?.taskId ?? null,
          taskName: task?.name ?? null,
          taskSerialNumber: task?.serialNumber ?? null,
          invoiceTotal: inst.invoice?.totalAmount != null ? Number(inst.invoice.totalAmount) : null,
          totalInstallments: inst.invoice?._count?.installments ?? null,
        };
      })
      .sort((a, b) => b.confidence - a.confidence);
  }

  /** Fuse value, date proximity, counterparty CNPJ and name into a 0-100 score. */
  private scoreCandidate(p: {
    txAbs: number;
    txPostedAt: Date;
    txName: string | null;
    txCnpj: string;
    instAmount: number;
    instDueDate: Date;
    custName: string | null;
    custCnpj: string | null;
  }): number {
    // Value (max 50): exact dominates; near-value degrades.
    const diff = Math.abs(p.instAmount - p.txAbs);
    let value: number;
    if (diff <= AMOUNT_TOLERANCE) value = 50;
    else {
      const ratio = p.txAbs > 0 ? diff / p.txAbs : 1;
      value = ratio <= 0.01 ? 38 : ratio <= 0.02 ? 28 : ratio <= 0.05 ? 16 : ratio <= 0.1 ? 8 : 0;
    }

    // Date proximity (max 20).
    const days = Math.abs(p.instDueDate.getTime() - p.txPostedAt.getTime()) / 86_400_000;
    const date = days <= 2 ? 20 : days <= 5 ? 16 : days <= 10 ? 12 : days <= 20 ? 8 : days <= 40 ? 4 : 1;

    // Counterparty CNPJ/CPF (max 25) — exact identity is the strongest signal.
    const cnpj = p.txCnpj && p.custCnpj && p.txCnpj === p.custCnpj ? 25 : 0;

    // Counterparty name similarity (max 15).
    const sim = nameSimilarity(p.txName, p.custName);
    const name = sim >= 0.8 ? 15 : sim >= 0.5 ? 10 : sim > 0 ? 5 : 0;

    return Math.min(100, Math.round(value + date + cnpj + name));
  }

  // ---------------------------------------------------------------------------
  // Manual match (Contas a Receber UI)
  // ---------------------------------------------------------------------------

  /** Open installments offered as candidates for a CREDIT in the manual UI.
   *  Uses the SAME scorer as the auto path (value + date + CNPJ + name) over a
   *  wide value/date window, so the confidence the operator sees is the one the
   *  auto path acts on — no more "90% shown but never auto-matched". */
  async getReceivableCandidates(transactionId: string) {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: { id: true, postedAt: true, amount: true, type: true, counterpartyName: true, counterpartyCnpjCpf: true },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada.');
    if (tx.type !== 'CREDIT') throw new BadRequestException('Conciliação de entrada requer um crédito.');

    const candidates = await this.findScoredCandidates(tx, { exactValueOnly: false, windowDays: 60 });
    const installmentCandidates = candidates.map(c => ({
      installmentId: c.id,
      number: c.number,
      amount: c.amount,
      paidAmount: c.paidAmount,
      remaining: c.remaining,
      dueDate: c.dueDate,
      status: c.status,
      customerName: c.customerName,
      invoiceId: c.invoiceId,
      confidence: c.confidence,
      taskId: c.taskId,
      taskName: c.taskName,
      taskSerialNumber: c.taskSerialNumber,
      invoiceTotal: c.invoiceTotal,
      totalInstallments: c.totalInstallments,
      // Direct (PIX/TED) installment match — no boleto involved.
      bankSlipId: null as string | null,
      viaBankSlip: false,
    }));

    // Boleto receivables WE issued that are already PAID (Sicredi liquidation) but
    // whose bank-statement credit hasn't been linked yet. The auto bridge only acts
    // on a unique value+date hit; surfacing them here lets the operator confirm the
    // bank line manually — and is what makes a boleto reappear as a candidate after
    // its bridge is undone (the installment stays PAID, so it is invisible to the
    // open-installment finder above).
    const boletoCandidates = await this.findBoletoCandidates(tx);

    // Same installment can't appear twice; boletos are keyed by their own slip.
    return [...installmentCandidates, ...boletoCandidates].sort((a, b) => b.confidence - a.confidence);
  }

  /** Unlinked PAID boletos as manual conciliation candidates (the operator's path
   *  for what the auto bridge couldn't uniquely resolve). Scored by value + date +
   *  counterparty, mirroring the installment scorer. */
  private async findBoletoCandidates(tx: {
    postedAt: Date;
    amount: Prisma.Decimal | number;
    counterpartyName?: string | null;
    counterpartyCnpjCpf?: string | null;
  }) {
    const abs = Math.abs(Number(tx.amount));
    // Value band tolerant of boleto juros/multa/desconto drift; date band wide
    // since the operator reviews each one.
    const valuePad = Math.max(5, abs * 0.05);
    const windowMs = 90 * 86_400_000;
    const lower = new Date(tx.postedAt.getTime() - windowMs);
    const upper = new Date(tx.postedAt.getTime() + windowMs);
    const txCnpj = onlyDigits(tx.counterpartyCnpjCpf);

    const slips = await this.prisma.bankSlip.findMany({
      where: {
        status: 'PAID',
        transactions: { none: {} }, // not yet linked to a bank credit
        paidAmount: { gte: abs - valuePad, lte: abs + valuePad },
        OR: [{ paidAt: { gte: lower, lte: upper } }, { paidAt: null }],
      },
      select: {
        id: true,
        paidAmount: true,
        paidAt: true,
        dueDate: true,
        installment: {
          select: {
            id: true,
            number: true,
            amount: true,
            dueDate: true,
            status: true,
            invoiceId: true,
            invoice: {
              select: {
                taskId: true,
                totalAmount: true,
                customer: { select: { fantasyName: true, corporateName: true, cnpj: true, cpf: true } },
                task: { select: { id: true, name: true, serialNumber: true } },
                _count: { select: { installments: true } },
              },
            },
            customerConfig: {
              select: {
                customer: { select: { fantasyName: true, corporateName: true, cnpj: true, cpf: true } },
                quote: { select: { task: { select: { id: true, name: true, serialNumber: true } } } },
              },
            },
            externalOperation: {
              select: { customer: { select: { fantasyName: true, corporateName: true, cnpj: true, cpf: true } } },
            },
          },
        },
      },
      take: 50,
    });

    return slips
      .filter(s => s.installment != null)
      .map(s => {
        const inst = s.installment!;
        const customer =
          inst.invoice?.customer ?? inst.customerConfig?.customer ?? inst.externalOperation?.customer ?? null;
        const task = inst.invoice?.task ?? inst.customerConfig?.quote?.task ?? null;
        const paid = Number(s.paidAmount ?? inst.amount);
        const confidence = this.scoreCandidate({
          txAbs: abs,
          txPostedAt: tx.postedAt,
          txName: tx.counterpartyName ?? null,
          txCnpj,
          instAmount: paid,
          instDueDate: s.paidAt ?? s.dueDate ?? inst.dueDate,
          custName: customer?.fantasyName ?? customer?.corporateName ?? null,
          custCnpj: onlyDigits(customer?.cnpj ?? customer?.cpf ?? null) || null,
        });
        return {
          installmentId: inst.id,
          number: inst.number,
          amount: paid,
          paidAmount: 0,
          remaining: paid,
          dueDate: inst.dueDate,
          status: inst.status,
          customerName: customer?.fantasyName ?? customer?.corporateName ?? null,
          invoiceId: inst.invoiceId,
          confidence,
          taskId: task?.id ?? inst.invoice?.taskId ?? null,
          taskName: task?.name ?? null,
          taskSerialNumber: task?.serialNumber ?? null,
          invoiceTotal: inst.invoice?.totalAmount != null ? Number(inst.invoice.totalAmount) : null,
          totalInstallments: inst.invoice?._count?.installments ?? null,
          // Boleto bridge: matching this candidate links the credit to the boleto,
          // it does NOT re-settle the (already paid) installment.
          bankSlipId: s.id,
          viaBankSlip: true,
        };
      });
  }

  async manualMatchInstallment(transactionId: string, installmentId: string, userId?: string) {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: { id: true, postedAt: true, amount: true, type: true, counterpartyName: true },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada.');
    if (tx.type !== 'CREDIT') throw new BadRequestException('Conciliação de entrada requer um crédito.');

    const installment = await this.prisma.installment.findUnique({
      where: { id: installmentId },
      select: {
        id: true,
        status: true,
        reconciliationMatches: { where: { reversedAt: null }, select: { id: true } },
        bankSlip: { select: { id: true, status: true, transactions: { select: { id: true }, take: 1 } } },
      },
    });
    if (!installment) throw new NotFoundException('Parcela a receber não encontrada.');
    if (installment.reconciliationMatches.length > 0) {
      throw new BadRequestException('Esta parcela já está conciliada.');
    }

    // Boleto receivable already PAID (Sicredi) with no bank line linked yet: link
    // the credit to the boleto (bridge) instead of re-settling the installment.
    const slip = installment.bankSlip;
    if (slip && slip.status === 'PAID') {
      if (slip.transactions.length > 0) {
        throw new BadRequestException('Este boleto já está conciliado a outra transação.');
      }
      await this.settleViaBoletoBridge(tx, slip.id, userId);
      return { success: true, message: 'Recebimento conciliado ao boleto com sucesso.' };
    }

    await this.settleInstallment(tx, installmentId, ReconciliationSource.MANUAL, userId);
    return { success: true, message: 'Recebimento conciliado com sucesso.' };
  }

  /** Manually link a credit to an already-PAID boleto (mirror of the auto bridge).
   *  The installment was settled by the Sicredi webhook, so this only attaches the
   *  bank line + tags the entrada — it never touches the installment/invoice. */
  private async settleViaBoletoBridge(
    tx: { id: string; amount: Prisma.Decimal | number },
    bankSlipId: string,
    userId?: string,
  ): Promise<void> {
    const abs = new Decimal(Math.abs(Number(tx.amount)));
    await this.prisma.$transaction(async db => {
      await db.reconciliationMatch.create({
        data: {
          transactionId: tx.id,
          bankSlipId,
          allocatedAmount: abs,
          matchType: ReconciliationMatchType.BANK_SLIP_BRIDGE,
          confidenceScore: 100,
          matchedByUserId: userId ?? null,
        },
      });
      await db.bankTransaction.update({
        where: { id: tx.id },
        data: {
          bankSlipId,
          reconciliationStatus: ReconciliationStatus.RECONCILED,
          reconciliationSource: ReconciliationSource.MANUAL,
          topMatchScore: null,
          expectsFiscalDocument: true,
        },
      });
      await this.tagServiceRevenue(db, tx.id, abs);
    });
  }

  /**
   * Manual partial / multi allocation: settle one credit across one or more
   * installments with explicit amounts — a lump PIX paying several parcelas, or
   * a partial payment of a single installment. The auto path stays conservative
   * (exact-value only); this is the operator's escape hatch for everything else.
   *
   * Each allocation accrues onto the installment's paidAmount; the installment
   * flips to PAID once fully covered, otherwise stays open (rendered as
   * PARTIALLY_RECEIVED). The credit is RECONCILED when fully allocated, else PARTIAL.
   */
  async allocateInflow(
    transactionId: string,
    allocations: { installmentId: string; amount: number }[],
    userId?: string,
  ) {
    if (!allocations?.length) throw new BadRequestException('Informe ao menos uma alocação.');

    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: { id: true, postedAt: true, amount: true, type: true },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada.');
    if (tx.type !== 'CREDIT') throw new BadRequestException('Conciliação de entrada requer um crédito.');

    const creditAbs = new Decimal(Math.abs(Number(tx.amount)));
    const totalAlloc = allocations.reduce((s, a) => s.add(new Decimal(a.amount)), new Decimal(0));
    if (totalAlloc.lte(0)) throw new BadRequestException('Valor alocado deve ser maior que zero.');
    if (totalAlloc.gt(creditAbs.add(AMOUNT_TOLERANCE))) {
      throw new BadRequestException('A soma das alocações excede o valor do crédito.');
    }

    // Validate every installment up front (exists, open, unmatched, amount fits).
    const ids = allocations.map(a => a.installmentId);
    const installments = await this.prisma.installment.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        amount: true,
        paidAmount: true,
        invoiceId: true,
        status: true,
      },
    });
    const byId = new Map(installments.map(i => [i.id, i]));
    for (const a of allocations) {
      const inst = byId.get(a.installmentId);
      if (!inst) throw new NotFoundException('Parcela a receber não encontrada.');
      // Allow topping up a partially-allocated installment; only a fully
      // settled (PAID) parcela is off-limits. The remaining-balance check below
      // (computed from paidAmount) prevents over-allocation.
      if (inst.status === 'PAID') {
        throw new BadRequestException('Uma das parcelas já está totalmente conciliada.');
      }
      const remaining = new Decimal(inst.amount).sub(inst.paidAmount ?? new Decimal(0));
      if (new Decimal(a.amount).lte(0)) throw new BadRequestException('Cada alocação deve ser positiva.');
      if (new Decimal(a.amount).gt(remaining.add(AMOUNT_TOLERANCE))) {
        throw new BadRequestException('Alocação excede o saldo em aberto da parcela.');
      }
    }

    const invoiceIds = new Set<string>();
    await this.prisma.$transaction(async db => {
      for (const a of allocations) {
        const inst = byId.get(a.installmentId)!;
        const newPaid = new Decimal(inst.paidAmount ?? 0).add(new Decimal(a.amount));
        const fullyPaid = newPaid.gte(new Decimal(inst.amount).sub(AMOUNT_TOLERANCE));
        await db.installment.update({
          where: { id: inst.id },
          data: {
            paidAmount: newPaid,
            status: fullyPaid ? 'PAID' : inst.status,
            paidAt: fullyPaid ? tx.postedAt : null,
          },
        });
        await db.reconciliationMatch.create({
          data: {
            transactionId: tx.id,
            installmentId: inst.id,
            allocatedAmount: new Decimal(a.amount),
            matchType: ReconciliationMatchType.MANUAL,
            confidenceScore: 100,
            matchedByUserId: userId ?? null,
          },
        });
        if (inst.invoiceId) invoiceIds.add(inst.invoiceId);
      }
      for (const invoiceId of invoiceIds) await this.recalcInvoice(db, invoiceId);
      const fullyAllocated = totalAlloc.gte(creditAbs.sub(AMOUNT_TOLERANCE));
      await db.bankTransaction.update({
        where: { id: tx.id },
        data: {
          reconciliationStatus: fullyAllocated ? ReconciliationStatus.RECONCILED : ReconciliationStatus.PARTIAL,
          reconciliationSource: ReconciliationSource.MANUAL,
          topMatchScore: null,
        },
      });
      await this.tagServiceRevenue(db, tx.id, totalAlloc);
    });

    // Cascade by installment so customerConfig/externalOperation-anchored
    // receivables (no invoice) also flow up to their source-entity status.
    for (const a of allocations) {
      await this.cascadeService.cascadeFromInstallment(a.installmentId).catch(() => undefined);
    }
    return { success: true, message: 'Recebimento alocado com sucesso.' };
  }

  /** Reverse an inflow match (mirrors the saída unmatch). Two shapes:
   *  - Direct installment match (PIX/TED): reopen the installment + recompute the
   *    invoice (the match itself is what marked it received).
   *  - Boleto-bridge match (OFX credit ↔ bankSlip, installmentId null): the boleto
   *    was settled by the Sicredi webhook independently, so unlinking only detaches
   *    the bank line (clear bankSlipId) — the installment stays PAID.
   *  Either way the transaction goes back to PENDING and its service-revenue tag drops. */
  async unmatchInflow(transactionId: string) {
    const matches = await this.prisma.reconciliationMatch.findMany({
      where: { transactionId, reversedAt: null, installmentId: { not: null } },
      select: { id: true, installmentId: true },
    });
    // Boleto-bridge links (credit ↔ bankSlip, no installmentId) — detached, not reopened.
    const bridgeMatches = await this.prisma.reconciliationMatch.findMany({
      where: { transactionId, reversedAt: null, installmentId: null, bankSlipId: { not: null } },
      select: { id: true },
    });
    if (matches.length === 0 && bridgeMatches.length === 0) {
      throw new BadRequestException('Nenhuma conciliação de entrada para reverter.');
    }

    const now = new Date();
    await this.prisma.$transaction(async db => {
      // Delete this transaction's matches first (NOT soft-reverse): the
      // (transactionId, installmentId) unique index counts reversed rows, so
      // soft-reversing would 500 when the operator re-matches the same credit to
      // the same installment after fixing a mistake. Hard delete mirrors the
      // saída unmatch and frees the slot. Each affected installment's paidAmount
      // is then recomputed from its remaining matches, so a credit that only
      // partially paid an installment leaves the other credits' shares intact.
      await db.reconciliationMatch.deleteMany({
        where: { id: { in: [...matches.map(m => m.id), ...bridgeMatches.map(m => m.id)] } },
      });

      const installmentIds = [...new Set(matches.map(m => m.installmentId!).filter(Boolean))];
      for (const installmentId of installmentIds) {
        const inst = await db.installment.findUnique({
          where: { id: installmentId },
          select: { id: true, amount: true, dueDate: true, invoiceId: true },
        });
        if (!inst) continue;
        const remaining = await db.reconciliationMatch.findMany({
          where: { installmentId, reversedAt: null },
          select: { allocatedAmount: true },
        });
        const paid = remaining.reduce((s, r) => s.add(r.allocatedAmount), new Decimal(0));
        const fullyPaid = paid.gte(new Decimal(inst.amount).sub(AMOUNT_TOLERANCE));
        await db.installment.update({
          where: { id: installmentId },
          data: {
            paidAmount: paid,
            status: fullyPaid ? 'PAID' : inst.dueDate < now ? 'OVERDUE' : 'PENDING',
            paidAt: fullyPaid ? inst.dueDate : null,
          },
        });
        if (inst.invoiceId) {
          await this.recalcInvoice(db, inst.invoiceId);
        }
      }
      await this.untagServiceRevenue(db, transactionId);

      await db.bankTransaction.update({
        where: { id: transactionId },
        data: {
          reconciliationStatus: ReconciliationStatus.PENDING,
          reconciliationSource: null,
          // Detach the boleto bridge link too (no-op for direct installment matches,
          // whose transactions never carry a bankSlipId).
          bankSlipId: null,
        },
      });
    });

    // Cascade by installment so non-invoice (customerConfig/externalOperation)
    // receivables reopen their source-entity status too.
    for (const installmentId of [...new Set(matches.map(m => m.installmentId!).filter(Boolean))]) {
      await this.cascadeService.cascadeFromInstallment(installmentId).catch(() => undefined);
    }
    return { success: true, message: 'Conciliação de entrada revertida.' };
  }

  // ---------------------------------------------------------------------------
  // Shared settlement (mirror of the Sicredi webhook's liquidation cascade)
  // ---------------------------------------------------------------------------

  private async settleInstallment(
    tx: { id: string; postedAt: Date; amount: Prisma.Decimal | number },
    installmentId: string,
    source: ReconciliationSource,
    userId?: string,
    confidence?: number,
  ): Promise<void> {
    const abs = new Decimal(Math.abs(Number(tx.amount)));
    let invoiceId: string | null = null;

    await this.prisma.$transaction(async db => {
      const installment = await db.installment.findUniqueOrThrow({
        where: { id: installmentId },
        select: { id: true, amount: true, invoiceId: true },
      });
      invoiceId = installment.invoiceId;

      await db.installment.update({
        where: { id: installmentId },
        data: {
          status: 'PAID',
          paidAmount: installment.amount,
          paidAt: tx.postedAt,
        },
      });

      await db.reconciliationMatch.create({
        data: {
          transactionId: tx.id,
          installmentId,
          allocatedAmount: abs,
          matchType: source === ReconciliationSource.MANUAL ? ReconciliationMatchType.MANUAL : ReconciliationMatchType.VALUE_DATE,
          confidenceScore: source === ReconciliationSource.MANUAL ? 100 : (confidence ?? 95),
          matchedByUserId: userId ?? null,
        },
      });

      await db.bankTransaction.update({
        where: { id: tx.id },
        data: {
          reconciliationStatus: ReconciliationStatus.RECONCILED,
          reconciliationSource: source,
          topMatchScore: null,
        },
      });

      await this.tagServiceRevenue(db, tx.id, abs);

      if (invoiceId) await this.recalcInvoice(db, invoiceId);
    });

    // Cascade source-entity status outside the transaction (same as the webhook).
    // Cascade by installment, not invoice: non-boleto receivables can hang
    // directly off a customerConfig/externalOperation with no invoice.
    await this.cascadeService.cascadeFromInstallment(installmentId).catch(() => undefined);
  }

  /** Recompute an invoice's paidAmount + status from its installments. Copied
   *  from SicrediWebhookService.recalculateInvoice to keep one behavior. */
  private async recalcInvoice(db: Prisma.TransactionClient, invoiceId: string): Promise<void> {
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.status === 'CANCELLED') return;
    const installments = await db.installment.findMany({ where: { invoiceId } });
    const totalPaid = installments.reduce(
      (sum, inst) => sum.add(inst.paidAmount ?? new Decimal(0)),
      new Decimal(0),
    );
    const status = totalPaid.gte(invoice.totalAmount)
      ? 'PAID'
      : totalPaid.gt(0)
        ? 'PARTIALLY_PAID'
        : 'ACTIVE';
    await db.invoice.update({ where: { id: invoiceId }, data: { paidAmount: totalPaid, status } });
  }
}
