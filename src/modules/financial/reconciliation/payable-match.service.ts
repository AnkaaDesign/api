import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderInstallmentStatus,
  OrderPaymentStatus,
  OrderStatus,
  Prisma,
  ReconciliationMatchType,
  ReconciliationSource,
  ReconciliationStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { OrderService } from '@modules/inventory/order/order.service';
import { nameSimilarity } from './text-normalization';
import { isMarketplaceSupplier, isMarketplaceTransaction } from './marketplace';
import { RECON_ADVISORY_LOCK_KEY } from './reconciliation-matcher.service';
import { textHasInstallationCode } from '../recurrent-payable/recurrent-payable.service';

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

/** C2 — direct order↔tx confirmation window for OPEN (not-yet-paid) order
 *  installments, anchored on the parcela's dueDate (there is no paidAt yet). A
 *  boleto/PIX may settle a parcela somewhat before its due date, or run late
 *  after it, so the window is asymmetric and wide on the "paid late" side. */
const OPEN_DUE_FORWARD_DAYS = 10; // debit posts up to 10d BEFORE the due date
const OPEN_DUE_BACKWARD_DAYS = 45; // …or up to 45d AFTER it (late payment)

/** Absolute (R$) and relative tolerance for "the debit equals the asserted
 *  amount". Beyond BOTH → DISPUTED. */
const AMOUNT_TOLERANCE_ABS = 2;
const AMOUNT_TOLERANCE_PCT = 0.005;

type DebitTx = {
  id: string;
  postedAt: Date;
  amount: Prisma.Decimal | number;
  /** Carries the billed-installation code (UC / matrícula) on utility debits. */
  memo: string | null;
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
  /** C2 — the anchor is an OPEN (not-yet-paid) order installment that this debit
   *  should SETTLE (mark PAID + roll up), not merely confirm an existing baixa.
   *  false/undefined ⇒ the legacy already-PAID confirmation path. */
  settleOnMatch?: boolean;
  /** OPEN order-installment anchors only — the parent order, so the settle path
   *  can recompute its rollup. */
  orderId?: string;
  /** True when the order also has a linked NF (M2M / resolved order code): the
   *  match is cross-validated order+nf+tx, the strongest confirmation. */
  nfCrossValidated?: boolean;
  /** Order-installment anchors only — whether the debit and the order's supplier
   *  are the SAME counterparty by some readable signal (see hasOrderIdentity).
   *  Mandatory before a brand-new anchor row may be created from value+date. */
  identityOk?: boolean;
};

const onlyDigits = (v: string | null | undefined): string => (v || '').replace(/\D/g, '');

