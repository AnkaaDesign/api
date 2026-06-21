import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ReconciliationMatchType,
  ReconciliationSource,
  ReconciliationStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { nameSimilarity } from './text-normalization';

/**
 * SAÍDA confirmation — the outflow analog of ReceivableMatchService.
 *
 * A payable (order installment / order / airbrushing / recurrent occurrence /
 * payroll month) carries an ASSERTION axis (`paidAt` set by a user click) that
 * is independent of the BANK-TRUTH axis. This service closes the gap: it takes
 * DEBIT bank transactions that are still PENDING and confirms (clears) the
 * already-marked-paid payable they correspond to, by writing a
 * ReconciliationMatch on the right anchor (idempotent via the per-anchor unique
 * constraints) and flipping the bank tx to RECONCILED.
 *
 * Conservative by design — it ONLY confirms payables a user has already asserted
 * paid (status PAID with a paidAt). It never auto-marks a never-paid payable
 * (the "Conciliado sem baixa" edge is intentionally out of scope). The match
 * window is anchored on the payable's paidAt, never a blanket lookback, so the
 * first run cannot retroactively confirm months of history.
 *
 * Amount discipline mirrors the receivable side: an exact amount (±tolerance)
 * auto-clears; a drift beyond tolerance still records the match but marks it
 * DISPUTED (note on the match row) instead of silently absorbing the difference.
 */

/** How many days AFTER the asserted paidAt a debit may post and still confirm
 *  it (banks settle PIX/TED same-day, boletos/cards a few days later). */
const CONFIRM_FORWARD_DAYS = 7;
/** Small grace BEFORE paidAt — the bank may debit a day or two before the user
 *  records the payment. */
const CONFIRM_BACKWARD_DAYS = 2;

/** Absolute (R$) and relative tolerance for "the debit equals the asserted
 *  amount". Beyond BOTH → DISPUTED. */
const AMOUNT_TOLERANCE_ABS = 2;
const AMOUNT_TOLERANCE_PCT = 0.005;

type DebitTx = {
  id: string;
  postedAt: Date;
  amount: Prisma.Decimal | number;
  counterpartyName: string | null;
  counterpartyCnpjCpf: string | null;
};

/** A payable already asserted PAID, normalized for matching. The anchor key
 *  identifies which ReconciliationMatch column to write. */
type PaidPayable = {
  anchor:
    | { kind: 'orderInstallment'; id: string }
    | { kind: 'airbrushing'; id: string }
    | { kind: 'recurrentOccurrence'; id: string }
    | { kind: 'payrollMonthSettlement'; id: string };
  /** Asserted paid amount (what we compare the debit against). */
  paidAmount: number;
  paidAt: Date;
  /** Counterparty identity for tie-breaking (supplier CNPJ / painter name). */
  counterpartyName: string | null;
  counterpartyCnpjCpf: string | null;
  label: string;
};

const onlyDigits = (v: string | null | undefined): string => (v || '').replace(/\D/g, '');

@Injectable()
export class PayableMatchService {
  private readonly logger = new Logger(PayableMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public entry points (parity with ReceivableMatchService)
  // ---------------------------------------------------------------------------

  /** Confirm a specific set of debits — used on OFX import so marked-paid items
   *  flip to "conciliado" within seconds of the next upload. */
  async confirmPayablesByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.confirmWhere({ id: { in: ids } });
  }

  /** Confirm debits in a posted-date range — the daily-cron backstop. */
  async confirmPayablesDateRange(start: Date, end: Date): Promise<number> {
    return this.confirmWhere({ postedAt: { gte: start, lte: end } });
  }

  private isEnabled(): boolean {
    // Default-on, mirroring RECONCILIATION_AUTO_MATCH_ENABLED. Set to "false" to
    // suspend the saída confirmation sweep without touching the receivable one.
    // Parsed explicitly so the string "false" actually disables it (env vars are
    // strings; a bare truthiness check would treat "false" as enabled).
    const v = this.config.get<string | boolean>('PAYABLE_AUTO_CONFIRM_ENABLED', true);
    return v !== false && v !== 'false' && v !== '0';
  }

  private isDryRun(): boolean {
    // Default-off. Set to "true" to log what WOULD clear without writing matches.
    const v = this.config.get<string | boolean>('PAYABLE_AUTO_CONFIRM_DRY_RUN', false);
    return v === true || v === 'true' || v === '1';
  }

