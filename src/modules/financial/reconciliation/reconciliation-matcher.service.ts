import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BankTransactionType,
  FiscalDocumentOperation,
  Prisma,
  ReconciliationAlias,
  ReconciliationAliasSource,
  ReconciliationMatchStatus,
  ReconciliationMatchType,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { MatchCandidate } from './types/reconciliation.types';
import { nameSimilarity } from './text-normalization';
import { ReconciliationAliasService } from './reconciliation-alias.service';

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
  if (diff <= 1) return 20;
  if (diff <= 3) return 17;
  if (diff <= 5) return 14;
  if (diff <= 10) return 10;
  if (diff <= 20) return 5;
  if (diff <= 30) return 2;
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
    if (doc.emitCnpj && cnpjRoot(doc.emitCnpj) === root)
      return { score: 24, exact: false, rootOnly: true, side: 'emit' };
    if (doc.destCnpj && cnpjRoot(doc.destCnpj) === root)
      return { score: 24, exact: false, rootOnly: true, side: 'dest' };
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

  const matchType: ReconciliationMatchType = c.exact && !aliasAssisted
    ? ReconciliationMatchType.EXACT
    : c.rootOnly
      ? ReconciliationMatchType.VALUE_DATE
      : v >= 25 && d >= 14
        ? ReconciliationMatchType.VALUE_DATE
        : ReconciliationMatchType.FUZZY;

  return {
    total: Math.min(100, v + d + c.score + n),
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
  matchStatus: ReconciliationMatchStatus;
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

  constructor(
    @Inject(forwardRef(() => PrismaService)) private readonly prisma: PrismaService,
    private readonly aliasService: ReconciliationAliasService,
  ) {}

  /**
   * Re-runs auto-matching for ALL currently UNMATCHED transactions regardless of date.
   * Used by the "Re-executar" global action on the transactions list page.
   */
  async matchAll(): Promise<number> {
    const txs = await this.prisma.bankTransaction.findMany({
      where: { matchStatus: ReconciliationMatchStatus.UNMATCHED },
      select: {
        id: true,
        postedAt: true,
        amount: true,
        type: true,
        counterpartyCnpjCpf: true,
        counterpartyName: true,
        memo: true,
        bankSlipId: true,
        matchStatus: true,
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
   * Re-runs auto-matching for UNMATCHED transactions in a date range.
   */
  async matchDateRange(start: Date, end: Date): Promise<number> {
    const txs = await this.prisma.bankTransaction.findMany({
      where: {
        matchStatus: ReconciliationMatchStatus.UNMATCHED,
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
        matchStatus: true,
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
   */
  async matchTransaction(tx: RawTransaction): Promise<boolean> {
    if (tx.bankSlipId) return false;

    // Pass 0 — Boleto bridge (CREDITs only)
    if (tx.type === BankTransactionType.CREDIT) {
      const bridge = await this.tryBoletoBridge(tx);
      if (bridge) return true;
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

    // Manual UI: consult the alias even at lower confidence — the user is in
    // the loop and we want to surface plausible candidates aggressively. The
    // confidence factor still reduces the score so a weakly-attested alias
    // doesn't pretend to be a confirmed CNPJ match.
    let aliasContext: AliasContext | null = null;
    if (!tx.counterpartyCnpjCpf) {
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

    const counterparty =
      tx.counterpartyCnpjCpf || aliasContext?.effectiveCnpj || null;
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
          matchStatus: ReconciliationMatchStatus.AUTO_MATCHED,
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

    // Path A — Perfect CNPJ + perfect value (Δ ≤ R$ 0,50).
    // Single unified tolerance: covers PIX fees, fiscal rounding and small
    // adjustments without splitting into "cents" vs "R$ 1" tiers.
    // Date is irrelevant when both signals align: B2B payments routinely
    // settle weeks or months after the NF is issued. The CNPJ may come from
    // the OFX memo directly OR from a learned alias (gated by
    // AUTO_MATCH_MIN_ALIAS_CONFIDENCE above).
    const isBestPerfect =
      best.score.cnpj.exact &&
      best.score.parts.value === 35;
    const isRunnerUpPerfect =
      !!runnerUp &&
      runnerUp.score.cnpj.exact &&
      runnerUp.score.parts.value === 35;

    let acceptPerfect = isBestPerfect && !isRunnerUpPerfect;

    // Multiple equally-perfect candidates (recurring monthly invoices for the
    // same amount): disambiguate by date proximity. 30 days ≈ one billing
    // cycle, so requiring that much separation keeps us from picking the
    // wrong month when two unpaid invoices are close together.
    let perfectChoiceReason: string | null = null;
    if (isBestPerfect && isRunnerUpPerfect) {
      const bestDays =
        Math.abs(tx.postedAt.getTime() - best.doc.issueDate.getTime()) / 86_400_000;
      const runnerDays =
        Math.abs(tx.postedAt.getTime() - runnerUp!.doc.issueDate.getTime()) /
        86_400_000;
      if (runnerDays - bestDays >= 30) {
        acceptPerfect = true;
        perfectChoiceReason = `Nota mais próxima da data do pagamento (${Math.round(
          bestDays,
        )} dias contra ${Math.round(runnerDays)} da segunda candidata)`;
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
        data: { matchStatus: ReconciliationMatchStatus.AUTO_MATCHED },
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
          matchStatus: ReconciliationMatchStatus.UNMATCHED,
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
            matchStatus: ReconciliationMatchStatus.AUTO_MATCHED,
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
