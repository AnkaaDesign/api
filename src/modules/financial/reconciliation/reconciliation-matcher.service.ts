import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BankTransactionType,
  FiscalDocumentOperation,
  Prisma,
  ReconciliationAlias,
  ReconciliationAliasSource,
  ReconciliationCategory,
  ReconciliationMatchType,
  ReconciliationSource,
  ReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { MatchCandidate } from './types/reconciliation.types';
import { nameSimilarity } from './text-normalization';
import { ReconciliationAliasService } from './reconciliation-alias.service';
import { isMarketplaceMemo } from './marketplace';

const EXACT_DATE_WINDOW_DAYS = 5;
const VALUE_DATE_WINDOW_DAYS = 3;
const FUZZY_DATE_WINDOW_DAYS = 10;
const BOLETO_BRIDGE_WINDOW_DAYS = 2;
// When CNPJ is known, widen the candidates window significantly — Brazilian B2B
// payment terms routinely run 30-60 days after the NF is issued.
const CNPJ_CANDIDATE_DATE_WINDOW_DAYS = 60;
// Perfect CNPJ + perfect value matches don't need a date constraint — they can
// land months apart from issue date. We still cap at a year to keep the query
// bounded and avoid pulling in fiscal years' worth of unrelated invoices.
const PERFECT_MATCH_DATE_WINDOW_DAYS = 365;
const FUZZY_AMOUNT_TOLERANCE = 0.02; // 2% widening for fee/rounding noise (PIX fees, IOF)
const AUTO_MATCH_SCORE_THRESHOLD = 90;
const AUTO_MATCH_RUNNER_UP_GAP = 8;
// Single tolerance for "perfect" value matches. Covers PIX fees, fiscal
// rounding and small adjustments under one threshold instead of separate
// "cents" and "R$ 1" tiers.
const PERFECT_VALUE_TOLERANCE = 0.5;
// Auto-match candidate query allows up to R$ 1,00 drift so the threshold path
// (score ≥ 90) can still consider candidates slightly outside the perfect
// window when other signals (date, name) compensate.
const AUTO_MATCH_VALUE_TOLERANCE = 1.0;
// Minimum alias confidence required to use a learned (memo → CNPJ) mapping as
// the synthetic counterparty in the auto-match Pass 1. Below this we still
// surface it as a candidate in the manual UI, but we don't auto-confirm.
const AUTO_MATCH_MIN_ALIAS_CONFIDENCE = 0.9;
// Marketplace payments (Mercado Livre/Pago) carry the intermediary's CNPJ, not
// the seller's, so they can only be matched by value. Symmetric window around
// the payment: the seller's NF is usually issued at purchase/shipping time, a
// few days either side of the debit. A NF that lands further out stays PENDING
// and surfaces in the manual UI — never silently mismatched.
const MARKETPLACE_DATE_WINDOW_DAYS = 15;
// Value-only matches carry less corroborating signal than CNPJ+value, so they
// land below the 90 auto-match threshold to read as "auto, but verify" in audit.
const MARKETPLACE_MATCH_CONFIDENCE = 80;
// Company CNPJ fallback, mirrored from SiegXmlParserService so marketplace
// matching scopes to our own purchases even when COMPANY_CNPJ is unset in dev.
const DEFAULT_COMPANY_CNPJ = '13636938000144';

function cnpjRoot(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length === 14 ? digits.slice(0, 8) : null;
}

function valueScore(txAmount: number, docTotal: number): number {
  const diff = Math.abs(txAmount - docTotal);
  const ratio = diff / Math.max(txAmount, docTotal, 0.01);
  if (diff <= PERFECT_VALUE_TOLERANCE) return 35;
  if (ratio <= 0.005) return 25;
  if (ratio <= 0.01) return 18;
  if (ratio <= 0.02) return 10;
  if (ratio <= 0.05) return 4;
  return 0;
}

function dateScore(postedAt: Date, issueDate: Date): number {
  const diff = Math.abs(postedAt.getTime() - issueDate.getTime()) / 86_400_000;
  // Curve tuned for Brazilian B2B payment lag: same-day PIX (≤1d) is rare,
  // 7-15 day boleto windows are routine, 30-60 day duplicatas are common.
  // The pre-tuned curve treated the 10-day window as weak signal (10/20),
  // which made perfect-value + same-root-CNPJ + identical-name cases score
  // 84 and fall short of the 90 auto-match threshold even though they were
  // deterministic in practice.
  if (diff <= 1) return 20;
  if (diff <= 3) return 18;
  if (diff <= 5) return 16;
  if (diff <= 10) return 14;
  if (diff <= 15) return 11;
  if (diff <= 20) return 7;
  if (diff <= 30) return 4;
  if (diff <= 45) return 2;
  return 0;
}

interface CnpjScore {
  score: number;
  exact: boolean;
  rootOnly: boolean;
  side: 'emit' | 'dest' | null;
}

