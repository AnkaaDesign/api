import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { OrderService } from '../../inventory/order/order.service';
import { OutflowForecastService } from './outflow-forecast.service';
import { RecurrentPayableService } from '../recurrent-payable/recurrent-payable.service';
import { ClearanceState, PayableRow, PayablesResponse, PayablesSummary } from '../../../types';

/** Same amount tolerance the saída sweep uses to decide CLEARED vs DISPUTED. */
const CLEAR_TOLERANCE_ABS = 2;
const CLEAR_TOLERANCE_PCT = 0.005;

/** One non-reversed match on a payable anchor, reduced to what clearance needs. */
type AnchorMatch = { allocatedAmount: number; transactionId: string; matchedAt: Date };

/**
 * Unified Contas a Pagar source. Composes EVERY payable into one normalized
 * list so finance settles everything in one place:
 *   - orders / airbrushing / schedules / paid-this-month  (OrderService.getPayables)
 *   - taxes (impostos), folha, 13º/férias, recorrentes      (OutflowForecastService.forecast)
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
    private readonly outflowForecastService: OutflowForecastService,
    private readonly recurrentPayableService: RecurrentPayableService,
  ) {}

  async getPayables(): Promise<PayablesResponse> {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const competence = `${year}-${String(month).padStart(2, '0')}`;

      const [orderResp, forecast, payrollSettlement, recurrentRows] = await Promise.all([
        this.orderService.getPayables(),
        this.outflowForecastService.forecast(),
        this.prisma.payrollMonthSettlement.findUnique({ where: { year_month: { year, month } } }),
        this.recurrentPayableService.ensureCurrentOccurrenceRows(competence),
      ]);

      // Categories promoted to a first-class RecurrentPayable are surfaced as
      // materialized occurrences below — suppress the legacy category-derived
      // RECURRING forecast rows for them to avoid double-counting.
      const promotedCategoryIds = new Set(recurrentRows.map(r => r.payable.categoryId));

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

      // 2) Taxes (impostos) — estimate; settled by reconciliation.
      const inv = forecast.impostos?.invoicedServices;
      if (inv && inv.invoiceCount > 0) {
        const issAmount = inv.iss ?? inv.totalEstimated - inv.federalTotal;
        rows.push({
          source: 'TAX',
          id: `tax-iss-${competence}`,
          payeeId: null,
          payeeName: 'Prefeitura',
          description: `ISS ${inv.issRatePercent}% sobre faturamento (${inv.invoiceCount} NFS-e)`,
          amount: issAmount,
          paymentState: 'EXPECTED',
          dueDate: null,
          method: null,
          settleVia: 'RECONCILIATION',
          isEstimate: true,
          competence,
          subtype: 'Imposto',
        });
        if (inv.federalTotal > 0) {
          rows.push({
            source: 'TAX',
            id: `tax-fed-${competence}`,
            payeeId: null,
            payeeName: 'Receita Federal',
            description: 'Retenções federais',
            amount: inv.federalTotal,
            paymentState: 'EXPECTED',
            dueDate: null,
            method: null,
            settleVia: 'RECONCILIATION',
            isEstimate: true,
            competence,
            subtype: 'Imposto',
          });
        }
      }

      // 3) Folha (monthly aggregate) — settle by marking the competence paid.
      if (forecast.folha?.available && forecast.folha.total > 0) {
        const paid = !!payrollSettlement?.paidAt;
        rows.push({
          source: 'PAYROLL',
          id: `payroll-${competence}`,
          payeeId: null,
          payeeName: 'Colaboradores',
          description: `Folha (com bonificação) — ${forecast.folha.employeeCount} colaboradores`,
          amount: forecast.folha.total,
          paymentState: paid ? 'PAID' : 'EXPECTED',
          dueDate: null,
          method: null,
          paidAt: payrollSettlement?.paidAt ?? null,
          settleVia: paid ? 'NONE' : 'PAYROLL_MONTH',
          isEstimate: !paid,
          competence,
          subtype: 'Folha',
        });
      }

      // 4) Folha programada (13º / férias) — aggregate; settle in HR pages.
      const fp = forecast.folhaProgramada;
      if (fp?.thirteenth && fp.thirteenth.dueThisMonth > 0) {
        rows.push({
          source: 'PAYROLL_SCHEDULED',
          id: `thirteenth-${competence}`,
          payeeId: null,
          payeeName: 'Colaboradores',
          description: `13º salário (${fp.thirteenth.recordCount} colaboradores)`,
          amount: fp.thirteenth.dueThisMonth,
          paymentState: 'EXPECTED',
          dueDate: null,
          method: null,
          settleVia: 'THIRTEENTH',
          isEstimate: true,
          competence,
          subtype: '13º',
        });
      }
      if (fp?.vacation && fp.vacation.dueThisMonth > 0) {
        rows.push({
          source: 'PAYROLL_SCHEDULED',
          id: `vacation-${competence}`,
          payeeId: null,
          payeeName: 'Colaboradores',
          description: `Férias (${fp.vacation.recordCount} recibos)`,
          amount: fp.vacation.dueThisMonth,
          paymentState: 'EXPECTED',
          dueDate: null,
          method: null,
          settleVia: 'VACATION',
          isEstimate: true,
          competence,
          subtype: 'Férias',
        });
      }

      // 5) Recorrentes legados (per category) — settled by reconciliation.
      // Skip categories promoted to a first-class RecurrentPayable (shown below).
      for (const item of forecast.recorrentes?.items ?? []) {
        if (promotedCategoryIds.has(item.category.id)) continue;
        const paid = item.status === 'PAID';
        rows.push({
          source: 'RECURRING',
          id: `recurring-${item.category.id}`,
          payeeId: item.category.id,
          payeeName: item.category.name,
          description: item.category.name,
          amount: paid ? item.paidAmount : item.forecastAmount,
          paymentState: paid ? 'PAID' : 'EXPECTED',
          dueDate: item.paymentDate ?? null,
          method: null,
          settleVia: 'RECONCILIATION',
          isEstimate: !paid,
          competence,
          subtype: (item.category as { recurrenceKind?: string }).recurrenceKind === 'FIXED' ? 'Fixo' : 'Variável',
        });
      }

      // 6) Contas recorrentes (first-class) — materialized monthly occurrences.
      // VARIABLE bills show the estimate (italic) until paid; the pay action
      // prompts for the real amount. FIXED bills settle with the known amount.
      for (const { occurrence, payable } of recurrentRows) {
        const paid = occurrence.status === 'PAID';
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
          dueDate: occurrence.dueDate,
          method: occurrence.paymentMethod ?? payable.paymentMethod ?? null,
          paidAt: occurrence.paidAt ?? null,
          settleVia: paid ? 'NONE' : 'RECURRENT_PAYABLE',
          // Only an unpaid VARIABLE bill is a true estimate (real amount typed on pay).
          isEstimate: !paid && isVariable,
          competence,
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
      await this.annotateClearance(rows, payrollSettlement?.id ?? null, competence);

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
    const orderInstallmentIds = new Set<string>();
    const airbrushingIds = new Set<string>();
    const recurrentOccurrenceIds = new Set<string>();
    for (const r of rows) {
      r.clearanceState = 'UNCLEARED';
      r.clearedAt = null;
      r.bankTransactionId = null;
      if (r.source === 'ORDER' && r.installmentId) orderInstallmentIds.add(r.installmentId);
      else if (r.source === 'AIRBRUSHING') airbrushingIds.add(r.id);
      else if (r.source === 'RECURRENT_PAYABLE') recurrentOccurrenceIds.add(r.id);
    }

    const anchorIds: string[] = [
      ...orderInstallmentIds,
      ...airbrushingIds,
      ...recurrentOccurrenceIds,
    ];
    if (anchorIds.length === 0 && !payrollSettlementId) return;

    const matches = await this.prisma.reconciliationMatch.findMany({
      where: {
        reversedAt: null,
        OR: [
          orderInstallmentIds.size ? { orderInstallmentId: { in: [...orderInstallmentIds] } } : undefined,
          airbrushingIds.size ? { airbrushingId: { in: [...airbrushingIds] } } : undefined,
          recurrentOccurrenceIds.size ? { recurrentOccurrenceId: { in: [...recurrentOccurrenceIds] } } : undefined,
          payrollSettlementId ? { payrollMonthSettlementId: payrollSettlementId } : undefined,
        ].filter(Boolean) as object[],
      },
      select: {
        allocatedAmount: true,
        transactionId: true,
        matchedAt: true,
        orderInstallmentId: true,
        airbrushingId: true,
        recurrentOccurrenceId: true,
        payrollMonthSettlementId: true,
      },
    });

    const byOrderInstallment = new Map<string, AnchorMatch>();
    const byAirbrushing = new Map<string, AnchorMatch>();
    const byRecurrent = new Map<string, AnchorMatch>();
    let payrollMatch: AnchorMatch | null = null;
    for (const m of matches) {
      const am: AnchorMatch = {
        allocatedAmount: Number(m.allocatedAmount),
        transactionId: m.transactionId,
        matchedAt: m.matchedAt,
      };
      if (m.orderInstallmentId) byOrderInstallment.set(m.orderInstallmentId, am);
      else if (m.airbrushingId) byAirbrushing.set(m.airbrushingId, am);
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
      if (r.source === 'ORDER' && r.installmentId) apply(r, byOrderInstallment.get(r.installmentId));
      else if (r.source === 'AIRBRUSHING') apply(r, byAirbrushing.get(r.id));
      else if (r.source === 'RECURRENT_PAYABLE') apply(r, byRecurrent.get(r.id));
      else if (r.source === 'PAYROLL' && r.competence === competence) apply(r, payrollMatch);
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
