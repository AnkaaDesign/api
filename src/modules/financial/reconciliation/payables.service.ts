import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { OrderService } from '../../inventory/order/order.service';
import { RecurrentPayableService } from '../recurrent-payable/recurrent-payable.service';
import { ClearanceState, PayableRow, PayablesResponse, PayablesSummary } from '../../../types';
import { deriveOrderClearance, OrderClearance } from './order-clearance';

/** Same amount tolerance the saída sweep uses to decide CLEARED vs DISPUTED. */
const CLEAR_TOLERANCE_ABS = 2;
const CLEAR_TOLERANCE_PCT = 0.005;

/** One non-reversed match on a payable anchor, reduced to what clearance needs. */
type AnchorMatch = { allocatedAmount: number; transactionId: string; matchedAt: Date };

/**
 * Unified Contas a Pagar source. Composes EVERY payable into one normalized
 * list so finance settles everything in one place:
 *   - orders / airbrushing / schedules / paid-this-month  (OrderService.getPayables)
 *   - first-class RecurrentPayable occurrences             (RecurrentPayableService)
 * Synthesized forecast/estimate rows (taxes, folha, 13º/férias, legacy per-category
 * recorrentes) are intentionally excluded — see getPayables. They remain in the
 * forecast/statistics views.
 *
 * Each row carries `settleVia` so the UI picks the right action without a
 * source switch. Taxes/recurrents settle by reconciliation (a categorized bank
 * debit), never a fake paidAt — that is the anti-double-count rule.
 */
@Injectable()
export class PayablesService {
  private readonly logger = new Logger(PayablesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly recurrentPayableService: RecurrentPayableService,
  ) {}