function cnpjScore(
  counterparty: string | null,
  doc: { emitCnpj?: string | null; destCnpj?: string | null; destCpf?: string | null },
): CnpjScore {
  if (!counterparty) return { score: 0, exact: false, rootOnly: false, side: null };
  if (counterparty === doc.emitCnpj) return { score: 30, exact: true, rootOnly: false, side: 'emit' };
  if (counterparty === doc.destCnpj) return { score: 30, exact: true, rootOnly: false, side: 'dest' };
  if (counterparty === doc.destCpf) return { score: 30, exact: true, rootOnly: false, side: 'dest' };
  const root = cnpjRoot(counterparty);
  if (root) {
    // Same parent CNPJ + different filial is a *strong* signal in Brazilian
    // B2B — a holding routinely settles invoices from any of its filiais
    // (e.g. CNPJ 07706588000142 paying for an NF emitted by 07706588000223).
    // Score it 26/30 (was 24) so the perfect-value + identical-name combo
    // can clear the 90 auto-match threshold without slipping false positives.
    if (doc.emitCnpj && cnpjRoot(doc.emitCnpj) === root)
      return { score: 26, exact: false, rootOnly: true, side: 'emit' };
    if (doc.destCnpj && cnpjRoot(doc.destCnpj) === root)
      return { score: 26, exact: false, rootOnly: true, side: 'dest' };
  }
  return { score: 0, exact: false, rootOnly: false, side: null };
}

function nameScore(jaccard: number): number {
  if (jaccard >= 0.8) return 15;
  if (jaccard >= 0.6) return 12;
  if (jaccard >= 0.4) return 8;
  if (jaccard > 0) return 5;
  return 0;
}

interface CandidateScore {
  total: number;
  reasons: string[];
  matchType: ReconciliationMatchType;
  parts: { value: number; date: number; cnpj: number; name: number };
  cnpj: CnpjScore;
  /** Whether the CNPJ contribution came from a learned alias rather than the OFX itself. */
  aliasAssisted: boolean;
}

interface AliasContext {
  /** CNPJ/CPF to use in cnpjScore when the OFX side has none. */
  effectiveCnpj: string;
  /** 0..1 multiplier applied to the CNPJ score component. */
  confidence: number;
  /** Human-readable count for the rationale line. */
  confirmedCount: number;
}

function scoreCandidate(
  tx: { amount: Prisma.Decimal | number; postedAt: Date; counterpartyCnpjCpf: string | null; counterpartyName?: string | null },
  doc: {
    totalValue: Prisma.Decimal | number;
    issueDate: Date;
    emitCnpj?: string | null;
    destCnpj?: string | null;
    destCpf?: string | null;
    emitName?: string | null;
    destName?: string | null;
  },
  alias?: AliasContext | null,
): CandidateScore {
  const absAmount = Math.abs(Number(tx.amount));
  const total = Number(doc.totalValue);
  const v = valueScore(absAmount, total);
  const d = dateScore(tx.postedAt, doc.issueDate);

  // Use the alias-resolved CNPJ only when the OFX itself didn't carry one.
  // OFX-provided CNPJ is always more trustworthy than a learned fingerprint.
  const aliasAssisted = !tx.counterpartyCnpjCpf && !!alias;
  const effectiveCnpj = tx.counterpartyCnpjCpf ?? alias?.effectiveCnpj ?? null;
  const cRaw = cnpjScore(effectiveCnpj, doc);
  const c: CnpjScore = aliasAssisted
    ? { ...cRaw, score: Math.round(cRaw.score * (alias?.confidence ?? 0)) }
    : cRaw;

  const counterName = (tx as any).counterpartyName as string | null | undefined;
  const docName = c.side === 'emit' ? doc.emitName : c.side === 'dest' ? doc.destName : doc.emitName;
  const jacc = nameSimilarity(counterName, docName);
  const n = nameScore(jacc);

  const reasons: string[] = [];
  const diff = Math.abs(absAmount - total);
  if (v === 35) reasons.push(diff <= 0.05 ? 'Valor idêntico' : `Valor equivalente (Δ R$ ${diff.toFixed(2)})`);
  else if (v >= 25) reasons.push(`Valor compatível (Δ R$ ${diff.toFixed(2)})`);
  else if (v > 0) reasons.push(`Valor aproximado (Δ R$ ${diff.toFixed(2)})`);

  const days = Math.round(Math.abs(tx.postedAt.getTime() - doc.issueDate.getTime()) / 86_400_000);
  if (d >= 17) reasons.push(`Datas próximas (${days} ${days === 1 ? 'dia' : 'dias'})`);
  else if (d > 0) reasons.push(`Janela de ${days} dias`);

  if (c.exact) reasons.push(aliasAssisted ? 'CNPJ inferido pelo histórico' : 'CNPJ idêntico');
  else if (c.rootOnly) reasons.push('Mesma empresa (filial diferente)');

  if (aliasAssisted && c.score > 0) {
    reasons.push(`Memo reconhecido (${alias!.confirmedCount}× confirmado)`);
  }

  if (n === 15) reasons.push('Razão social idêntica');
  else if (n >= 8) reasons.push('Razão social compatível');
  else if (n > 0) reasons.push('Razão social parcial');

  // Deterministic-trio floor: when value is cents-exact AND the names align
  // strongly AND the CNPJ is at least a root match, the date essentially
  // doesn't matter — a coincident perfect amount + same name + same corporate
  // group at a different filial happens by accident essentially never. Floor
  // the total at 95 so the auto-match gate fires regardless of payment lag
  // (boleto windows of 30-60 days are routine in BR B2B).
  //
  // SAFETY: the gate also enforces an 8-point runner-up gap. If two NFs from
  // the same supplier tie the trio, both clamp to 95, gap collapses to 0, and
  // no auto-confirm happens — the user is asked to disambiguate.
  const trioCertainty = v === 35 && n === 15 && (c.exact || c.rootOnly);
  const rawTotal = v + d + c.score + n;
  const finalTotal = trioCertainty
    ? Math.max(95, Math.min(100, rawTotal))
    : Math.min(100, rawTotal);
  if (trioCertainty) {
    reasons.push('Combinação determinística (valor + nome + grupo)');
  }

  const matchType: ReconciliationMatchType = c.exact && !aliasAssisted
    ? ReconciliationMatchType.EXACT
    : c.rootOnly
      ? ReconciliationMatchType.VALUE_DATE
      : v >= 25 && d >= 14
        ? ReconciliationMatchType.VALUE_DATE
        : ReconciliationMatchType.FUZZY;

  return {
    total: finalTotal,
    reasons,
    matchType,
    parts: { value: v, date: d, cnpj: c.score, name: n },
    cnpj: c,
    aliasAssisted,
  };
}