  private async confirmWhere(extra: Prisma.BankTransactionWhereInput): Promise<number> {
    if (!this.isEnabled()) {
      this.logger.debug('Payable auto-confirm disabled; skipping debit sweep');
      return 0;
    }
    const dryRun = this.isDryRun();

    const debits = await this.prisma.bankTransaction.findMany({
      where: {
        type: 'DEBIT',
        reconciliationStatus: ReconciliationStatus.PENDING,
        ...extra,
      },
      select: {
        id: true,
        postedAt: true,
        amount: true,
        counterpartyName: true,
        counterpartyCnpjCpf: true,
      },
    });

    let confirmed = 0;
    for (const debit of debits) {
      try {
        if (await this.tryConfirmDebit(debit, dryRun)) confirmed += 1;
      } catch (err) {
        this.logger.error(`Payable confirm failed for tx ${debit.id}: ${err}`);
      }
    }
    if (confirmed) {
      this.logger.log(
        `Payable confirm sweep: ${confirmed} debit(s) ${dryRun ? 'WOULD clear (dry-run)' : 'cleared a payable'}`,
      );
    }
    return confirmed;
  }

  // ---------------------------------------------------------------------------
  // Matching
  // ---------------------------------------------------------------------------

  private async tryConfirmDebit(tx: DebitTx, dryRun: boolean): Promise<boolean> {
    // Live status guard — a sibling pass may have reconciled it already.
    const live = await this.prisma.bankTransaction.findUnique({
      where: { id: tx.id },
      select: { reconciliationStatus: true },
    });
    if (!live || live.reconciliationStatus !== ReconciliationStatus.PENDING) return false;

    const abs = Math.abs(Number(tx.amount));
    const candidates = await this.findPaidCandidates(tx, abs);
    if (candidates.length === 0) return false;

    // Score: amount agreement is mandatory for a candidate to even enter the
    // pool (findPaidCandidates already filters by amount window). Disambiguate by
    // counterparty identity + date proximity, and only auto-confirm a unique or
    // clearly-winning candidate (never guess between two equally-good payables).
    const scored = candidates
      .map(c => ({ c, score: this.score(tx, abs, c) }))
      .sort((a, b) => b.score - a.score);

    const [best, runnerUp] = scored;
    const isUnique = scored.length === 1;
    const clearWinner = !runnerUp || best.score - runnerUp.score >= 10;
    if (!isUnique && !clearWinner) {
      this.logger.debug(`Debit ${tx.id} ambiguous (${scored.length} paid candidates); leaving manual`);
      return false;
    }

    const diff = Math.abs(best.c.paidAmount - abs);
    const tolerance = Math.max(AMOUNT_TOLERANCE_ABS, best.c.paidAmount * AMOUNT_TOLERANCE_PCT);
    const disputed = diff > tolerance;

    if (dryRun) {
      this.logger.log(
        `[dry-run] debit ${tx.id} (R$${abs}) → ${best.c.anchor.kind} ${best.c.label}` +
          `${disputed ? ` DISPUTED (asserted R$${best.c.paidAmount})` : ' CLEARED'}`,
      );
      return true;
    }

    await this.writeMatch(tx, best.c, abs, disputed);
    this.logger.log(
      `Debit ${tx.id} ${disputed ? 'DISPUTED-matched' : 'confirmed'} ${best.c.anchor.kind} ${best.c.label}`,
    );
    return true;
  }