@Injectable()
export class PayableMatchService {
  private readonly logger = new Logger(PayableMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
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

  /** Confirm every eligible debit — the unscoped "Verificar" branch. */
  async confirmPayablesAll(): Promise<number> {
    return this.confirmWhere({});
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
        // NOT `reconciliationStatus: PENDING`. The classifier closes a debit on a
        // resolving category (Energia, Água, Internet, Aluguel…) inside the SAME
        // import loop, milliseconds before this sweep runs — `classifyAndPersist`
        // is called per-id above `confirmPayablesByIds`. A PENDING gate therefore
        // made this service structurally blind to exactly the recurring-bill
        // family it exists to confirm, here AND on the 04:00 backstop: the three
        // COPEL meters of 24/08 were RECONCILED-by-category 0,5 s after import and
        // never seen again. What actually disqualifies a debit is already having
        // an anchor, or a person having declared it resolved without one.
        reconciliationStatus: { not: ReconciliationStatus.IGNORED },
        // NOT "has no live match at all" either. A debit whose only rows are NF
        // rows has not confirmed any OBLIGATION yet — the note documents what was
        // bought, the parcela records what was owed, and one bank line carries
        // both (`tryConfirmDebit` ties the parcela onto the existing NF row). The
        // stricter filter made every NF-matched debit invisible to this sweep, so
        // the payment that actually settled an order could never be the one to
        // clear it, and the orphaned parcela was left for whichever unrelated
        // debit of a similar value came next. What disqualifies a debit is a live
        // PAYABLE anchor — it is already confirmed — or a person having declared
        // it resolved without one.
        matches: {
          none: {
            reversedAt: null,
            OR: [
              { orderInstallmentId: { not: null } },
              { airbrushingId: { not: null } },
              { recurrentOccurrenceId: { not: null } },
              { payrollMonthSettlementId: { not: null } },
            ],
          },
        },
        settlementAckAt: null,
        ...extra,
      },
      select: {
        id: true,
        postedAt: true,
        amount: true,
        memo: true,
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
    // Live guard — a sibling pass may have anchored it already. Expressed on the
    // anchor axis, not the status axis: "RECONCILED" is the normal resting state
    // of a category-resolved debit that still has no obligation behind it.
    const live = await this.prisma.bankTransaction.findUnique({
      where: { id: tx.id },
      select: { reconciliationStatus: true, settlementAckAt: true },
    });
    if (!live) return false;
    if (live.reconciliationStatus === ReconciliationStatus.IGNORED) return false;
    if (live.settlementAckAt) return false;
    // A debit that already CONFIRMS a payable is done. One that merely carries NF
    // rows is NOT: the order parcela and the note that documents it are parallel
    // DESCRIPTIONS of the same payment (the doctrine written into
    // `computeReconciliationStatus`, which measures coverage per anchor kind), so
    // one bank line can and should carry both anchors. The blanket "has any live
    // match ⇒ skip" guard that stood here made the TRUE payment structurally
    // unable to claim its own parcela whenever the NF matcher reached it first,
    // and left that parcela orphaned for an unrelated debit of a similar value to
    // grab: on 18/09 the R$150,00 debit to G. J. L. Transporte took the R$149,80
    // Mercado Livre parcela whose real payment (15/09) had been anchored to
    // NF 4116 one second earlier.
    const liveMatches = await this.prisma.reconciliationMatch.findMany({
      where: { transactionId: tx.id, reversedAt: null },
      select: {
        id: true,
        allocatedAmount: true,
        fiscalDocumentId: true,
        orderInstallmentId: true,
        airbrushingId: true,
        recurrentOccurrenceId: true,
        payrollMonthSettlementId: true,
      },
    });
    if (
      liveMatches.some(
        m =>
          m.orderInstallmentId ||
          m.airbrushingId ||
          m.recurrentOccurrenceId ||
          m.payrollMonthSettlementId,
      )
    ) {
      return false;
    }
    // NF rows of THIS debit not yet tied to an order parcela — co-anchor targets.
    const coAnchorRows = liveMatches.filter(m => m.fiscalDocumentId && !m.orderInstallmentId);

    const abs = Math.abs(Number(tx.amount));
    const candidates = await this.findPaidCandidates(tx, abs);
    if (candidates.length === 0) return false;

    // CO-ANCHOR — this debit already pays a note, and a parcela worth exactly
    // that same money is the same payment seen from the obligation axis. Tie it
    // onto the EXISTING NF row (C1's doctrine: no new row, no new allocation)
    // instead of creating a parallel one. Counterparty identity is not required
    // here and must not be: the bank line is pinned, and the note it provably
    // pays is the corroboration — on a marketplace order the debit, the supplier
    // and the note emitter are three different CNPJs by construction. What has
    // to be unambiguous is the money, so the value must agree to the cent and
    // exactly one parcela may claim it.
    if (coAnchorRows.length > 0) {
      const pairs: Array<{ c: PaidPayable; row: (typeof coAnchorRows)[number] }> = [];
      for (const c of candidates) {
        if (c.anchor.kind !== 'orderInstallment') continue;
        // How far the note and the parcela may differ and still be "the same
        // money" depends on what else corroborates them. To the cent, the value
        // identity stands on its own. Beyond that it needs the counterparty to
        // agree — a note routinely differs from the parcela that pays it by cents
        // (NF 39764 is R$2.667,44 against a R$2.667,70 parcela), but a blanket
        // R$2 / 0,5% window on value alone pairs strangers: the R$4.109,52 debit
        // to Kennedy de Campos (NF 27) lands R$3,97 from a Farben "Thinner"
        // parcela paid the same day, and nothing but the amount connects them.
        const tol = c.identityOk
          ? Math.max(AMOUNT_TOLERANCE_ABS, c.paidAmount * AMOUNT_TOLERANCE_PCT)
          : 0.01;
        const row = coAnchorRows.find(
          r => Math.abs(Number(r.allocatedAmount) - c.paidAmount) <= tol,
        );
        if (row) pairs.push({ c, row });
      }
      if (pairs.length > 1) {
        this.logger.debug(
          `Debit ${tx.id} co-anchor ambiguous (${pairs.length} parcelas worth the same); leaving manual`,
        );
        return false;
      }
      if (pairs.length === 1) {
        const { c, row } = pairs[0];
        if (dryRun) {
          this.logger.log(
            `[dry-run] debit ${tx.id} → co-anchor parcela ${c.label} onto NF match ${row.id}`,
          );
          return true;
        }
        const tied = await this.coAnchorOrderInstallment(tx, c, row.id);
        if (tied) {
          this.logger.log(
            `Debit ${tx.id} co-anchored order parcela ${c.label} onto its own NF match`,
          );
          return true;
        }
        return false;
      }
    }

    // Score: amount agreement is mandatory for a candidate to even enter the
    // pool (findPaidCandidates already filters by amount window). Disambiguate by
    // counterparty identity + date proximity, and only auto-confirm a unique or
    // clearly-winning candidate (never guess between two equally-good payables).
    // CREATE mode — a brand-new anchor row, with nothing on this debit
    // corroborating it. Here counterparty identity is mandatory for an order
    // parcela: value + date alone is exactly how the G. J. L. debit took the
    // Mercado Livre parcela. (Scoring cannot substitute for it — see
    // hasOrderIdentity.)
    const eligible = candidates.filter(
      c => c.anchor.kind !== 'orderInstallment' || c.identityOk === true,
    );
    if (eligible.length === 0) {
      this.logger.debug(
        `Debit ${tx.id}: ${candidates.length} candidate(s) rejected for lack of counterparty identity`,
      );
      return false;
    }

    const scored = eligible
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
        orderId: true,
        amount: true,
        paidAmount: true,
        paidAt: true,
        order: { select: { description: true, supplier: { select: { fantasyName: true, cnpj: true } } } },
      },
      take: 50,
    });
    for (const oi of orderInstallments) {
      if (!oi.paidAt) continue;
      const asserted = oi.paidAmount > 0 ? oi.paidAmount : oi.amount;
      out.push({
        anchor: { kind: 'orderInstallment', id: oi.id },
        paidAmount: asserted,
        paidAt: oi.paidAt,
        counterpartyName: oi.order?.supplier?.fantasyName ?? null,
        counterpartyCnpjCpf: oi.order?.supplier?.cnpj ?? null,
        label: oi.order?.description ?? oi.id,
        orderId: oi.orderId,
        identityOk: this.hasOrderIdentity(
          tx,
          oi.order?.supplier?.fantasyName ?? null,
          oi.order?.supplier?.cnpj ?? null,
          Math.abs(asserted - abs) <= 0.01,
        ),
      });
    }

    // --- C2: OPEN order installments (no NF, no prior baixa) settled DIRECTLY ---
    // Most orders have no linked NF, so the C1 tie-back can never reach them. A
    // DEBIT that matches an OPEN parcela by supplier CNPJ + amount + due-date
    // window IS the payment: settle it and clear it in one step. Pre-payable
    // PENDING orders and CANCELLED orders are excluded (only AWAITING_PAYMENT /
    // PARTIALLY_PAID orders are real obligations); already-anchored parcelas are
    // excluded so this never double-settles what C1 or a prior run handled.
    // Identity is mandatory for a DIRECT settle: without an NF to corroborate, a
    // supplier-CNPJ match is the anchor that makes settling an unpaid parcela on
    // value+date safe. No parseable CNPJ on the debit ⇒ no C2 candidates.
    const txDigits = onlyDigits(tx.counterpartyCnpjCpf);
    const dueFrom = new Date(tx.postedAt.getTime() - OPEN_DUE_BACKWARD_DAYS * 86_400_000);
    const dueTo = new Date(tx.postedAt.getTime() + OPEN_DUE_FORWARD_DAYS * 86_400_000);
    const openInstallments = txDigits
      ? await this.prisma.orderInstallment.findMany({
      where: {
        status: {
          in: [
            OrderInstallmentStatus.PENDING,
            OrderInstallmentStatus.PARTIALLY_PAID,
            OrderInstallmentStatus.OVERDUE,
          ],
        },
        amount: { gte: lowerAmt, lte: upperAmt },
        // Due-date anchored (there is no paidAt yet). Rows without a dueDate stay
        // out — we can't scope them safely without a date signal.
        dueDate: { gte: dueFrom, lte: dueTo },
        reconciliationMatches: { none: { reversedAt: null } },
        order: {
          status: { not: OrderStatus.CANCELLED },
          paymentStatus: {
            in: [OrderPaymentStatus.AWAITING_PAYMENT, OrderPaymentStatus.PARTIALLY_PAID],
          },
        },
      },
          select: {
            id: true,
            amount: true,
            paidAmount: true,
            dueDate: true,
            orderId: true,
            order: {
              select: {
                description: true,
                supplier: { select: { fantasyName: true, cnpj: true } },
                _count: {
                  select: { fiscalDocuments: true, fiscalDocumentOrderCodes: true },
                },
              },
            },
          },
          take: 50,
        })
      : [];
    for (const oi of openInstallments) {
      if (!oi.dueDate) continue;
      // Hard identity gate — the supplier CNPJ must equal the debit's.
      if (onlyDigits(oi.order?.supplier?.cnpj) !== txDigits) continue;
      const remaining = Math.max(0, oi.amount - (oi.paidAmount || 0));
      out.push({
        anchor: { kind: 'orderInstallment', id: oi.id },
        // Compare the debit against the outstanding balance (partial parcelas).
        paidAmount: remaining > 0 ? remaining : oi.amount,
        // No paidAt yet — the dueDate is the reference the scorer uses.
        paidAt: oi.dueDate,
        counterpartyName: oi.order?.supplier?.fantasyName ?? null,
        counterpartyCnpjCpf: oi.order?.supplier?.cnpj ?? null,
        label: oi.order?.description ?? oi.id,
        settleOnMatch: true,
        orderId: oi.orderId,
        // The hard CNPJ gate above IS the identity check for this path.
        identityOk: true,
        nfCrossValidated:
          (oi.order?._count?.fiscalDocuments ?? 0) > 0 ||
          (oi.order?._count?.fiscalDocumentOrderCodes ?? 0) > 0,
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
        installation: { select: { code: true } },
        recurrentPayable: {
          select: {
            name: true,
            payeeName: true,
            supplier: { select: { fantasyName: true, cnpj: true } },
            installations: { where: { isActive: true }, select: { id: true } },
          },
        },
      },
      take: 50,
    });
    for (const occ of occurrences) {
      if (!occ.paidAt || occ.paidAmount == null) continue;
      // A bill with billed installations (SAMAE matrículas, COPEL UCs) debits
      // once PER INSTALLATION on the same day, and this sweep matches on VALUE —
      // which is blind to which meter it is looking at. That blindness is the
      // exact failure the installation model was built to end, and it came back
      // through this door: on 24/08 it confirmed UC 113926715's R$1.155,13 debit
      // against UC 107981068's occurrence and vice-versa, because the two baixas
      // had been typed crossed and the values still "fit". A debit may only
      // confirm the occurrence of the installation NAMED IN ITS MEMO.
      if ((occ.recurrentPayable?.installations?.length ?? 0) > 0) {
        const code = occ.installation?.code;
        if (!code) continue;
        const named =
          textHasInstallationCode(tx.memo, code) ||
          textHasInstallationCode(tx.counterpartyName, code);
        if (!named) continue;
      }
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

  /**
   * Identity gate for CREATING a new order-parcela anchor out of value + date.
   *
   * The C2 (open parcela) path already declares identity mandatory; the
   * already-PAID path had no gate at all, which is how a R$150,00 debit to a
   * freight company confirmed a R$149,80 Mercado Livre parcela two days later.
   * A flat score floor cannot stand in for this: of the order anchors on record,
   * the three CORRECT Mercado Livre confirmations score 55 — exact value, same
   * day, but the memo carries Mercado Pago's CNPJ, never the store's — while the
   * wrong one scored 41. What separates them is identity, not score.
   */
  private hasOrderIdentity(
    tx: DebitTx,
    supplierName: string | null,
    supplierCnpj: string | null,
    amountExact: boolean,
  ): boolean {
    const txCnpj = onlyDigits(tx.counterpartyCnpjCpf);
    const supplierDigits = onlyDigits(supplierCnpj);
    if (txCnpj && supplierDigits && txCnpj === supplierDigits) return true;
    if (nameSimilarity(tx.counterpartyName, supplierName) >= 0.5) return true;
    // Marketplace orders settle through an intermediary, so the debit's CNPJ is
    // the intermediary's and can never equal the supplier's. An exact value
    // against a marketplace supplier is the only identity available there.
    return (
      amountExact &&
      isMarketplaceTransaction(tx.memo, tx.counterpartyCnpjCpf) &&
      isMarketplaceSupplier(supplierName, supplierCnpj)
    );
  }

  /**
   * Tie an order parcela onto an EXISTING NF-match row of the same debit,
   * mirroring the C1 tie-back in `reconciliation-matcher.service.ts`: the row
   * gains `orderInstallmentId`, no row is created and no allocation is booked,
   * so `anchorKindOf` still reads it as a single fiscalDocument slice and the
   * reconciliation totals never double-count the payment.
   *
   * Returns true when the tie was written, false when a concurrent pass got
   * there first (the read-then-write runs under the reconciliation advisory
   * lock, so a re-run is a safe no-op).
   */
  private async coAnchorOrderInstallment(
    tx: DebitTx,
    c: PaidPayable,
    matchId: string,
  ): Promise<boolean> {
    if (c.anchor.kind !== 'orderInstallment') return false;
    const installmentId = c.anchor.id;
    return this.prisma.$transaction(async db => {
      // Serialize against the matcher's own tie-back and against manual matches.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(${RECON_ADVISORY_LOCK_KEY})`;

      const row = await db.reconciliationMatch.findUnique({
        where: { id: matchId },
        select: { reversedAt: true, fiscalDocumentId: true, orderInstallmentId: true },
      });
      if (!row || row.reversedAt || row.orderInstallmentId || !row.fiscalDocumentId) return false;
      const fiscalDocumentId = row.fiscalDocumentId;

      // The parcela must still be unclaimed.
      const taken = await db.reconciliationMatch.count({
        where: { orderInstallmentId: installmentId, reversedAt: null },
      });
      if (taken > 0) return false;

      const inst = await db.orderInstallment.findUnique({
        where: { id: installmentId },
        select: { id: true, orderId: true, amount: true, status: true },
      });
      if (!inst) return false;

      await db.reconciliationMatch.update({
        where: { id: matchId },
        data: { orderInstallmentId: inst.id },
      });

      // Settle a parcela that is still open. An already-PAID parcela keeps the
      // human baixa exactly as it was typed — the tie adds bank truth to it, it
      // does not rewrite the assertion.
      if (inst.status !== OrderInstallmentStatus.PAID) {
        await db.orderInstallment.updateMany({
          where: { id: inst.id, status: { not: OrderInstallmentStatus.PAID } },
          data: {
            status: OrderInstallmentStatus.PAID,
            paidAmount: inst.amount,
            paidAt: tx.postedAt,
          },
        });
      }

      // Record the NF↔order relation this tie just proved, so `deriveOrderClearance`
      // can see the note and every later C1 run is an idempotent no-op. Only when
      // the note covers the order's parcelas: linking a note that finances a
      // DIFFERENT total would turn the order's 3-way signal into a false MISMATCH.
      const [fd, siblings] = await Promise.all([
        db.fiscalDocument.findUnique({
          where: { id: fiscalDocumentId },
          select: {
            totalValue: true,
            orders: { where: { id: inst.orderId }, select: { id: true } },
          },
        }),
        db.orderInstallment.findMany({
          where: { orderId: inst.orderId },
          select: { amount: true },
        }),
      ]);
      if (fd && fd.orders.length === 0) {
        const installmentTotal = siblings.reduce((sum, i) => sum + Number(i.amount), 0);
        const noteTotal = Number(fd.totalValue);
        const tol = Math.max(AMOUNT_TOLERANCE_ABS, installmentTotal * AMOUNT_TOLERANCE_PCT);
        if (Math.abs(noteTotal - installmentTotal) <= tol) {
          await db.order.update({
            where: { id: inst.orderId },
            data: { fiscalDocuments: { connect: { id: fiscalDocumentId } } },
          });
        }
      }

      await this.orderService.recomputeOrderPaymentRollupFromReconciliation(db, inst.orderId);
      return true;
    });
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
    const settleOpen = c.settleOnMatch === true && c.anchor.kind === 'orderInstallment';
    const note = disputed
      ? `Conciliação automática com divergência de valor: débito R$${abs.toFixed(2)} vs. baixa R$${c.paidAmount.toFixed(2)}.`
      : settleOpen
        ? c.nfCrossValidated
          ? 'Baixa automática por conciliação bancária (pedido + nota + extrato).'
          : 'Baixa automática por conciliação bancária (pedido + extrato).'
        : null;

    await this.prisma.$transaction(async db => {
      // Allocation is a budget, not a label. This sweep used to write the FULL
      // debit amount into every anchor it confirmed, and its only exclusivity
      // test was "is this anchor already claimed?" — which cannot see that the
      // TRANSACTION has already been spent. Because the daily rematch re-reads
      // the same debit every night, each run handed it to the next unclaimed
      // occurrence: one R$370 cleaning payment ended up clearing four weekly
      // occurrences (07-08, 07-22, 08-05, 08-12), and the recurring payables
      // were marked PAID two months into the future off money that was never
      // paid. `recurrent-payable.service.ts` already guards this way; this path
      // did not.
      // The budget is PER ANCHOR KIND, not per transaction. Summed across kinds
      // it contradicted `computeReconciliationStatus` — where coverage is the
      // LARGEST single kind, precisely because an order parcela and the note that
      // documents it are parallel descriptions of one payment rather than two
      // slices of it — and it made a debit that already carried its NF unable to
      // also confirm its parcela. Same-kind budgeting is what this guard was
      // built for: one R$370 cleaning payment must never clear four weekly
      // occurrences.
      const sameKind: Prisma.ReconciliationMatchWhereInput =
        c.anchor.kind === 'orderInstallment'
          ? { orderInstallmentId: { not: null } }
          : c.anchor.kind === 'airbrushing'
            ? { airbrushingId: { not: null } }
            : c.anchor.kind === 'recurrentOccurrence'
              ? { recurrentOccurrenceId: { not: null } }
              : { payrollMonthSettlementId: { not: null } };
      const existing = await db.reconciliationMatch.findMany({
        where: { transactionId: tx.id, reversedAt: null, ...sameKind },
        select: { allocatedAmount: true },
      });
      const spent = existing.reduce((s, m) => s + Number(m.allocatedAmount), 0);
      const available = Number((abs - spent).toFixed(2));
      if (available <= 0.01) {
        this.logger.warn(
          `Payable ${c.label} not confirmed against tx ${tx.id}: the debit is already ` +
            `fully allocated (R$${spent.toFixed(2)} of R$${abs.toFixed(2)}).`,
        );
        return;
      }
      const allocate = Number(Math.min(available, abs).toFixed(2));

      // Scalar-FK form so createMany({ skipDuplicates }) can ride the per-anchor
      // unique constraint for idempotency (createMany rejects nested connect).
      const data: Prisma.ReconciliationMatchCreateManyInput = {
        transactionId: tx.id,
        allocatedAmount: new Decimal(allocate),
        matchType: ReconciliationMatchType.VALUE_DATE,
        // A clean clearance is high-confidence; a disputed one carries a low
        // score so the review queue surfaces it. A cross-validated order+nf+tx
        // settle is the strongest, at 100.
        confidenceScore: disputed ? 50 : settleOpen && c.nfCrossValidated ? 100 : 95,
        notes: note,
        orderInstallmentId: c.anchor.kind === 'orderInstallment' ? c.anchor.id : null,
        airbrushingId: c.anchor.kind === 'airbrushing' ? c.anchor.id : null,
        recurrentOccurrenceId: c.anchor.kind === 'recurrentOccurrence' ? c.anchor.id : null,
        payrollMonthSettlementId:
          c.anchor.kind === 'payrollMonthSettlement' ? c.anchor.id : null,
      };

      // Idempotent: a re-run of the same (transactionId, anchor) hits the unique
      // constraint and is skipped rather than double-settling. If it WAS skipped
      // the pair already exists, so there is nothing further to settle — bail
      // instead of re-stamping clearance and re-flipping the transaction.
      const { count: created } = await db.reconciliationMatch.createMany({
        data: [data],
        skipDuplicates: true,
      });
      if (created === 0) {
        this.logger.debug(
          `Payable ${c.label} already matched to tx ${tx.id}; skipping re-settle.`,
        );
        return;
      }

      // Record clearance on entities that already carry the fields. A DISPUTED
      // match still RECONCILEs the bank line (it IS matched) but is flagged for
      // review via the low confidence + note above and the derived DISPUTED state.
      if (c.anchor.kind === 'recurrentOccurrence') {
        await db.recurrentPayableOccurrence.update({
          where: { id: c.anchor.id },
          data: { bankTransactionId: tx.id, reconciledAt: new Date() },
        });
      }

      // C2 — DIRECT settle of an OPEN order installment: mark the parcela PAID
      // and recompute the order rollup so it becomes paid + CLEARED in one step.
      // Guarded so it never wipes a parcela a concurrent run already settled.
      if (settleOpen && c.orderId) {
        const settled = await db.orderInstallment.updateMany({
          where: {
            id: c.anchor.id,
            status: {
              in: [
                OrderInstallmentStatus.PENDING,
                OrderInstallmentStatus.PARTIALLY_PAID,
                OrderInstallmentStatus.OVERDUE,
              ],
            },
          },
          data: {
            status: OrderInstallmentStatus.PAID,
            paidAmount: abs,
            paidAt: tx.postedAt,
          },
        });
        if (settled.count > 0) {
          await this.orderService.recomputeOrderPaymentRollupFromReconciliation(db, c.orderId);
        }
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