interface RawTransaction {
  id: string;
  postedAt: Date;
  amount: Prisma.Decimal;
  type: BankTransactionType;
  counterpartyCnpjCpf: string | null;
  counterpartyName?: string | null;
  memo?: string | null;
  bankSlipId: string | null;
  reconciliationStatus: ReconciliationStatus;
  category: ReconciliationCategory;
}

interface RawDocument {
  id: string;
  totalValue: Prisma.Decimal;
  issueDate: Date;
  emitCnpj: string;
  destCnpj: string | null;
  destCpf: string | null;
  destName: string | null;
  emitName: string | null;
  operationType: FiscalDocumentOperation;
  accessKey: string;
  docType: string;
}

@Injectable()
export class ReconciliationMatcherService {
  private readonly logger = new Logger(ReconciliationMatcherService.name);
  private readonly companyCnpj: string;

  constructor(
    @Inject(forwardRef(() => PrismaService)) private readonly prisma: PrismaService,
    private readonly aliasService: ReconciliationAliasService,
    private readonly config: ConfigService,
  ) {
    this.companyCnpj =
      this.config.get<string>('COMPANY_CNPJ') || DEFAULT_COMPANY_CNPJ;
  }

  /**
   * Re-runs auto-matching for ALL PENDING NF transactions regardless of date.
   * Used by the "Re-executar" global action on the transactions list page.
   * Self-justifying categories (TARIFA, FOLHA, etc.) are never re-matched —
   * they have no FiscalDocument to look up against.
   */
  async matchAll(): Promise<number> {
    const txs = await this.prisma.bankTransaction.findMany({
      where: {
        reconciliationStatus: ReconciliationStatus.PENDING,
        category: ReconciliationCategory.NF,
      },
      select: {
        id: true,
        postedAt: true,
        amount: true,
        type: true,
        counterpartyCnpjCpf: true,
        counterpartyName: true,
        memo: true,
        bankSlipId: true,
        reconciliationStatus: true,
        category: true,
      },
    });
    let matched = 0;
    for (const tx of txs) {
      const result = await this.matchTransaction(tx as RawTransaction);
      if (result) matched += 1;
    }
    return matched;
  }

  /**
   * Re-runs auto-matching for PENDING NF transactions in a date range.
   */
  async matchDateRange(start: Date, end: Date): Promise<number> {
    const txs = await this.prisma.bankTransaction.findMany({
      where: {
        reconciliationStatus: ReconciliationStatus.PENDING,
        category: ReconciliationCategory.NF,
        postedAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        postedAt: true,
        amount: true,
        type: true,
        counterpartyCnpjCpf: true,
        counterpartyName: true,
        memo: true,
        bankSlipId: true,
        reconciliationStatus: true,
        category: true,
      },
    });
    let matched = 0;
    for (const tx of txs) {
      const result = await this.matchTransaction(tx as RawTransaction);
      if (result) matched += 1;
    }
    return matched;
  }