  /** Collect every already-PAID payable whose asserted amount is within the
   *  amount window of this debit AND whose paidAt sits in the confirm window
   *  around the debit's postedAt. The paidAt anchoring is the historical-hazard
   *  safety gate: a debit can only confirm a payment asserted at/around it. */
  private async findPaidCandidates(tx: DebitTx, abs: number): Promise<PaidPayable[]> {
    const lowerAmt = abs - Math.max(AMOUNT_TOLERANCE_ABS, abs * AMOUNT_TOLERANCE_PCT);
    const upperAmt = abs + Math.max(AMOUNT_TOLERANCE_ABS, abs * AMOUNT_TOLERANCE_PCT);
    // paidAt window: from (postedAt − forward) to (postedAt + backward), i.e. the
    // payment may have been asserted up to CONFIRM_FORWARD_DAYS BEFORE the debit
    // posts, or up to CONFIRM_BACKWARD_DAYS after it.
    const paidFrom = new Date(tx.postedAt.getTime() - CONFIRM_FORWARD_DAYS * 86_400_000);
    const paidTo = new Date(tx.postedAt.getTime() + CONFIRM_BACKWARD_DAYS * 86_400_000);

    const out: PaidPayable[] = [];

    // --- Order installments (boleto parcelas) marked PAID, not yet cleared ---
    const orderInstallments = await this.prisma.orderInstallment.findMany({
      where: {
        status: 'PAID',
        paidAt: { gte: paidFrom, lte: paidTo },
        amount: { gte: lowerAmt, lte: upperAmt },
        reconciliationMatches: { none: { reversedAt: null } },
      },
      select: {
        id: true,
        amount: true,
        paidAmount: true,
        paidAt: true,
        order: { select: { description: true, supplier: { select: { fantasyName: true, cnpj: true } } } },
      },
      take: 50,
    });
    for (const oi of orderInstallments) {
      if (!oi.paidAt) continue;
      out.push({
        anchor: { kind: 'orderInstallment', id: oi.id },
        paidAmount: oi.paidAmount > 0 ? oi.paidAmount : oi.amount,
        paidAt: oi.paidAt,
        counterpartyName: oi.order?.supplier?.fantasyName ?? null,
        counterpartyCnpjCpf: oi.order?.supplier?.cnpj ?? null,
        label: oi.order?.description ?? oi.id,
      });
    }

    // --- Airbrushing painter payments marked PAID, not yet cleared ---
    const airbrushings = await this.prisma.airbrushing.findMany({
      where: {
        paymentStatus: 'PAID',
        paidAt: { gte: paidFrom, lte: paidTo },
        price: { gte: lowerAmt, lte: upperAmt },
        reconciliationMatches: { none: { reversedAt: null } },
      },
      select: {
        id: true,
        price: true,
        paidAt: true,
        painter: { select: { name: true } },
        task: { select: { name: true } },
      },
      take: 50,
    });
    for (const ab of airbrushings) {
      if (!ab.paidAt || ab.price == null) continue;
      out.push({
        anchor: { kind: 'airbrushing', id: ab.id },
        paidAmount: ab.price,
        paidAt: ab.paidAt,
        counterpartyName: ab.painter?.name ?? null,
        counterpartyCnpjCpf: null,
        label: ab.task?.name ?? ab.id,
      });
    }

    // --- Recurrent-payable occurrences marked PAID, not yet cleared ---
    const occurrences = await this.prisma.recurrentPayableOccurrence.findMany({
      where: {
        status: 'PAID',
        paidAt: { gte: paidFrom, lte: paidTo },
        paidAmount: { gte: lowerAmt, lte: upperAmt },
        reconciliationMatches: { none: { reversedAt: null } },
      },
      select: {
        id: true,
        paidAmount: true,
        paidAt: true,
        recurrentPayable: {
          select: { name: true, payeeName: true, supplier: { select: { fantasyName: true, cnpj: true } } },
        },
      },
      take: 50,
    });
    for (const occ of occurrences) {
      if (!occ.paidAt || occ.paidAmount == null) continue;
      out.push({
        anchor: { kind: 'recurrentOccurrence', id: occ.id },
        paidAmount: Number(occ.paidAmount),
        paidAt: occ.paidAt,
        counterpartyName:
          occ.recurrentPayable?.supplier?.fantasyName ??
          occ.recurrentPayable?.payeeName ??
          occ.recurrentPayable?.name ??
          null,
        counterpartyCnpjCpf: occ.recurrentPayable?.supplier?.cnpj ?? null,
        label: occ.recurrentPayable?.name ?? occ.id,
      });
    }

    // --- Payroll month settlements marked PAID, not yet cleared ---
    const payrolls = await this.prisma.payrollMonthSettlement.findMany({
      where: {
        paidAt: { gte: paidFrom, lte: paidTo },
        amount: { gte: lowerAmt, lte: upperAmt },
        reconciliationMatches: { none: { reversedAt: null } },
      },
      select: { id: true, amount: true, paidAt: true, year: true, month: true },
      take: 50,
    });
    for (const pr of payrolls) {
      if (!pr.paidAt || pr.amount == null) continue;
      out.push({
        anchor: { kind: 'payrollMonthSettlement', id: pr.id },
        paidAmount: Number(pr.amount),
        paidAt: pr.paidAt,
        counterpartyName: 'Folha',
        counterpartyCnpjCpf: null,
        label: `Folha ${pr.year}-${String(pr.month).padStart(2, '0')}`,
      });
    }

    return out;
  }