  async getPayables(requestedCompetence?: string): Promise<PayablesResponse> {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const currentCompetence = `${year}-${String(month).padStart(2, '0')}`;

      // Selected competence (YYYY-MM), scoping the recurrent occurrences to the
      // month the user is viewing. Invalid/absent input falls back to the current
      // month so a bad query param never fabricates data.
      const competence = /^\d{4}-\d{2}$/.test(requestedCompetence ?? '') ? (requestedCompetence as string) : currentCompetence;

      // Only the current/future competence may lazily MATERIALIZE occurrences. A
      // PAST competence loads its EXISTING rows read-only — we never back-materialize
      // history, so older months (before the recurrent feature existed) stay
      // legitimately empty instead of showing fabricated phantom debts.
      const allowMaterialize = competence >= currentCompetence;

      const [orderResp, recurrentRows] = await Promise.all([
        this.orderService.getPayables(),
        this.recurrentPayableService.ensureCurrentOccurrenceRows(competence, allowMaterialize),
      ]);

      const rows: PayableRow[] = [];

      // 1) Orders / airbrushing / schedules / paid — annotate settleVia.
      // Respect a settleVia the source already set (boleto orders → RECONCILIATION);
      // only fall back to the source default when it is missing.
      for (const r of orderResp.data.rows) {
        rows.push({
          ...r,
          settleVia:
            r.settleVia ??
            (r.source === 'ORDER'
              ? 'ORDER_LIFECYCLE'
              : r.source === 'AIRBRUSHING'
                ? 'AIRBRUSHING'
                : r.source === 'SCHEDULED'
                  ? 'SCHEDULE_TRIGGER'
                  : 'NONE'),
        });
      }

      // NOTE: synthesized forecast/estimate rows (taxes/ISS, folha/payroll,
      // 13º/férias, and the legacy per-category "Recorrentes" forecast such as
      // Monitoramento) are intentionally NOT surfaced in Contas a Pagar — this
      // list shows only concrete payables (orders, airbrushing/schedules, and
      // first-class RecurrentPayable occurrences). Those forecasts still live in
      // the reconciliation/forecast statistics views. (Removed 2026-06-30.)

      // 2) Contas recorrentes (first-class) — materialized monthly occurrences.
      // VARIABLE bills show the estimate (italic) until paid; the pay action
      // prompts for the real amount. FIXED bills settle with the known amount.
      for (const { occurrence, payable } of recurrentRows) {
        const paid = occurrence.status === 'PAID';
        // CANCELLED occurrence = ignored for its month (diarista faltou, etc.).
        // Kept visible but muted, excluded from totals, revertible.
        const ignored = occurrence.status === 'CANCELLED';
        const isVariable = payable.amountKind === 'VARIABLE';
        const estimate = Number(occurrence.estimatedAmount);
        const amount = paid && occurrence.paidAmount != null ? Number(occurrence.paidAmount) : estimate;
        rows.push({
          source: 'RECURRENT_PAYABLE',
          id: occurrence.id,
          payeeId: payable.supplierId ?? payable.id,
          payeeName: payable.supplier?.fantasyName ?? payable.payeeName ?? payable.name,
          description: payable.name,
          amount,
          paymentState: paid ? 'PAID' : 'AWAITING_PAYMENT',
          ignored,
          dueDate: occurrence.dueDate,
          method: occurrence.paymentMethod ?? payable.paymentMethod ?? null,
          paidAt: occurrence.paidAt ?? null,
          settleVia: paid || ignored ? 'NONE' : 'RECURRENT_PAYABLE',
          // Only an unpaid VARIABLE bill is a true estimate (real amount typed on pay).
          isEstimate: !paid && !ignored && isVariable,
          // Per-occurrence competence (rows now span current + next month).
          competence: occurrence.competence,
          subtype: isVariable ? 'Variável' : 'Fixo',
        });
      }

      // Promote any genuinely-due open obligation to OVERDUE (uniform across all
      // sources — orders, airbrushing, recurrent occurrences). Forecast (EXPECTED)
      // and already-paid rows are never overdue. Mirrors the receivables side and
      // makes the persisted-OVERDUE state visible as a real Contas a Pagar bucket
      // (was only conveyed via client-side row styling).
      for (const row of rows) {
        if (
          !row.ignored &&
          (row.paymentState === 'AWAITING_PAYMENT' || row.paymentState === 'PARTIALLY_PAID') &&
          row.dueDate != null &&
          new Date(row.dueDate) < now
        ) {
          row.paymentState = 'OVERDUE';
        }
      }

      // --- Axis B: clearance derivation -------------------------------------
      // Annotate every row with its bank-confirmation state, derived purely from
      // a non-reversed ReconciliationMatch on the row's anchor. Independent of
      // paymentState: a PAID row stays UNCLEARED until a debit confirms it.
      await this.annotateClearance(rows, null, competence);

      // --- summary buckets ---
      const emptyBucket = () => ({ count: 0, total: 0 });
      const summary: PayablesSummary = {
        AWAITING_PAYMENT: emptyBucket(),
        OVERDUE: emptyBucket(),
        PARTIALLY_PAID: emptyBucket(),
        EXPECTED: emptyBucket(),
        PAID: emptyBucket(),
      };
      for (const row of rows) {
        // Ignored occurrences are out of every bucket total — they aren't a debt.
        if (row.ignored) continue;
        const bucket = summary[row.paymentState];
        if (!bucket) continue;
        bucket.count += 1;
        bucket.total += row.amount;
      }

      return {
        success: true,
        message: 'Contas a pagar carregadas com sucesso.',
        data: { rows, summary },
      };
    } catch (error) {
      this.logger.error('Erro ao carregar contas a pagar (unificado):', error as Error);
      throw new InternalServerErrorException('Erro ao carregar contas a pagar. Por favor, tente novamente.');
    }
  }

  /**
   * Derive Axis B (clearanceState) for every payable row from non-reversed
   * ReconciliationMatches on each row's anchor:
   *   - ORDER rows with an installmentId → orderInstallmentId anchor
   *   - AIRBRUSHING rows                  → airbrushingId anchor (= row.id)
   *   - RECURRENT_PAYABLE rows            → recurrentOccurrenceId anchor (= row.id)
   *   - PAYROLL row                       → payrollMonthSettlementId anchor
   * Rows with no anchor (TAX/SCHEDULED/13º/férias estimates, legacy RECURRING
   * category rows) stay UNCLEARED. A match whose allocated amount agrees with the
   * row amount within tolerance ⇒ CLEARED; beyond tolerance ⇒ DISPUTED.
   */
  private async annotateClearance(
    rows: PayableRow[],
    payrollSettlementId: string | null,
    competence: string,
  ): Promise<void> {
    const orderIds = new Set<string>();
    const airbrushingIds = new Set<string>();
    const recurrentOccurrenceIds = new Set<string>();
    for (const r of rows) {
      r.clearanceState = 'UNCLEARED';
      r.clearedAt = null;
      r.bankTransactionId = null;
      // ORDER rows anchor on the ORDER (row.id) — clearance is derived from the
      // whole order's match graph (installment anchors AND the linked-NF path),
      // so an order cleared via its NF (C1) shows CLEARED even when the specific
      // parcela row was never directly anchored.
      if (r.source === 'ORDER') orderIds.add(r.id);
      else if (r.source === 'AIRBRUSHING') airbrushingIds.add(r.id);
      else if (r.source === 'RECURRENT_PAYABLE') recurrentOccurrenceIds.add(r.id);
    }

    // ORDER clearance from the unified match graph (shared with the forecast so
    // both views read the SAME derived clearance — no double count).
    const orderClearance = orderIds.size
      ? await deriveOrderClearance(this.prisma, [...orderIds])
      : new Map<string, OrderClearance>();

    if (airbrushingIds.size || recurrentOccurrenceIds.size || payrollSettlementId) {
      const matches = await this.prisma.reconciliationMatch.findMany({
        where: {
          reversedAt: null,
          OR: [
            airbrushingIds.size ? { airbrushingId: { in: [...airbrushingIds] } } : undefined,
            recurrentOccurrenceIds.size ? { recurrentOccurrenceId: { in: [...recurrentOccurrenceIds] } } : undefined,
            payrollSettlementId ? { payrollMonthSettlementId: payrollSettlementId } : undefined,
          ].filter(Boolean) as object[],
        },
        select: {
          allocatedAmount: true,
          transactionId: true,
          matchedAt: true,
          airbrushingId: true,
          recurrentOccurrenceId: true,
          payrollMonthSettlementId: true,
        },
      });

      const byAirbrushing = new Map<string, AnchorMatch>();
      const byRecurrent = new Map<string, AnchorMatch>();
      let payrollMatch: AnchorMatch | null = null;
      for (const m of matches) {
        const am: AnchorMatch = {
          allocatedAmount: Number(m.allocatedAmount),
          transactionId: m.transactionId,
          matchedAt: m.matchedAt,
        };
        if (m.airbrushingId) byAirbrushing.set(m.airbrushingId, am);
        else if (m.recurrentOccurrenceId) byRecurrent.set(m.recurrentOccurrenceId, am);
        else if (m.payrollMonthSettlementId) payrollMatch = am;
      }

      const apply = (row: PayableRow, m: AnchorMatch | null | undefined) => {
        if (!m) return;
        const tol = Math.max(CLEAR_TOLERANCE_ABS, row.amount * CLEAR_TOLERANCE_PCT);
        const drift = Math.abs(m.allocatedAmount - row.amount);
        row.clearanceState = (drift > tol ? 'DISPUTED' : 'CLEARED') as ClearanceState;
        row.clearedAt = m.matchedAt;
        row.bankTransactionId = m.transactionId;
      };

      for (const r of rows) {
        if (r.source === 'AIRBRUSHING') apply(r, byAirbrushing.get(r.id));
        else if (r.source === 'RECURRENT_PAYABLE') apply(r, byRecurrent.get(r.id));
        else if (r.source === 'PAYROLL' && r.competence === competence) apply(r, payrollMatch);
      }
    }

    // ORDER rows — clearance + 3-way consistency from the shared derivation.
    for (const r of rows) {
      if (r.source !== 'ORDER') continue;
      const oc = orderClearance.get(r.id);
      if (!oc) continue;
      // Surface the 3-way (order ≟ nf ≟ tx) signal on every ORDER row.
      r.threeWayConsistency = oc.threeWay.flag;
      r.threeWaySums = {
        tx: oc.threeWay.txAllocated,
        nf: oc.threeWay.nfLinkedTotal,
        installment: oc.threeWay.installmentTotal,
      };
      if (!oc.hasBankBacking) continue;

      if (r.installmentId) {
        // A specific parcela clears ONLY on its OWN anchor — it must never inherit
        // clearance from a sibling parcela's bank match (that would mark an unpaid
        // parcela CLEARED). Its allocated amount decides CLEARED vs DISPUTED.
        const inst = oc.byInstallment.get(r.installmentId);
        if (!inst) continue; // this parcela is not bank-backed → stays UNCLEARED
        const tol = Math.max(CLEAR_TOLERANCE_ABS, r.amount * CLEAR_TOLERANCE_PCT);
        const drift = Math.abs(inst.allocatedAmount - r.amount);
        r.clearanceState = (drift > tol ? 'DISPUTED' : 'CLEARED') as ClearanceState;
        r.clearedAt = inst.matchedAt;
        r.bankTransactionId = inst.transactionId;
      } else {
        // Order-level row (single-payment order, no per-parcela expansion): the
        // whole order is bank-backed via the installment anchor OR the linked-NF
        // path. A 3-way MISMATCH reads as DISPUTED.
        r.clearanceState = (oc.threeWay.flag === 'MISMATCH' ? 'DISPUTED' : 'CLEARED') as ClearanceState;
        r.clearedAt = oc.matchedAt;
        r.bankTransactionId = oc.transactionId;
      }
    }
  }

  /** Mark a payroll competence month as paid (folha is settled as a batch). */
  async markPayrollMonthPaid(
    year: number,
    month: number,
    amount: number | null,
    userId?: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.prisma.payrollMonthSettlement.upsert({
      where: { year_month: { year, month } },
      create: { year, month, amount, paidAt: new Date(), paidById: userId ?? null },
      update: { amount, paidAt: new Date(), paidById: userId ?? null },
    });
    return { success: true, message: 'Folha marcada como paga.' };
  }
}