  /**
   * Attempts to auto-match a single transaction. Returns true if a match was
   * created. CONSERVATIVE: only Pass 0 (boleto bridge) and Pass 1 (exact value +
   * CNPJ + date window) auto-confirm. Passes 2/3 are exposed as candidates
   * through `getCandidatesForTransaction()` for the manual-match UI.
   *
   * Only NF-category transactions are matched against FiscalDocument; everything
   * else is already self-justifying (reconciled by the classifier).
   */
  async matchTransaction(tx: RawTransaction): Promise<boolean> {
    if (tx.bankSlipId) return false;
    if (tx.category !== ReconciliationCategory.NF) return false;

    // Pass 0 — Boleto bridge (CREDITs only)
    if (tx.type === BankTransactionType.CREDIT) {
      const bridge = await this.tryBoletoBridge(tx);
      if (bridge) return true;
    }

    // Marketplace payments (Mercado Livre/Pago, etc.) settle through an
    // intermediary, so the memo's CNPJ is never the NF emitter — the CNPJ-based
    // exact pass below can't ever match them. Match on value alone instead,
    // gated by uniqueness. This is a terminal pass: if it can't find a single
    // unambiguous purchase, running tryExactMatch with the intermediary CNPJ
    // would only waste a query (and risk an accidental hit), so we stop here.
    if (tx.type === BankTransactionType.DEBIT && isMarketplaceMemo(tx.memo)) {
      return this.tryMarketplaceValueMatch(tx);
    }

    // Pass 1 — Exact (value + counterparty CNPJ + date ±5d)
    const exact = await this.tryExactMatch(tx);
    if (exact) return true;

    return false;
  }