  /** 0-100 disambiguation score. Amount is already gated by the candidate filter;
   *  here CNPJ identity + name similarity + paidAt↔postedAt proximity break ties. */
  private score(tx: DebitTx, abs: number, c: PaidPayable): number {
    // Amount agreement (max 40) — exact dominates, near degrades.
    const diff = Math.abs(c.paidAmount - abs);
    const tol = Math.max(AMOUNT_TOLERANCE_ABS, c.paidAmount * AMOUNT_TOLERANCE_PCT);
    const amount = diff <= 0.01 ? 40 : diff <= tol ? 30 : 10;

    // Counterparty CNPJ (max 30) — strongest identity signal.
    const txCnpj = onlyDigits(tx.counterpartyCnpjCpf);
    const cCnpj = onlyDigits(c.counterpartyCnpjCpf);
    const cnpj = txCnpj && cCnpj && txCnpj === cCnpj ? 30 : 0;

    // Counterparty name (max 15).
    const sim = nameSimilarity(tx.counterpartyName, c.counterpartyName);
    const name = sim >= 0.8 ? 15 : sim >= 0.5 ? 9 : sim > 0 ? 4 : 0;

    // Date proximity (max 15).
    const days = Math.abs(c.paidAt.getTime() - tx.postedAt.getTime()) / 86_400_000;
    const date = days <= 1 ? 15 : days <= 3 ? 11 : days <= 5 ? 7 : days <= 7 ? 4 : 1;

    return Math.min(100, amount + cnpj + name + date);
  }

  /** Persist the clearance: create the anchored ReconciliationMatch (idempotent
   *  via the unique constraint), flip the debit to RECONCILED, and stamp the
   *  entity's clearance bookkeeping fields where they exist. */
  private async writeMatch(
    tx: DebitTx,
    c: PaidPayable,
    abs: number,
    disputed: boolean,
  ): Promise<void> {
    const note = disputed
      ? `Conciliação automática com divergência de valor: débito R$${abs.toFixed(2)} vs. baixa R$${c.paidAmount.toFixed(2)}.`
      : null;

    await this.prisma.$transaction(async db => {
      // Scalar-FK form so createMany({ skipDuplicates }) can ride the per-anchor
      // unique constraint for idempotency (createMany rejects nested connect).
      const data: Prisma.ReconciliationMatchCreateManyInput = {
        transactionId: tx.id,
        allocatedAmount: new Decimal(abs),
        matchType: ReconciliationMatchType.VALUE_DATE,
        // A clean clearance is high-confidence; a disputed one carries a low
        // score so the review queue surfaces it.
        confidenceScore: disputed ? 50 : 95,
        notes: note,
        orderInstallmentId: c.anchor.kind === 'orderInstallment' ? c.anchor.id : null,
        airbrushingId: c.anchor.kind === 'airbrushing' ? c.anchor.id : null,
        recurrentOccurrenceId: c.anchor.kind === 'recurrentOccurrence' ? c.anchor.id : null,
        payrollMonthSettlementId:
          c.anchor.kind === 'payrollMonthSettlement' ? c.anchor.id : null,
      };

      // Idempotent: a re-run of the same (transactionId, anchor) hits the unique
      // constraint and is skipped rather than double-settling.
      await db.reconciliationMatch.createMany({ data: [data], skipDuplicates: true });

      // Record clearance on entities that already carry the fields. A DISPUTED
      // match still RECONCILEs the bank line (it IS matched) but is flagged for
      // review via the low confidence + note above and the derived DISPUTED state.
      if (c.anchor.kind === 'recurrentOccurrence') {
        await db.recurrentPayableOccurrence.update({
          where: { id: c.anchor.id },
          data: { bankTransactionId: tx.id, reconciledAt: new Date() },
        });
      }

      await db.bankTransaction.update({
        where: { id: tx.id },
        data: {
          reconciliationStatus: ReconciliationStatus.RECONCILED,
          reconciliationSource: ReconciliationSource.AUTO,
          topMatchScore: null,
        },
      });
    });
  }
}