  /**
   * Returns candidate fiscal documents for the manual-match UI. Used by Pass 2/3
   * lookup (lower-confidence suggestions) without persisting speculative matches.
   *
   * Strategy:
   *   1. Skip entirely for tax/fee transactions (DARF, IOF, TARIFA) — they
   *      never match an NFe and surfacing candidates is noise.
   *   2. Prefer documents whose CNPJ matches the extracted counterparty.
   *   3. If no CNPJ matches, fall back to value+date proximity.
   */
  async getCandidatesForTransaction(
    transactionId: string,
    options: { dateWindowDays?: number; amountTolerance?: number } = {},
  ): Promise<MatchCandidate[]> {
    const dateWindow = options.dateWindowDays ?? FUZZY_DATE_WINDOW_DAYS;
    const amountTol = options.amountTolerance ?? FUZZY_AMOUNT_TOLERANCE;

    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        postedAt: true,
        amount: true,
        type: true,
        counterpartyCnpjCpf: true,
        counterpartyName: true,
        memo: true,
        subtype: true,
      },
    });
    if (!tx) return [];

    // Tax/fee transactions have no meaningful NFe match — return empty.
    const memoUpper = (tx.memo || '').toUpperCase();
    const isLikelyTaxOrFee =
      /DARF|ARRECADAC|TRIBUTO|IMPOSTO|TARIFA|TAR\.BANC|TAR BANC|\bIOF\b/.test(memoUpper) ||
      tx.subtype === 'TARIFA' ||
      tx.subtype === 'IOF';
    if (isLikelyTaxOrFee) return [];

    const absAmount = Math.abs(Number(tx.amount));
    const minAmount = absAmount * (1 - amountTol);
    const maxAmount = absAmount * (1 + amountTol);
    const dateLower = new Date(tx.postedAt.getTime() - dateWindow * 86_400_000);
    const dateUpper = new Date(tx.postedAt.getTime() + dateWindow * 86_400_000);

    // Marketplace memos carry the payment intermediary's CNPJ, which never
    // matches the NF emitter — so ignore CNPJ entirely (both the OFX one and any
    // learned alias) and let candidate lookup fall through to value+date
    // proximity, mirroring the value-only auto pass.
    const marketplace = isMarketplaceMemo(tx.memo);

    // Manual UI: consult the alias even at lower confidence — the user is in
    // the loop and we want to surface plausible candidates aggressively. The
    // confidence factor still reduces the score so a weakly-attested alias
    // doesn't pretend to be a confirmed CNPJ match.
    let aliasContext: AliasContext | null = null;
    if (!tx.counterpartyCnpjCpf && !marketplace) {
      const alias = await this.aliasService.resolve(tx.memo ?? null, tx.type);
      if (alias) {
        const confidence = this.aliasService.aliasConfidence(alias);
        if (confidence > 0) {
          aliasContext = {
            effectiveCnpj: alias.counterpartyCnpjCpf,
            confidence,
            confirmedCount: alias.confirmedCount,
          };
        }
      }
    }

    const counterparty = marketplace
      ? null
      : tx.counterpartyCnpjCpf || aliasContext?.effectiveCnpj || null;
    const root = cnpjRoot(counterparty);

    const baseWhere: Prisma.FiscalDocumentWhereInput = {
      totalValue: { gte: minAmount, lte: maxAmount },
      issueDate: { gte: dateLower, lte: dateUpper },
      status: 'AUTHORIZED',
      matches: { none: {} },
    };

    const select = {
      id: true,
      accessKey: true,
      docType: true,
      issueDate: true,
      totalValue: true,
      emitCnpj: true,
      emitName: true,
      destCnpj: true,
      destName: true,
      destCpf: true,
      operationType: true,
    } satisfies Prisma.FiscalDocumentSelect;

    // First pass: CNPJ-scoped candidates with a wide date window.
    // Brazilian B2B payment terms routinely run 30-60 days after the NF is issued,
    // so matching requires CNPJ as the primary signal — value+date alone is insufficient.
    // We skip the value filter here and let the scorer rank by value proximity.
    let docs: any[] = [];
    if (counterparty) {
      const wideLower = new Date(tx.postedAt.getTime() - CNPJ_CANDIDATE_DATE_WINDOW_DAYS * 86_400_000);
      const wideUpper = new Date(tx.postedAt.getTime() + CNPJ_CANDIDATE_DATE_WINDOW_DAYS * 86_400_000);
      docs = await this.prisma.fiscalDocument.findMany({
        where: {
          status: 'AUTHORIZED',
          matches: { none: {} },
          issueDate: { gte: wideLower, lte: wideUpper },
          OR: [
            { emitCnpj: counterparty },
            { destCnpj: counterparty },
            { destCpf: counterparty },
            ...(root
              ? [
                  { emitCnpj: { startsWith: root } } as Prisma.FiscalDocumentWhereInput,
                  { destCnpj: { startsWith: root } } as Prisma.FiscalDocumentWhereInput,
                ]
              : []),
          ],
        },
        orderBy: { issueDate: 'desc' },
        take: 30,
        select,
      });
    }

    // Fallback: value+date proximity when CNPJ yielded nothing (no CNPJ on transaction
    // or no matching docs found by CNPJ in the wider window).
    if (docs.length === 0) {
      docs = await this.prisma.fiscalDocument.findMany({
        where: baseWhere,
        orderBy: { issueDate: 'desc' },
        take: 50,
        select,
      });
    }

    const scored = docs
      .map(doc => ({ doc, score: scoreCandidate(tx, doc, aliasContext) }))
      .sort((a, b) => b.score.total - a.score.total);

    return scored.map(({ doc, score }) => ({
      fiscalDocumentId: doc.id,
      accessKey: doc.accessKey,
      docType: doc.docType,
      issueDate: doc.issueDate,
      totalValue: Number(doc.totalValue),
      emitCnpj: doc.emitCnpj,
      emitName: doc.emitName,
      destCnpj: doc.destCnpj,
      destName: doc.destName,
      confidence: score.total,
      matchType: score.matchType,
      rationale: score.reasons.join(' • ') || 'Aproximação por valor/data',
    }));
  }

  private async tryBoletoBridge(tx: RawTransaction): Promise<boolean> {
    const absAmount = Math.abs(Number(tx.amount));
    const lower = new Date(tx.postedAt.getTime() - BOLETO_BRIDGE_WINDOW_DAYS * 86_400_000);
    const upper = new Date(tx.postedAt.getTime() + BOLETO_BRIDGE_WINDOW_DAYS * 86_400_000);

    const candidates = await this.prisma.bankSlip.findMany({
      where: {
        status: 'PAID',
        paidAt: { gte: lower, lte: upper },
        paidAmount: { gte: absAmount - 0.05, lte: absAmount + 0.05 },
        transactions: { none: {} }, // not already linked
      },
      include: {
        installment: {
          include: {
            invoice: {
              include: { nfseDocuments: true },
            },
          },
        },
      },
    });

    if (candidates.length !== 1) return false;
    const slip = candidates[0];

    await this.prisma.$transaction(async tx2 => {
      await tx2.bankTransaction.update({
        where: { id: tx.id },
        data: {
          bankSlipId: slip.id,
          reconciliationStatus: ReconciliationStatus.RECONCILED,
          reconciliationSource: ReconciliationSource.AUTO,
          category: ReconciliationCategory.NF,
        },
      });
      await tx2.reconciliationMatch.create({
        data: {
          transactionId: tx.id,
          bankSlipId: slip.id,
          allocatedAmount: absAmount,
          matchType: ReconciliationMatchType.BANK_SLIP_BRIDGE,
          confidenceScore: 100,
          notes: `Pareamento automático com boleto ${slip.nossoNumero}`,
        },
      });

      // Forward link to NFSe (if emitted and present in FiscalDocument)
      const nfseDoc = slip.installment.invoice?.nfseDocuments?.[0];
      if (nfseDoc?.nfseNumber) {
        const synthKey = await this.findNfseAccessKeyForInvoice(nfseDoc.id);
        if (synthKey) {
          await tx2.reconciliationMatch
            .create({
              data: {
                transactionId: tx.id,
                fiscalDocumentId: synthKey,
                allocatedAmount: absAmount,
                matchType: ReconciliationMatchType.BANK_SLIP_BRIDGE,
                confidenceScore: 100,
                notes: 'Encadeamento boleto → NFSe emitida',
              },
            })
            .catch(() => undefined);
        }
      }
    });

    return true;
  }

  private async findNfseAccessKeyForInvoice(_nfseDocumentId: string): Promise<string | null> {
    // We do not currently have a stable join from NfseDocument to FiscalDocument.
    // Future enhancement: store the access key on NfseDocument when emitted.
    return null;
  }

  private async tryExactMatch(tx: RawTransaction): Promise<boolean> {
    // Resolve a learned alias upfront so we can both widen the candidate filter
    // and feed it into scoreCandidate. The alias is only used when the OFX side
    // has no parseable CNPJ — that's the case where this whole mechanism pays.
    let alias: ReconciliationAlias | null = null;
    let aliasContext: AliasContext | null = null;
    if (!tx.counterpartyCnpjCpf) {
      alias = await this.aliasService.resolve(tx.memo ?? null, tx.type);
      if (alias) {
        const confidence = this.aliasService.aliasConfidence(alias);
        // Auto-match path is the strict one — only highly-confirmed aliases
        // (manual or seeded) feed in here. Lower-confidence aliases still
        // surface as candidates in the manual UI.
        if (confidence >= AUTO_MATCH_MIN_ALIAS_CONFIDENCE) {
          aliasContext = {
            effectiveCnpj: alias.counterpartyCnpjCpf,
            confidence,
            confirmedCount: alias.confirmedCount,
          };
        }
      }
    }

    const effectiveCnpj = tx.counterpartyCnpjCpf ?? aliasContext?.effectiveCnpj ?? null;
    if (!effectiveCnpj) return false;

    const absAmount = Math.abs(Number(tx.amount));
    // Wide date window: CNPJ + value perfect matches need to land regardless of
    // payment lag. The threshold path further down still relies on date proximity
    // to score, so widening here is safe — it just enables the perfect-match
    // shortcut to find late-arriving candidates.
    const lower = new Date(tx.postedAt.getTime() - PERFECT_MATCH_DATE_WINDOW_DAYS * 86_400_000);
    const upper = new Date(tx.postedAt.getTime() + PERFECT_MATCH_DATE_WINDOW_DAYS * 86_400_000);
    const root = cnpjRoot(effectiveCnpj);

    // Accept centavos drift (PIX fees, rounding) and CNPJ-root match (same parent
    // company, different filial). The score gate is what gives us the safety:
    // a wider DB net here costs almost nothing, the scorer rejects bad hits.
    const cnpjFilter: Prisma.FiscalDocumentWhereInput = {
      OR: [
        { emitCnpj: effectiveCnpj },
        { destCnpj: effectiveCnpj },
        { destCpf: effectiveCnpj },
        ...(root
          ? [
              { emitCnpj: { startsWith: root } } as Prisma.FiscalDocumentWhereInput,
              { destCnpj: { startsWith: root } } as Prisma.FiscalDocumentWhereInput,
            ]
          : []),
      ],
    };

    const candidates = await this.prisma.fiscalDocument.findMany({
      where: {
        status: 'AUTHORIZED',
        totalValue: {
          gte: absAmount - AUTO_MATCH_VALUE_TOLERANCE,
          lte: absAmount + AUTO_MATCH_VALUE_TOLERANCE,
        },
        issueDate: { gte: lower, lte: upper },
        ...cnpjFilter,
        matches: { none: {} },
      },
      take: 30,
      select: {
        id: true,
        totalValue: true,
        issueDate: true,
        emitCnpj: true,
        destCnpj: true,
        destCpf: true,
        emitName: true,
        destName: true,
      },
    });

    if (candidates.length === 0) return false;

    const scored = candidates
      .map(doc => ({ doc, score: scoreCandidate(tx, doc, aliasContext) }))
      .sort((a, b) => {
        if (b.score.total !== a.score.total) return b.score.total - a.score.total;
        // Tiebreaker: closer issue date wins when total scores are equal.
        const aDays = Math.abs(tx.postedAt.getTime() - a.doc.issueDate.getTime());
        const bDays = Math.abs(tx.postedAt.getTime() - b.doc.issueDate.getTime());
        return aDays - bDays;
      });

    const best = scored[0];
    const runnerUp = scored[1];

    // Path A — Strong-signal auto-match. Two flavors:
    //   (i)  Value perfect (Δ ≤ R$ 0,50) + CNPJ exact — date is irrelevant
    //        when both align; B2B payments routinely lag weeks behind NF
    //        issue. CNPJ may come from the OFX memo OR from a high-confidence
    //        learned alias (gated by AUTO_MATCH_MIN_ALIAS_CONFIDENCE above).
    //   (ii) Value perfect + CNPJ root match + name ≥ 0.8 ("trio") — same
    //        corporate group at a different filial paying for a same-name
    //        supplier with the exact amount is also deterministic.
    //
    // Past-dated guard: best.issueDate must be on/before payment (5d buffer
    // for OFX timestamp jitter). Future-dated NFs almost never represent the
    // NF this debit is paying for — keep them visible as candidates but never
    // auto-confirm them.
    const isStrongMatch = (s: CandidateScore): boolean =>
      s.parts.value === 35 &&
      (s.cnpj.exact || (s.cnpj.rootOnly && s.parts.name === 15));

    const PAST_DATED_BUFFER_MS = 5 * 86_400_000;
    const isPastDated = (issueDate: Date): boolean =>
      issueDate.getTime() <= tx.postedAt.getTime() + PAST_DATED_BUFFER_MS;

    const isBestPerfect = isStrongMatch(best.score) && isPastDated(best.doc.issueDate);
    const isRunnerUpPerfect =
      !!runnerUp &&
      isStrongMatch(runnerUp.score) &&
      isPastDated(runnerUp.doc.issueDate);

    let acceptPerfect = isBestPerfect && !isRunnerUpPerfect;

    // Multiple equally-strong candidates (recurring weekly/monthly invoices
    // for the same amount): disambiguate by date proximity. Require best to
    // be at least 3 days closer to the payment than the runner-up — enough
    // to differentiate weekly billers (Kurica, COPEL) without picking the
    // wrong NF when two are issued within 48h of each other.
    const PROXIMITY_GAP_DAYS = 3;
    let perfectChoiceReason: string | null = null;
    if (isBestPerfect && isRunnerUpPerfect) {
      const bestDays =
        Math.abs(tx.postedAt.getTime() - best.doc.issueDate.getTime()) / 86_400_000;
      const runnerDays =
        Math.abs(tx.postedAt.getTime() - runnerUp!.doc.issueDate.getTime()) /
        86_400_000;
      if (runnerDays - bestDays >= PROXIMITY_GAP_DAYS) {
        acceptPerfect = true;
        perfectChoiceReason = `Nota mais próxima da data do pagamento (${Math.round(
          bestDays,
        )}d contra ${Math.round(runnerDays)}d da segunda candidata)`;
      }
    }

    // Path B — Generic threshold: total score ≥ 90 with a clear runner-up gap.
    // Covers candidates outside the perfect window where name+date+cnpj
    // collectively reach a high score.
    const acceptThreshold =
      best.score.total >= AUTO_MATCH_SCORE_THRESHOLD &&
      (!runnerUp || best.score.total - runnerUp.score.total >= AUTO_MATCH_RUNNER_UP_GAP);

    if (!acceptPerfect && !acceptThreshold) return false;

    // Surface which path accepted the match so audit can tell them apart.
    const perfectPrefix: string[] = [];
    if (acceptPerfect && !acceptThreshold) {
      perfectPrefix.push(
        aliasContext
          ? 'CNPJ aprendido (alias) + valor equivalente (data irrelevante)'
          : 'CNPJ e valor equivalentes (data irrelevante)',
      );
    }
    if (perfectChoiceReason) {
      perfectPrefix.push(perfectChoiceReason);
    }
    const noteReasons = [...perfectPrefix, ...best.score.reasons];

    await this.prisma.$transaction(async tx2 => {
      await tx2.bankTransaction.update({
        where: { id: tx.id },
        data: {
          reconciliationStatus: ReconciliationStatus.RECONCILED,
          reconciliationSource: ReconciliationSource.AUTO,
        },
      });
      await tx2.reconciliationMatch.create({
        data: {
          transactionId: tx.id,
          fiscalDocumentId: best.doc.id,
          allocatedAmount: absAmount,
          matchType: best.score.matchType,
          confidenceScore: best.score.total,
          notes: `Pareamento automático: ${noteReasons.join(' • ')}`,
        },
      });

      // Capture the (memo → counterparty) mapping so the next month's tx with
      // the same memo benefits even when its OFX side carries a CNPJ today.
      // Source is always AUTO_MATCH here; manual confirmations come through
      // ReconciliationService.manualMatch().
      if (tx.counterpartyCnpjCpf) {
        await this.aliasService
          .recordMatchSuccess({
            memo: tx.memo ?? null,
            txType: tx.type,
            counterpartyCnpjCpf: tx.counterpartyCnpjCpf,
            source: ReconciliationAliasSource.AUTO_MATCH,
            prismaTx: tx2,
          })
          .catch(err =>
            this.logger.warn(`Alias capture failed in tryExactMatch: ${err}`),
          );
      }
    });

    return true;
  }

  /**
   * Value-only auto-match for marketplace payments (Mercado Livre/Pago, etc.).
   *
   * These settle to a payment intermediary, so the memo CNPJ never matches the
   * NF emitter — the only link is the amount. We compensate for the missing
   * CNPJ/name signals with three hard constraints:
   *   1. Scope to our own purchases: AUTHORIZED, ENTRADA, destCnpj = COMPANY_CNPJ.
   *      This makes it impossible to ever match one of our outgoing sales (SAIDA)
   *      that happens to share the value.
   *   2. Value within PERFECT_VALUE_TOLERANCE (absorbs centavo rounding).
   *   3. Exactly one unmatched candidate in the date window. Two+ equal-value
   *      purchases are ambiguous on value alone, so we defer to manual review
   *      rather than guess.
   *
   * Returns true only when a single unambiguous purchase is found and linked.
   */
  private async tryMarketplaceValueMatch(tx: RawTransaction): Promise<boolean> {
    const absAmount = Math.abs(Number(tx.amount));
    const lower = new Date(tx.postedAt.getTime() - MARKETPLACE_DATE_WINDOW_DAYS * 86_400_000);
    const upper = new Date(tx.postedAt.getTime() + MARKETPLACE_DATE_WINDOW_DAYS * 86_400_000);

    const candidates = await this.prisma.fiscalDocument.findMany({
      where: {
        status: 'AUTHORIZED',
        operationType: FiscalDocumentOperation.ENTRADA,
        destCnpj: this.companyCnpj,
        totalValue: {
          gte: absAmount - PERFECT_VALUE_TOLERANCE,
          lte: absAmount + PERFECT_VALUE_TOLERANCE,
        },
        issueDate: { gte: lower, lte: upper },
        matches: { none: {} },
      },
      // Pull a couple extra so we can detect (and refuse) ambiguity.
      take: 5,
      select: {
        id: true,
        totalValue: true,
        issueDate: true,
        emitCnpj: true,
        emitName: true,
      },
    });

    if (candidates.length === 0) return false;

    // Ambiguity guard: value is the only signal here, so more than one
    // equal-value purchase in the window can't be disambiguated safely. Leave
    // it PENDING — getCandidatesForTransaction() surfaces all of them for the
    // user to pick from in the manual UI.
    if (candidates.length > 1) {
      this.logger.debug(
        `Marketplace tx ${tx.id}: ${candidates.length} equal-value purchases in window — deferring to manual match`,
      );
      return false;
    }

    const doc = candidates[0];
    const diff = Math.abs(absAmount - Number(doc.totalValue));
    const days = Math.round(
      Math.abs(tx.postedAt.getTime() - doc.issueDate.getTime()) / 86_400_000,
    );

    await this.prisma.$transaction(async tx2 => {
      await tx2.bankTransaction.update({
        where: { id: tx.id },
        data: {
          reconciliationStatus: ReconciliationStatus.RECONCILED,
          reconciliationSource: ReconciliationSource.AUTO,
        },
      });
      await tx2.reconciliationMatch.create({
        data: {
          transactionId: tx.id,
          fiscalDocumentId: doc.id,
          allocatedAmount: absAmount,
          matchType: ReconciliationMatchType.VALUE_DATE,
          confidenceScore: MARKETPLACE_MATCH_CONFIDENCE,
          notes: `Pareamento marketplace por valor${
            diff <= 0.05 ? ' idêntico' : ` equivalente (Δ R$ ${diff.toFixed(2)})`
          } • compra única no período (${days} ${days === 1 ? 'dia' : 'dias'}) • ${
            doc.emitName ?? doc.emitCnpj
          }`,
        },
      });
    });

    return true;
  }

  /**
   * Bridges Sicredi's existing boleto reconciliation to the OFX universe.
   * When the Sicredi webhook marks a BankSlip PAID, this handler links the
   * already-imported BankTransaction (if any) to that BankSlip.
   */
  @OnEvent('banking.bankslip.paid')
  async onBankSlipPaid(payload: {
    bankSlipId: string;
    paidAt: Date | string;
    paidAmount: number;
  }): Promise<void> {
    try {
      const paidAt = new Date(payload.paidAt);
      const lower = new Date(paidAt.getTime() - BOLETO_BRIDGE_WINDOW_DAYS * 86_400_000);
      const upper = new Date(paidAt.getTime() + BOLETO_BRIDGE_WINDOW_DAYS * 86_400_000);

      const candidates = await this.prisma.bankTransaction.findMany({
        where: {
          bankSlipId: null,
          reconciliationStatus: ReconciliationStatus.PENDING,
          type: BankTransactionType.CREDIT,
          postedAt: { gte: lower, lte: upper },
          amount: { gte: payload.paidAmount - 0.05, lte: payload.paidAmount + 0.05 },
        },
        select: { id: true },
      });
      if (candidates.length !== 1) return;
      const tx = candidates[0];
      await this.prisma.$transaction(async tx2 => {
        await tx2.bankTransaction.update({
          where: { id: tx.id },
          data: {
            bankSlipId: payload.bankSlipId,
            reconciliationStatus: ReconciliationStatus.RECONCILED,
            reconciliationSource: ReconciliationSource.AUTO,
            category: ReconciliationCategory.NF,
          },
        });
        await tx2.reconciliationMatch.create({
          data: {
            transactionId: tx.id,
            bankSlipId: payload.bankSlipId,
            allocatedAmount: payload.paidAmount,
            matchType: ReconciliationMatchType.BANK_SLIP_BRIDGE,
            confidenceScore: 100,
            notes: 'Pareamento via evento bankslip.paid',
          },
        });
      });
    } catch (err) {
      this.logger.warn(`Failed to bridge bankslip paid event: ${err}`);
    }
  }
}
