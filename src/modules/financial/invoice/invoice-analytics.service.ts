import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  INVOICE_STATUS,
  INSTALLMENT_STATUS,
  BANK_SLIP_STATUS,
  BANK_SLIP_TYPE,
  TASK_QUOTE_STATUS,
  NFSE_STATUS,
  WEBHOOK_EVENT_STATUS,
} from '../../../constants/enums';
import {
  businessPeriodStart,
  businessPeriodEnd,
  getPeriodForDate,
} from '../../../utils/business-period';
import {
  TASK_QUOTE_STATUS_LABELS,
  NFSE_STATUS_LABELS,
} from '../../../constants/enum-labels';
import type {
  CollectionAnalyticsData,
  CollectionItem,
  AgingBand,
  RevenueFunnel,
  BankSlipPerformanceData,
  BankSlipPerformanceItem,
  StatusDistributionItem,
  TypeDistributionItem,
  QuoteFunnelAnalyticsFilters,
  QuoteFunnelAnalyticsData,
  QuoteFunnelStage,
  QuoteFunnelItem,
  QuoteTopCustomer,
  QuoteTopSector,
  ReceivablesAnalyticsFilters,
  ReceivablesAnalyticsData,
  ForecastPeriodBucket,
  RecoveryCohort,
  SicrediWebhookAnalyticsFilters,
  SicrediWebhookAnalyticsData,
  SicrediMonthlyItem,
  SicrediMovementRow,
  SicrediErrorRow,
  NfseAnalyticsFilters,
  NfseAnalyticsData,
  NfseStatusDistribution,
  NfseMonthlyItem,
  NfseErrorRow,
} from '../../../types/invoice-analytics';

const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const DAY_MS = 1000 * 60 * 60 * 24;

function diffDays(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY_MS;
}

function monthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTH_NAMES_PT[parseInt(month, 10) - 1]} ${year}`;
}

function weekKey(date: Date): string {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((date.getTime() - startOfYear.getTime()) / DAY_MS + startOfYear.getDay() + 1) / 7,
  );
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

const BANK_SLIP_STATUS_LABELS: Record<string, string> = {
  [BANK_SLIP_STATUS.CREATING]: 'Criando',
  [BANK_SLIP_STATUS.REGISTERING]: 'Registrando',
  [BANK_SLIP_STATUS.ACTIVE]: 'Ativo',
  [BANK_SLIP_STATUS.OVERDUE]: 'Vencido',
  [BANK_SLIP_STATUS.PAID]: 'Pago',
  [BANK_SLIP_STATUS.CANCELLED]: 'Cancelado',
  [BANK_SLIP_STATUS.REJECTED]: 'Rejeitado',
  [BANK_SLIP_STATUS.ERROR]: 'Erro',
};

interface AnalyticsFilters {
  customerIds?: string[];
  status?: string[];
  startDate?: Date;
  endDate?: Date;
  groupBy?: string;
  // Business period (26→25) filtering. When `periods` is provided,
  // startDate/endDate are ignored and the range is derived from the union of
  // the given periods. Each period is identified by the month that *closes* it.
  periods?: Array<{ year: number; month: number }>;
  periodGroupBy?: 'period' | 'day';
}

@Injectable()
export class InvoiceAnalyticsService {
  private readonly logger = new Logger(InvoiceAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // 1. Collection Analytics
  // ---------------------------------------------------------------------------

  async getCollectionAnalytics(filters: AnalyticsFilters): Promise<CollectionAnalyticsData> {
    const { customerIds, status, periods, periodGroupBy = 'period' } = filters;
    const dateRange = this.resolveDateRange(filters);
    const now = new Date();

    // The list of selected business periods. When the caller passes `periods`,
    // those are the buckets the UI will render. When they don't, we synthesize
    // one bucket per business period the date range overlaps.
    const selectedPeriods = this.collectPeriods(periods, dateRange);
    const selectedKeys = new Set(
      selectedPeriods.map(p => `${p.year}-${String(p.month).padStart(2, '0')}`),
    );

    // Pass A — cash-in: installments whose paidAt falls inside the range.
    // Build the optional invoice subfilter once so customer + status compose.
    const invoiceSubfilter: any = {};
    if (customerIds?.length) invoiceSubfilter.customerId = { in: customerIds };
    if (status?.length) invoiceSubfilter.status = { in: status };
    else invoiceSubfilter.status = { not: INVOICE_STATUS.CANCELLED };

    const cashPaidInstallments = await this.prisma.installment.findMany({
      where: {
        paidAt: { gte: dateRange.start, lte: dateRange.end },
        status: INSTALLMENT_STATUS.PAID,
        invoice: invoiceSubfilter,
      },
      select: {
        id: true,
        amount: true,
        paidAmount: true,
        paidAt: true,
        dueDate: true,
        status: true,
      },
    });

    // Pass B — invoices created in the range (drives invoicedAmount per period
    // and the global funnel/aging snapshots).
    const invoiceWhere: any = {
      createdAt: {
        gte: dateRange.start,
        lte: dateRange.end,
      },
      status: { not: INVOICE_STATUS.CANCELLED },
      ...(customerIds?.length && { customerId: { in: customerIds } }),
      ...(status?.length && { status: { in: status } }),
    };

    const invoices = await this.prisma.invoice.findMany({
      where: invoiceWhere,
      select: {
        id: true,
        totalAmount: true,
        paidAmount: true,
        status: true,
        createdAt: true,
        installments: {
          select: {
            id: true,
            amount: true,
            paidAmount: true,
            paidAt: true,
            dueDate: true,
            status: true,
            bankSlip: {
              select: {
                id: true,
                amount: true,
                status: true,
              },
            },
          },
        },
      },
    });

    // ---------- Items: grouped by business period (26→25) ----------
    const byPeriod = new Map<
      string,
      { invoicedAmount: number; paidAmount: number; overdueAmount: number }
    >();

    const ensureBucket = (key: string) => {
      if (!byPeriod.has(key)) {
        byPeriod.set(key, { invoicedAmount: 0, paidAmount: 0, overdueAmount: 0 });
      }
      return byPeriod.get(key)!;
    };

    // Seed buckets so every selected period appears even if it has zero cash.
    selectedPeriods.forEach(p => ensureBucket(`${p.year}-${String(p.month).padStart(2, '0')}`));

    // Cash in (paidAt → period).
    for (const inst of cashPaidInstallments) {
      if (!inst.paidAt) continue;
      const { key } = getPeriodForDate(inst.paidAt);
      if (!selectedKeys.has(key)) continue;
      ensureBucket(key).paidAmount += Number(inst.paidAmount);
    }

    // Invoiced (createdAt → period) + per-period overdue (dueDate → period).
    for (const invoice of invoices) {
      const { key: createdKey } = getPeriodForDate(invoice.createdAt);
      if (selectedKeys.has(createdKey)) {
        ensureBucket(createdKey).invoicedAmount += Number(invoice.totalAmount);
      }

      for (const inst of invoice.installments) {
        const isOverdue =
          inst.status === INSTALLMENT_STATUS.OVERDUE ||
          (inst.dueDate < now &&
            inst.status !== INSTALLMENT_STATUS.PAID &&
            inst.status !== INSTALLMENT_STATUS.CANCELLED);
        if (!isOverdue) continue;

        const { key: dueKey } = getPeriodForDate(inst.dueDate);
        if (!selectedKeys.has(dueKey)) continue;
        ensureBucket(dueKey).overdueAmount += Number(inst.amount) - Number(inst.paidAmount);
      }
    }

    const sortedKeys = Array.from(byPeriod.keys()).sort();

    const items: CollectionItem[] = sortedKeys.map(key => {
      const data = byPeriod.get(key)!;
      const collectionRate =
        data.invoicedAmount > 0
          ? Math.round((data.paidAmount / data.invoicedAmount) * 1000) / 10
          : 0;

      return {
        period: key,
        periodLabel: monthLabel(key),
        invoicedAmount: Math.round(data.invoicedAmount * 100) / 100,
        paidAmount: Math.round(data.paidAmount * 100) / 100,
        collectionRate,
        overdueAmount: Math.round(data.overdueAmount * 100) / 100,
      };
    });

    // periodGroupBy hook: filter-shape accepts 'day' so the UI can opt into a
    // day-by-day expansion later without another endpoint. Silence the unused
    // var warning until that mode is implemented.
    void periodGroupBy;

    // ---------- Summary ----------
    // Cash-basis totals from the per-period buckets so the summary matches the
    // chart. Items already filter to selected periods.
    const totalInvoiced = items.reduce((sum, it) => sum + it.invoicedAmount, 0);
    const totalPaid = items.reduce((sum, it) => sum + it.paidAmount, 0);
    const collectionRate =
      totalInvoiced > 0 ? Math.round((totalPaid / totalInvoiced) * 1000) / 10 : 0;

    // Avg days to payment: from dueDate to paidAt for installments paid in
    // the selected periods (cash basis).
    const periodPaidInstallments = cashPaidInstallments.filter(inst => {
      if (!inst.paidAt) return false;
      const { key } = getPeriodForDate(inst.paidAt);
      return selectedKeys.has(key);
    });
    const daysToPayment = periodPaidInstallments.map(inst =>
      diffDays(inst.dueDate, inst.paidAt!),
    );
    const avgDaysToPayment =
      daysToPayment.length > 0
        ? Math.round((daysToPayment.reduce((a, b) => a + b, 0) / daysToPayment.length) * 10) / 10
        : 0;

    // allInstallments still used by overdue/aging/funnel below — snapshot
    // semantics, not bucketed by period.
    const allInstallments = invoices.flatMap(inv => inv.installments);

    // Total overdue
    const overdueInstallments = allInstallments.filter(
      inst =>
        inst.status === INSTALLMENT_STATUS.OVERDUE ||
        (inst.dueDate < now &&
          inst.status !== INSTALLMENT_STATUS.PAID &&
          inst.status !== INSTALLMENT_STATUS.CANCELLED),
    );
    const totalOverdue =
      Math.round(
        overdueInstallments.reduce(
          (sum, inst) => sum + (Number(inst.amount) - Number(inst.paidAmount)),
          0,
        ) * 100,
      ) / 100;

    const activeInstallments = allInstallments.filter(
      inst => inst.status !== INSTALLMENT_STATUS.CANCELLED,
    );
    const overdueRate =
      activeInstallments.length > 0
        ? Math.round((overdueInstallments.length / activeInstallments.length) * 1000) / 10
        : 0;

    // ---------- Aging analysis ----------
    const agingBands: AgingBand[] = [
      { band: '0-30', bandLabel: '0 a 30 dias', count: 0, amount: 0 },
      { band: '31-60', bandLabel: '31 a 60 dias', count: 0, amount: 0 },
      { band: '61-90', bandLabel: '61 a 90 dias', count: 0, amount: 0 },
      { band: '90+', bandLabel: 'Mais de 90 dias', count: 0, amount: 0 },
    ];

    for (const inst of overdueInstallments) {
      const daysOverdue = diffDays(inst.dueDate, now);
      const overdueAmount = Number(inst.amount) - Number(inst.paidAmount);

      let bandIndex: number;
      if (daysOverdue <= 30) bandIndex = 0;
      else if (daysOverdue <= 60) bandIndex = 1;
      else if (daysOverdue <= 90) bandIndex = 2;
      else bandIndex = 3;

      agingBands[bandIndex].count++;
      agingBands[bandIndex].amount =
        Math.round((agingBands[bandIndex].amount + overdueAmount) * 100) / 100;
    }

    // ---------- Revenue funnel ----------
    const invoicedTotal =
      Math.round(invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0) * 100) / 100;

    const billedTotal =
      Math.round(
        allInstallments
          .filter(inst => inst.bankSlip != null)
          .reduce((sum, inst) => sum + Number(inst.amount), 0) * 100,
      ) / 100;

    // Funnel "collected": cash-basis total for selected periods (matches the
    // Total Recebido KPI). Use the explicit `totalPaid` already computed above.
    const collectedTotal = Math.round(totalPaid * 100) / 100;

    const outstandingTotal = Math.round((invoicedTotal - collectedTotal) * 100) / 100;

    const revenueFunnel: RevenueFunnel = {
      invoiced: invoicedTotal,
      billed: billedTotal,
      collected: collectedTotal,
      outstanding: outstandingTotal,
    };

    return {
      summary: {
        collectionRate,
        avgDaysToPayment,
        totalOverdue,
        overdueRate,
      },
      items,
      agingAnalysis: agingBands,
      revenueFunnel,
    };
  }

  // ---------------------------------------------------------------------------
  // 2. Bank Slip Performance
  // ---------------------------------------------------------------------------

  async getBankSlipPerformance(filters: AnalyticsFilters): Promise<BankSlipPerformanceData> {
    const { customerIds, status, groupBy = 'month' } = filters;
    const dateRange = this.resolveDateRange(filters);
    const now = new Date();

    const keyFn = groupBy === 'week' ? weekKey : monthKey;

    const bankSlipWhere: any = {
      createdAt: {
        gte: dateRange.start,
        lte: dateRange.end,
      },
      ...(status?.length && { status: { in: status } }),
      ...(customerIds?.length && {
        installment: {
          invoice: {
            customerId: { in: customerIds },
          },
        },
      }),
    };

    const bankSlips = await this.prisma.bankSlip.findMany({
      where: bankSlipWhere,
      select: {
        id: true,
        type: true,
        amount: true,
        dueDate: true,
        status: true,
        paidAmount: true,
        paidAt: true,
        createdAt: true,
      },
    });

    // ---------- Items: grouped by period ----------
    const byPeriod = new Map<string, { totalSlips: number; paidSlips: number; delays: number[] }>();

    for (const slip of bankSlips) {
      const key = keyFn(slip.createdAt);
      if (!byPeriod.has(key)) {
        byPeriod.set(key, { totalSlips: 0, paidSlips: 0, delays: [] });
      }
      const bucket = byPeriod.get(key)!;
      bucket.totalSlips++;

      if (slip.status === BANK_SLIP_STATUS.PAID && slip.paidAt) {
        bucket.paidSlips++;
        const delay = diffDays(slip.dueDate, slip.paidAt);
        if (delay > 0) {
          bucket.delays.push(delay);
        }
      }
    }

    const sortedKeys = Array.from(byPeriod.keys()).sort();

    const items: BankSlipPerformanceItem[] = sortedKeys.map(key => {
      const data = byPeriod.get(key)!;
      const conversionRate =
        data.totalSlips > 0 ? Math.round((data.paidSlips / data.totalSlips) * 1000) / 10 : 0;
      const avgDelay =
        data.delays.length > 0
          ? Math.round((data.delays.reduce((a, b) => a + b, 0) / data.delays.length) * 10) / 10
          : 0;

      return {
        period: key,
        periodLabel: groupBy === 'week' ? key : monthLabel(key),
        totalSlips: data.totalSlips,
        paidSlips: data.paidSlips,
        conversionRate,
        avgDelay,
      };
    });

    // ---------- Summary ----------
    const totalSlips = bankSlips.length;
    const paidSlips = bankSlips.filter(s => s.status === BANK_SLIP_STATUS.PAID).length;
    const conversionRate = totalSlips > 0 ? Math.round((paidSlips / totalSlips) * 1000) / 10 : 0;

    const allDelays = bankSlips
      .filter(s => s.status === BANK_SLIP_STATUS.PAID && s.paidAt)
      .map(s => diffDays(s.dueDate, s.paidAt!))
      .filter(d => d > 0);

    const avgDelayDays =
      allDelays.length > 0
        ? Math.round((allDelays.reduce((a, b) => a + b, 0) / allDelays.length) * 10) / 10
        : 0;

    const errorSlips = bankSlips.filter(
      s => s.status === BANK_SLIP_STATUS.ERROR || s.status === BANK_SLIP_STATUS.REJECTED,
    ).length;
    const errorRate = totalSlips > 0 ? Math.round((errorSlips / totalSlips) * 1000) / 10 : 0;

    const activeSlips = bankSlips.filter(
      s => s.status === BANK_SLIP_STATUS.ACTIVE || s.status === BANK_SLIP_STATUS.OVERDUE,
    ).length;

    // ---------- Status distribution ----------
    const statusCounts = new Map<string, { count: number; amount: number }>();
    for (const slip of bankSlips) {
      const existing = statusCounts.get(slip.status) || { count: 0, amount: 0 };
      existing.count++;
      existing.amount += Number(slip.amount);
      statusCounts.set(slip.status, existing);
    }

    const statusDistribution: StatusDistributionItem[] = Array.from(statusCounts.entries()).map(
      ([statusKey, data]) => ({
        status: statusKey,
        statusLabel: BANK_SLIP_STATUS_LABELS[statusKey] || statusKey,
        count: data.count,
        amount: Math.round(data.amount * 100) / 100,
      }),
    );

    // ---------- Type distribution (PIX vs Boleto) ----------
    const typeCounts = new Map<string, { count: number; amount: number; paidCount: number }>();

    for (const slip of bankSlips) {
      const slipType = slip.type || BANK_SLIP_TYPE.NORMAL;
      const existing = typeCounts.get(slipType) || { count: 0, amount: 0, paidCount: 0 };
      existing.count++;
      existing.amount += Number(slip.amount);
      if (slip.status === BANK_SLIP_STATUS.PAID) {
        existing.paidCount++;
      }
      typeCounts.set(slipType, existing);
    }

    const typeDistribution: TypeDistributionItem[] = Array.from(typeCounts.entries()).map(
      ([typeKey, data]) => ({
        type: typeKey,
        typeLabel: typeKey === BANK_SLIP_TYPE.HIBRIDO ? 'PIX + Boleto (Hibrido)' : 'Boleto',
        count: data.count,
        amount: Math.round(data.amount * 100) / 100,
        paidCount: data.paidCount,
        conversionRate: data.count > 0 ? Math.round((data.paidCount / data.count) * 1000) / 10 : 0,
      }),
    );

    return {
      summary: {
        conversionRate,
        avgDelayDays,
        errorRate,
        activeSlips,
      },
      items,
      statusDistribution,
      typeDistribution,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private resolveDateRange(filters: AnalyticsFilters): { start: Date; end: Date } {
    // Business-period filtering takes precedence over raw start/end.
    if (filters.periods?.length) {
      const sorted = [...filters.periods].sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.month - b.month;
      });
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      return {
        start: businessPeriodStart(first.year, first.month),
        end: businessPeriodEnd(last.year, last.month),
      };
    }

    if (filters.startDate && filters.endDate) {
      return { start: new Date(filters.startDate), end: new Date(filters.endDate) };
    }

    // Default: last 12 months
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 12);
    return { start, end };
  }

  // Resolves the list of business periods the analytics should bucket into.
  // When the caller passes `periods`, use them as-is. Otherwise infer the set
  // of periods that overlap `dateRange` so a no-periods call still buckets by
  // 26→25 windows instead of falling back to calendar months.
  private collectPeriods(
    periods: Array<{ year: number; month: number }> | undefined,
    dateRange: { start: Date; end: Date },
  ): Array<{ year: number; month: number }> {
    if (periods?.length) return periods;

    const result: Array<{ year: number; month: number }> = [];
    const startPeriod = getPeriodForDate(dateRange.start);
    const endPeriod = getPeriodForDate(dateRange.end);
    let y = startPeriod.year;
    let m = startPeriod.month;
    // Walk forward one period at a time until we pass endPeriod.
    // Guard against runaway loops with a hard cap.
    for (let i = 0; i < 240; i++) {
      result.push({ year: y, month: m });
      if (y === endPeriod.year && m === endPeriod.month) break;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // 3. Quote Funnel Analytics
  // ---------------------------------------------------------------------------
  //
  // Models the sales pipeline through TaskQuote statuses.
  // Logical funnel stages (counted at each gate the quote PASSED, regardless
  // of current status — so SETTLED quotes count toward every prior stage):
  //
  //   1. PENDING (quote created)
  //   2. BUDGET_APPROVED (customer accepted price)
  //   3. COMMERCIAL_APPROVED (commercial approved)
  //   4. BILLING_APPROVED+ (billing approved — invoices materialized; covers
  //      everything past internal approval: UPCOMING/DUE/PARTIAL/SETTLED)
  //
  // Quotes never abandoned still progress; cancelled quotes are excluded
  // upstream. statusOrder is the monotone index used to derive "passed".

  async getQuoteFunnelAnalytics(
    filters: QuoteFunnelAnalyticsFilters,
  ): Promise<QuoteFunnelAnalyticsData> {
    const { customerIds, sectorIds, status, groupBy = 'month' } = filters;
    const dateRange = this.resolveDateRange(filters);
    const keyFn = groupBy === 'week' ? weekKey : monthKey;

    // Status order positions (matches TASK_QUOTE_STATUS_ORDER in domain)
    const STATUS_ORDER: Record<string, number> = {
      [TASK_QUOTE_STATUS.PENDING]: 1,
      [TASK_QUOTE_STATUS.BUDGET_APPROVED]: 2,
      [TASK_QUOTE_STATUS.COMMERCIAL_APPROVED]: 3,
      [TASK_QUOTE_STATUS.BILLING_APPROVED]: 4,
      [TASK_QUOTE_STATUS.UPCOMING]: 5,
      [TASK_QUOTE_STATUS.DUE]: 6,
      [TASK_QUOTE_STATUS.PARTIAL]: 7,
      [TASK_QUOTE_STATUS.SETTLED]: 8,
    };

    // Build where clause for quotes (joining to Task for sector/customer filters)
    const where: any = {
      createdAt: { gte: dateRange.start, lte: dateRange.end },
      ...(status?.length && { status: { in: status } }),
    };

    if (customerIds?.length || sectorIds?.length) {
      where.task = {
        ...(customerIds?.length && { customerId: { in: customerIds } }),
        ...(sectorIds?.length && { sectorId: { in: sectorIds } }),
      };
    }

    const quotes = await this.prisma.taskQuote.findMany({
      where,
      select: {
        id: true,
        total: true,
        status: true,
        statusOrder: true,
        createdAt: true,
        billingApprovedAt: true,
        task: {
          select: {
            id: true,
            customerId: true,
            sectorId: true,
            customer: { select: { id: true, fantasyName: true } },
            sector: { select: { id: true, name: true } },
          },
        },
      },
    });

    // ---------- Funnel stages ----------
    const stageDefs: Array<{ stage: string; orderThreshold: number }> = [
      { stage: TASK_QUOTE_STATUS.PENDING, orderThreshold: 1 },
      { stage: TASK_QUOTE_STATUS.BUDGET_APPROVED, orderThreshold: 2 },
      { stage: TASK_QUOTE_STATUS.COMMERCIAL_APPROVED, orderThreshold: 3 },
      { stage: TASK_QUOTE_STATUS.BILLING_APPROVED, orderThreshold: 4 },
    ];

    const totalEntries = quotes.length;
    const funnel: QuoteFunnelStage[] = stageDefs.map((def, idx) => {
      const reached = quotes.filter(
        q => (q.statusOrder ?? STATUS_ORDER[q.status] ?? 1) >= def.orderThreshold,
      );
      const count = reached.length;
      const totalValue = reached.reduce((s, q) => s + Number(q.total), 0);
      const prevCount = idx === 0 ? totalEntries : 0;
      // For non-first stages, look up previous stage's reached count
      const previousReached =
        idx === 0
          ? totalEntries
          : quotes.filter(
              q =>
                (q.statusOrder ?? STATUS_ORDER[q.status] ?? 1) >=
                stageDefs[idx - 1].orderThreshold,
            ).length;

      const conversionFromPrevious =
        previousReached > 0 ? Math.round((count / previousReached) * 1000) / 10 : 0;
      const conversionFromTop =
        totalEntries > 0 ? Math.round((count / totalEntries) * 1000) / 10 : 0;

      // avg days from creation to reaching this stage (approximate: use createdAt vs now for not-yet-billing, billingApprovedAt for billing-approved)
      const ages = reached
        .map(q => {
          if (def.orderThreshold >= 4 && q.billingApprovedAt) {
            return diffDays(q.createdAt, q.billingApprovedAt);
          }
          // for upstream stages we don't have stage-transition timestamps,
          // so we use current age as a proxy (only meaningful for current-stage quotes)
          if ((q.statusOrder ?? STATUS_ORDER[q.status] ?? 1) === def.orderThreshold) {
            return diffDays(q.createdAt, new Date());
          }
          return null;
        })
        .filter((d): d is number => d !== null && d >= 0);
      const avgDaysFromCreation =
        ages.length > 0 ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : 0;

      // Suppress unused-var warning for prevCount (kept for readability)
      void prevCount;

      return {
        stage: def.stage,
        stageLabel: TASK_QUOTE_STATUS_LABELS[def.stage as keyof typeof TASK_QUOTE_STATUS_LABELS],
        count,
        totalValue: Math.round(totalValue * 100) / 100,
        conversionFromPrevious,
        conversionFromTop,
        avgDaysFromCreation,
      };
    });

    // ---------- Monthly time series ----------
    const periodMap = new Map<
      string,
      {
        newQuotes: number;
        approvedQuotes: number;
        billedQuotes: number;
        settledQuotes: number;
        totalValue: number;
        settledValue: number;
      }
    >();

    for (const q of quotes) {
      const key = keyFn(q.createdAt);
      if (!periodMap.has(key)) {
        periodMap.set(key, {
          newQuotes: 0,
          approvedQuotes: 0,
          billedQuotes: 0,
          settledQuotes: 0,
          totalValue: 0,
          settledValue: 0,
        });
      }
      const bucket = periodMap.get(key)!;
      const sOrder = q.statusOrder ?? STATUS_ORDER[q.status] ?? 1;
      bucket.newQuotes++;
      bucket.totalValue += Number(q.total);
      if (sOrder >= 2) bucket.approvedQuotes++;
      if (sOrder >= 4) bucket.billedQuotes++;
      if (q.status === TASK_QUOTE_STATUS.SETTLED) {
        bucket.settledQuotes++;
        bucket.settledValue += Number(q.total);
      }
    }

    const sortedKeys = Array.from(periodMap.keys()).sort();
    const items: QuoteFunnelItem[] = sortedKeys.map(key => {
      const b = periodMap.get(key)!;
      return {
        period: key,
        periodLabel: groupBy === 'week' ? key : monthLabel(key),
        newQuotes: b.newQuotes,
        approvedQuotes: b.approvedQuotes,
        billedQuotes: b.billedQuotes,
        settledQuotes: b.settledQuotes,
        totalValue: Math.round(b.totalValue * 100) / 100,
        settledValue: Math.round(b.settledValue * 100) / 100,
      };
    });

    // ---------- Top customers ----------
    const customerMap = new Map<
      string,
      { id: string; name: string; count: number; total: number; settled: number }
    >();
    for (const q of quotes) {
      const c = q.task?.customer;
      if (!c) continue;
      if (!customerMap.has(c.id)) {
        customerMap.set(c.id, { id: c.id, name: c.fantasyName, count: 0, total: 0, settled: 0 });
      }
      const entry = customerMap.get(c.id)!;
      entry.count++;
      entry.total += Number(q.total);
      if (q.status === TASK_QUOTE_STATUS.SETTLED) {
        entry.settled += Number(q.total);
      }
    }
    const topCustomers: QuoteTopCustomer[] = Array.from(customerMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 20)
      .map(c => ({
        customerId: c.id,
        customerName: c.name,
        quoteCount: c.count,
        totalValue: Math.round(c.total * 100) / 100,
        settledValue: Math.round(c.settled * 100) / 100,
        conversionRate: c.total > 0 ? Math.round((c.settled / c.total) * 1000) / 10 : 0,
      }));

    // ---------- Top sectors ----------
    const sectorMap = new Map<
      string,
      { id: string; name: string; count: number; total: number; settled: number }
    >();
    for (const q of quotes) {
      const s = q.task?.sector;
      if (!s) continue;
      if (!sectorMap.has(s.id)) {
        sectorMap.set(s.id, { id: s.id, name: s.name, count: 0, total: 0, settled: 0 });
      }
      const entry = sectorMap.get(s.id)!;
      entry.count++;
      entry.total += Number(q.total);
      if (q.status === TASK_QUOTE_STATUS.SETTLED) {
        entry.settled += Number(q.total);
      }
    }
    const topSectors: QuoteTopSector[] = Array.from(sectorMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map(s => ({
        sectorId: s.id,
        sectorName: s.name,
        quoteCount: s.count,
        totalValue: Math.round(s.total * 100) / 100,
        settledValue: Math.round(s.settled * 100) / 100,
      }));

    // ---------- Summary ----------
    const totalQuotes = quotes.length;
    const totalQuotedValue = quotes.reduce((s, q) => s + Number(q.total), 0);
    const settledQuotes = quotes.filter(q => q.status === TASK_QUOTE_STATUS.SETTLED);
    const totalSettledValue = settledQuotes.reduce((s, q) => s + Number(q.total), 0);
    const conversionRate =
      totalQuotes > 0 ? Math.round((settledQuotes.length / totalQuotes) * 1000) / 10 : 0;
    const avgTicket =
      settledQuotes.length > 0
        ? Math.round((totalSettledValue / settledQuotes.length) * 100) / 100
        : 0;

    const cycles = quotes
      .filter(q => q.billingApprovedAt)
      .map(q => diffDays(q.createdAt, q.billingApprovedAt!))
      .filter(d => d >= 0);
    const avgSalesCycleDays =
      cycles.length > 0
        ? Math.round((cycles.reduce((a, b) => a + b, 0) / cycles.length) * 10) / 10
        : 0;

    const activeBacklogValue = quotes
      .filter(q => q.status !== TASK_QUOTE_STATUS.SETTLED)
      .reduce((s, q) => s + Number(q.total), 0);

    return {
      summary: {
        totalQuotes,
        totalQuotedValue: Math.round(totalQuotedValue * 100) / 100,
        totalSettledValue: Math.round(totalSettledValue * 100) / 100,
        conversionRate,
        avgTicket,
        avgSalesCycleDays,
        activeBacklogValue: Math.round(activeBacklogValue * 100) / 100,
      },
      funnel,
      items,
      topCustomers,
      topSectors,
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Receivables Analytics (per-customer aging, DSO, forecast, cohort)
  // ---------------------------------------------------------------------------

  async getReceivablesAnalytics(
    filters: ReceivablesAnalyticsFilters & { status?: string[] },
  ): Promise<ReceivablesAnalyticsData> {
    const {
      customerIds,
      status,
      forecastPeriodType = 'month',
      forecastPeriodCount = 4,
    } = filters;
    void filters.limit; // retained in schema for compat; not used now
    const now = new Date();
    const dateRange = this.resolveDateRange(filters);

    // Clamp forecast count so the loop terminates and we don't request 1000 buckets
    const periodCount = Math.max(1, Math.min(12, Math.floor(forecastPeriodCount)));

    // Get all non-cancelled installments via their invoice's customer.
    // Honor caller-supplied invoice status filter (same shape collection uses)
    // so receivables and the cash-flow chart stay in sync.
    const invoiceSubfilter: any = {};
    if (customerIds?.length) invoiceSubfilter.customerId = { in: customerIds };
    if (status?.length) invoiceSubfilter.status = { in: status };
    else invoiceSubfilter.status = { not: INVOICE_STATUS.CANCELLED };

    const installments = await this.prisma.installment.findMany({
      where: {
        status: { not: INSTALLMENT_STATUS.CANCELLED },
        invoice: invoiceSubfilter,
      },
      select: {
        id: true,
        number: true,
        amount: true,
        paidAmount: true,
        paidAt: true,
        dueDate: true,
        status: true,
        invoice: {
          select: {
            id: true,
            customerId: true,
            createdAt: true,
            totalAmount: true,
            paidAmount: true,
            task: { select: { id: true, name: true, serialNumber: true } },
            customer: {
              select: {
                id: true,
                fantasyName: true,
              },
            },
            _count: { select: { installments: true } },
          },
        },
      },
    });

    // ---------- Position aggregates (no per-customer breakdown anymore) ----------
    let totalCurrent = 0;
    let totalOverdue = 0;
    let dsoNum = 0; // Σ amount × daysToPay
    let dsoDen = 0; // Σ amount
    const activeCustomerIds = new Set<string>();

    for (const inst of installments) {
      const remaining = Number(inst.amount) - Number(inst.paidAmount);

      // DSO from paid installments — invoice.createdAt → paidAt
      if (inst.status === INSTALLMENT_STATUS.PAID && inst.paidAt && inst.invoice) {
        const daysToPay = diffDays(inst.invoice.createdAt, inst.paidAt);
        if (daysToPay >= 0) {
          dsoNum += Number(inst.amount) * daysToPay;
          dsoDen += Number(inst.amount);
        }
      }

      if (remaining <= 0) continue;
      const customerId = inst.invoice?.customer?.id;
      if (customerId) activeCustomerIds.add(customerId);

      if (inst.dueDate >= now) totalCurrent += remaining;
      else totalOverdue += remaining;
    }

    // ---------- Forecast buckets ----------
    // Period-aligned bucketing. Index 0 = the period that CONTAINS now
    // (the in-progress period — labeled "Atual" client-side); index 1+ are
    // the following periods. Everything past the last bucket is folded into
    // BEYOND so the Total a Receber card's count and amount stay self-
    // consistent (no installment is silently dropped).
    interface PeriodWindow {
      key: string;
      label: string;
      start: Date;
      end: Date;
    }

    // Period windows are STRICTLY in the future — they don't include the
    // in-progress period (that has its own CURRENT bucket below). This keeps
    // the forecast cards self-evidently forward-looking.
    const currentPeriod = forecastPeriodType === 'year'
      ? {
          start: businessPeriodStart(now.getFullYear(), 1),
          end: businessPeriodEnd(now.getFullYear(), 12),
          label: now.getFullYear().toString(),
        }
      : (() => {
          const { year, month } = getPeriodForDate(now);
          return {
            start: businessPeriodStart(year, month),
            end: businessPeriodEnd(year, month),
            label: `${MONTH_NAMES_PT[month - 1]} ${year}`,
          };
        })();

    const computePeriods = (): PeriodWindow[] => {
      const wins: PeriodWindow[] = [];
      if (forecastPeriodType === 'year') {
        const baseYear = now.getFullYear();
        for (let i = 1; i <= periodCount; i++) {
          const y = baseYear + i;
          wins.push({
            key: `P${i}`,
            label: y.toString(),
            start: businessPeriodStart(y, 1),
            end: businessPeriodEnd(y, 12),
          });
        }
      } else {
        let { year: y, month: m } = getPeriodForDate(now);
        for (let i = 1; i <= periodCount; i++) {
          m += 1;
          if (m > 12) { m = 1; y += 1; }
          wins.push({
            key: `P${i}`,
            label: `${MONTH_NAMES_PT[m - 1]} ${y}`,
            start: businessPeriodStart(y, m),
            end: businessPeriodEnd(y, m),
          });
        }
      }
      return wins;
    };

    const periodWindows = computePeriods();
    const forecastHorizonEnd = periodWindows[periodWindows.length - 1]?.end ?? currentPeriod.end;

    // Bucket definitions. OVERDUE + CURRENT (in-progress period) + N forward
    // windows + BEYOND + PAID. CURRENT is what the Total a Receber card
    // includes implicitly — it's exposed so the synthetic "all open" union
    // can drill into it, but it isn't rendered as its own card (the Próximo
    // card and the period-scoped KPIs already cover that visual).
    const bucketDefs: Array<{ bucket: string; bucketLabel: string; start: Date | null; end: Date | null }> = [
      { bucket: 'OVERDUE', bucketLabel: 'Vencidas', start: null, end: null },
      { bucket: 'CURRENT', bucketLabel: `${currentPeriod.label} (em curso)`, start: currentPeriod.start, end: currentPeriod.end },
      ...periodWindows.map(p => ({ bucket: p.key, bucketLabel: p.label, start: p.start, end: p.end })),
      { bucket: 'BEYOND', bucketLabel: 'Além do horizonte', start: null, end: null },
      { bucket: 'PAID', bucketLabel: 'Recebido no período', start: dateRange.start, end: dateRange.end },
    ];

    const BUCKET_CAP = 100;
    const forecastMap: Record<
      string,
      {
        dueAmount: number;
        installmentCount: number;
        instances: Array<typeof installments[number] & { _daysFromNow: number; _isPaid: boolean }>;
      }
    > = {};
    bucketDefs.forEach(b => {
      forecastMap[b.bucket] = { dueAmount: 0, installmentCount: 0, instances: [] };
    });

    for (const inst of installments) {
      const remaining = Number(inst.amount) - Number(inst.paidAmount);

      // PAID bucket: installments whose paidAt falls in the filter window.
      // Independent of remaining (a fully-paid installment is what we want
      // to surface in "Total Recebido"). Filter is open if dateRange is null.
      if (
        inst.status === INSTALLMENT_STATUS.PAID &&
        inst.paidAt &&
        inst.paidAt >= dateRange.start &&
        inst.paidAt <= dateRange.end
      ) {
        forecastMap.PAID.dueAmount += Number(inst.paidAmount);
        forecastMap.PAID.installmentCount++;
        const days = Math.floor(diffDays(now, inst.paidAt));
        forecastMap.PAID.instances.push({ ...inst, _daysFromNow: days, _isPaid: true });
      }

      // Open-position buckets: anything with an unpaid balance > 0. Note we
      // no longer skip status=PAID here — if a PAID-status installment still
      // has remaining > 0 (partial-payment data), the summary already counts
      // it, so the buckets must too. The status field stays on the row.
      if (remaining <= 0) continue;

      let bucketKey: string;
      if (inst.dueDate < now) {
        bucketKey = 'OVERDUE';
      } else if (inst.dueDate <= currentPeriod.end) {
        // Due in the in-progress period, not yet overdue.
        bucketKey = 'CURRENT';
      } else if (inst.dueDate > forecastHorizonEnd) {
        bucketKey = 'BEYOND';
      } else {
        const found = periodWindows.find(
          p => inst.dueDate >= p.start && inst.dueDate <= p.end,
        );
        bucketKey = found ? found.key : 'BEYOND';
      }

      forecastMap[bucketKey].dueAmount += remaining;
      forecastMap[bucketKey].installmentCount++;
      const days = Math.floor(diffDays(now, inst.dueDate));
      forecastMap[bucketKey].instances.push({ ...inst, _daysFromNow: days, _isPaid: false });
    }

    const forecastBuckets: ForecastPeriodBucket[] = bucketDefs.map(b => {
      const m = forecastMap[b.bucket];
      // PAID sorts newest-first (most recent payment on top); everything else
      // sorts oldest-due-first so OVERDUE shows the most-stale items.
      const sorted = [...m.instances].sort((a, c) => {
        if (b.bucket === 'PAID') {
          const ap = a.paidAt?.getTime() ?? 0;
          const cp = c.paidAt?.getTime() ?? 0;
          return cp - ap;
        }
        return a.dueDate.getTime() - c.dueDate.getTime();
      });
      const capped = sorted.slice(0, BUCKET_CAP);
      return {
        bucket: b.bucket,
        bucketLabel: b.bucketLabel,
        periodStart: b.start ? b.start.toISOString() : null,
        periodEnd: b.end ? b.end.toISOString() : null,
        dueAmount: Math.round(m.dueAmount * 100) / 100,
        installmentCount: m.installmentCount,
        truncated: m.instances.length > BUCKET_CAP,
        installments: capped.map(inst => {
          const remaining = Number(inst.amount) - Number(inst.paidAmount);
          return {
            installmentId: inst.id,
            invoiceId: inst.invoice?.id ?? null,
            customerId: inst.invoice?.customer?.id ?? '',
            customerName: inst.invoice?.customer?.fantasyName ?? 'Cliente sem nome',
            taskId: inst.invoice?.task?.id ?? null,
            taskName: inst.invoice?.task?.name ?? null,
            taskSerialNumber: inst.invoice?.task?.serialNumber ?? null,
            invoiceTotalAmount: Number(inst.invoice?.totalAmount ?? 0),
            installmentNumber: inst.number,
            totalInstallments: inst.invoice?._count?.installments ?? 0,
            dueDate: inst.dueDate.toISOString(),
            paidAt: inst.paidAt ? inst.paidAt.toISOString() : null,
            amount: Number(inst.amount),
            paidAmount: Number(inst.paidAmount),
            remaining: Math.round(remaining * 100) / 100,
            status: inst.status,
            daysFromNow: inst._daysFromNow,
          };
        }),
      };
    });

    // ---------- Recovery cohorts ----------
    // For each invoice creation month within the cohort window, what % of the
    // invoiced amount was recovered within 30/60/90 days, and total to date.
    const cohortInvoices = await this.prisma.invoice.findMany({
      where: {
        createdAt: { gte: dateRange.start, lte: dateRange.end },
        status: { not: INVOICE_STATUS.CANCELLED },
      },
      select: {
        createdAt: true,
        totalAmount: true,
        installments: {
          select: {
            amount: true,
            paidAmount: true,
            paidAt: true,
            status: true,
          },
        },
      },
    });

    interface CohortAgg {
      invoicedAmount: number;
      recoveredAt30: number;
      recoveredAt60: number;
      recoveredAt90: number;
      recoveredFinal: number;
    }
    const cohortMap = new Map<string, CohortAgg>();

    for (const inv of cohortInvoices) {
      const key = monthKey(inv.createdAt);
      if (!cohortMap.has(key)) {
        cohortMap.set(key, {
          invoicedAmount: 0,
          recoveredAt30: 0,
          recoveredAt60: 0,
          recoveredAt90: 0,
          recoveredFinal: 0,
        });
      }
      const agg = cohortMap.get(key)!;
      agg.invoicedAmount += Number(inv.totalAmount);

      for (const inst of inv.installments) {
        if (inst.status !== INSTALLMENT_STATUS.PAID || !inst.paidAt) continue;
        const daysToRecover = diffDays(inv.createdAt, inst.paidAt);
        const paid = Number(inst.paidAmount);
        if (daysToRecover <= 30) agg.recoveredAt30 += paid;
        if (daysToRecover <= 60) agg.recoveredAt60 += paid;
        if (daysToRecover <= 90) agg.recoveredAt90 += paid;
        agg.recoveredFinal += paid;
      }
    }

    const recoveryCohorts: RecoveryCohort[] = Array.from(cohortMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, agg]) => ({
        cohortMonth: key,
        cohortLabel: monthLabel(key),
        invoicedAmount: Math.round(agg.invoicedAmount * 100) / 100,
        recoveredAt30Days:
          agg.invoicedAmount > 0
            ? Math.round((agg.recoveredAt30 / agg.invoicedAmount) * 1000) / 10
            : 0,
        recoveredAt60Days:
          agg.invoicedAmount > 0
            ? Math.round((agg.recoveredAt60 / agg.invoicedAmount) * 1000) / 10
            : 0,
        recoveredAt90Days:
          agg.invoicedAmount > 0
            ? Math.round((agg.recoveredAt90 / agg.invoicedAmount) * 1000) / 10
            : 0,
        recoveredFinal:
          agg.invoicedAmount > 0
            ? Math.round((agg.recoveredFinal / agg.invoicedAmount) * 1000) / 10
            : 0,
      }));

    const totalReceivable = Math.round((totalCurrent + totalOverdue) * 100) / 100;
    const avgDso = dsoDen > 0 ? Math.round((dsoNum / dsoDen) * 10) / 10 : 0;

    return {
      summary: {
        totalReceivable,
        totalOverdue: Math.round(totalOverdue * 100) / 100,
        totalCurrent: Math.round(totalCurrent * 100) / 100,
        avgDso,
        activeCustomers: activeCustomerIds.size,
      },
      forecastBuckets,
      recoveryCohorts,
    };
  }

  // ---------------------------------------------------------------------------
  // 5. Sicredi Webhook Analytics
  // ---------------------------------------------------------------------------

  async getSicrediWebhookAnalytics(
    filters: SicrediWebhookAnalyticsFilters,
  ): Promise<SicrediWebhookAnalyticsData> {
    const { groupBy = 'month' } = filters;
    const dateRange = this.resolveDateRange(filters);
    const keyFn = groupBy === 'week' ? weekKey : monthKey;

    const events = await this.prisma.sicrediWebhookEvent.findMany({
      where: {
        createdAt: { gte: dateRange.start, lte: dateRange.end },
      },
      select: {
        id: true,
        movimento: true,
        valorLiquidacao: true,
        valorDesconto: true,
        valorJuros: true,
        valorMulta: true,
        valorAbatimento: true,
        dataEvento: true,
        status: true,
        errorMessage: true,
        createdAt: true,
      },
    });

    // ---------- Monthly items ----------
    const periodMap = new Map<
      string,
      {
        eventCount: number;
        liquidation: number;
        discount: number;
        interest: number;
        penalty: number;
        abatement: number;
        failedCount: number;
      }
    >();

    for (const ev of events) {
      const key = keyFn(ev.dataEvento || ev.createdAt);
      if (!periodMap.has(key)) {
        periodMap.set(key, {
          eventCount: 0,
          liquidation: 0,
          discount: 0,
          interest: 0,
          penalty: 0,
          abatement: 0,
          failedCount: 0,
        });
      }
      const bucket = periodMap.get(key)!;
      bucket.eventCount++;
      bucket.liquidation += Number(ev.valorLiquidacao || 0);
      bucket.discount += Number(ev.valorDesconto || 0);
      bucket.interest += Number(ev.valorJuros || 0);
      bucket.penalty += Number(ev.valorMulta || 0);
      bucket.abatement += Number(ev.valorAbatimento || 0);
      if (ev.status === WEBHOOK_EVENT_STATUS.FAILED) bucket.failedCount++;
    }

    const sortedKeys = Array.from(periodMap.keys()).sort();
    const items: SicrediMonthlyItem[] = sortedKeys.map(key => {
      const b = periodMap.get(key)!;
      return {
        period: key,
        periodLabel: groupBy === 'week' ? key : monthLabel(key),
        eventCount: b.eventCount,
        liquidation: Math.round(b.liquidation * 100) / 100,
        discount: Math.round(b.discount * 100) / 100,
        interest: Math.round(b.interest * 100) / 100,
        penalty: Math.round(b.penalty * 100) / 100,
        abatement: Math.round(b.abatement * 100) / 100,
        failedCount: b.failedCount,
      };
    });

    // ---------- Movement breakdown ----------
    const movMap = new Map<string, { count: number; totalLiquidation: number }>();
    for (const ev of events) {
      if (!movMap.has(ev.movimento)) {
        movMap.set(ev.movimento, { count: 0, totalLiquidation: 0 });
      }
      const m = movMap.get(ev.movimento)!;
      m.count++;
      m.totalLiquidation += Number(ev.valorLiquidacao || 0);
    }
    const movementBreakdown: SicrediMovementRow[] = Array.from(movMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([movimento, v]) => ({
        movimento,
        count: v.count,
        totalLiquidation: Math.round(v.totalLiquidation * 100) / 100,
      }));

    // ---------- Error breakdown ----------
    const errMap = new Map<string, { count: number; lastOccurred: Date | null }>();
    for (const ev of events) {
      if (!ev.errorMessage) continue;
      if (!errMap.has(ev.errorMessage)) {
        errMap.set(ev.errorMessage, { count: 0, lastOccurred: null });
      }
      const e = errMap.get(ev.errorMessage)!;
      e.count++;
      const occurred = ev.dataEvento || ev.createdAt;
      if (!e.lastOccurred || occurred > e.lastOccurred) e.lastOccurred = occurred;
    }
    const errorBreakdown: SicrediErrorRow[] = Array.from(errMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20)
      .map(([msg, v]) => ({
        errorMessage: msg,
        count: v.count,
        lastOccurred: v.lastOccurred ? v.lastOccurred.toISOString() : null,
      }));

    // ---------- Summary ----------
    const totalEvents = events.length;
    const totalProcessed = events.filter(
      e => e.status === WEBHOOK_EVENT_STATUS.PROCESSED,
    ).length;
    const totalFailed = events.filter(e => e.status === WEBHOOK_EVENT_STATUS.FAILED).length;
    const totalLiquidation = events.reduce((s, e) => s + Number(e.valorLiquidacao || 0), 0);
    const totalDiscountGiven = events.reduce((s, e) => s + Number(e.valorDesconto || 0), 0);
    const totalInterestEarned = events.reduce((s, e) => s + Number(e.valorJuros || 0), 0);
    const totalPenaltyEarned = events.reduce((s, e) => s + Number(e.valorMulta || 0), 0);
    const totalAbatement = events.reduce((s, e) => s + Number(e.valorAbatimento || 0), 0);
    const processingSuccessRate =
      totalEvents > 0 ? Math.round((totalProcessed / totalEvents) * 1000) / 10 : 0;
    const netSettlementImpact =
      totalInterestEarned + totalPenaltyEarned - totalDiscountGiven - totalAbatement;

    return {
      summary: {
        totalEvents,
        totalProcessed,
        totalFailed,
        processingSuccessRate,
        totalLiquidation: Math.round(totalLiquidation * 100) / 100,
        totalDiscountGiven: Math.round(totalDiscountGiven * 100) / 100,
        totalInterestEarned: Math.round(totalInterestEarned * 100) / 100,
        totalPenaltyEarned: Math.round(totalPenaltyEarned * 100) / 100,
        totalAbatement: Math.round(totalAbatement * 100) / 100,
        netSettlementImpact: Math.round(netSettlementImpact * 100) / 100,
      },
      items,
      movementBreakdown,
      errorBreakdown,
    };
  }

  // ---------------------------------------------------------------------------
  // 6. NFSe Analytics
  // ---------------------------------------------------------------------------

  async getNfseAnalytics(filters: NfseAnalyticsFilters): Promise<NfseAnalyticsData> {
    const { status, groupBy = 'month' } = filters;
    const dateRange = this.resolveDateRange(filters);
    const keyFn = groupBy === 'week' ? weekKey : monthKey;

    const docs = await this.prisma.nfseDocument.findMany({
      where: {
        createdAt: { gte: dateRange.start, lte: dateRange.end },
        ...(status?.length && { status: { in: status as any } }),
      },
      select: {
        id: true,
        status: true,
        errorMessage: true,
        errorCount: true,
        createdAt: true,
        updatedAt: true,
        invoice: { select: { totalAmount: true } },
      },
    });

    // ---------- Status distribution ----------
    const statusCounts = new Map<string, number>();
    for (const d of docs) {
      statusCounts.set(d.status, (statusCounts.get(d.status) || 0) + 1);
    }
    const statusDistribution: NfseStatusDistribution[] = Array.from(statusCounts.entries()).map(
      ([s, c]) => ({
        status: s,
        statusLabel: NFSE_STATUS_LABELS[s as keyof typeof NFSE_STATUS_LABELS] || s,
        count: c,
      }),
    );

    // ---------- Monthly items ----------
    const periodMap = new Map<
      string,
      {
        authorized: number;
        pending: number;
        processing: number;
        error: number;
        cancelled: number;
        total: number;
      }
    >();
    for (const d of docs) {
      const key = keyFn(d.createdAt);
      if (!periodMap.has(key)) {
        periodMap.set(key, {
          authorized: 0,
          pending: 0,
          processing: 0,
          error: 0,
          cancelled: 0,
          total: 0,
        });
      }
      const b = periodMap.get(key)!;
      b.total++;
      if (d.status === NFSE_STATUS.AUTHORIZED) b.authorized++;
      else if (d.status === NFSE_STATUS.PENDING) b.pending++;
      else if (d.status === NFSE_STATUS.PROCESSING) b.processing++;
      else if (d.status === NFSE_STATUS.ERROR) b.error++;
      else if (d.status === NFSE_STATUS.CANCELLED) b.cancelled++;
    }

    const sortedKeys = Array.from(periodMap.keys()).sort();
    const items: NfseMonthlyItem[] = sortedKeys.map(key => {
      const b = periodMap.get(key)!;
      return {
        period: key,
        periodLabel: groupBy === 'week' ? key : monthLabel(key),
        authorized: b.authorized,
        pending: b.pending,
        processing: b.processing,
        error: b.error,
        cancelled: b.cancelled,
        total: b.total,
      };
    });

    // ---------- Error breakdown ----------
    const errMap = new Map<string, { count: number; lastOccurred: Date | null }>();
    for (const d of docs) {
      if (!d.errorMessage) continue;
      if (!errMap.has(d.errorMessage)) {
        errMap.set(d.errorMessage, { count: 0, lastOccurred: null });
      }
      const e = errMap.get(d.errorMessage)!;
      e.count++;
      if (!e.lastOccurred || d.updatedAt > e.lastOccurred) e.lastOccurred = d.updatedAt;
    }
    const errorBreakdown: NfseErrorRow[] = Array.from(errMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20)
      .map(([msg, v]) => ({
        errorMessage: msg,
        count: v.count,
        lastOccurred: v.lastOccurred ? v.lastOccurred.toISOString() : null,
      }));

    // ---------- Summary ----------
    const totalDocuments = docs.length;
    const totalAuthorized = docs.filter(d => d.status === NFSE_STATUS.AUTHORIZED).length;
    const totalPending = docs.filter(d => d.status === NFSE_STATUS.PENDING).length;
    const totalProcessing = docs.filter(d => d.status === NFSE_STATUS.PROCESSING).length;
    const totalError = docs.filter(d => d.status === NFSE_STATUS.ERROR).length;
    const totalCancelled = docs.filter(d => d.status === NFSE_STATUS.CANCELLED).length;
    const authorizationRate =
      totalDocuments > 0 ? Math.round((totalAuthorized / totalDocuments) * 1000) / 10 : 0;
    const errorRate =
      totalDocuments > 0 ? Math.round((totalError / totalDocuments) * 1000) / 10 : 0;
    const totalRetries = docs.reduce((s, d) => s + d.errorCount, 0);
    const avgRetryCount =
      totalDocuments > 0 ? Math.round((totalRetries / totalDocuments) * 100) / 100 : 0;
    const documentsAtRetryLimit = docs.filter(d => d.errorCount >= 3).length;

    // ---------- Tax summary (ISS estimate) ----------
    // ISS rate is configured by ELOTECH_OXY_SERVICO_LC_ALIQUOTA (default 2 = 2%).
    // For each AUTHORIZED NFS-e we sum the invoice's totalAmount (service value)
    // and derive: gross, ISS owed, net (gross - ISS).
    const issRatePercent = Number(process.env.ELOTECH_OXY_SERVICO_LC_ALIQUOTA ?? 2);
    const grossServiceRevenue = docs
      .filter(d => d.status === NFSE_STATUS.AUTHORIZED)
      .reduce((s, d) => s + Number(d.invoice?.totalAmount ?? 0), 0);
    const estimatedIssAmount = Math.round((grossServiceRevenue * issRatePercent) / 100 * 100) / 100;
    const netServiceRevenue = Math.round((grossServiceRevenue - estimatedIssAmount) * 100) / 100;
    const pendingGrossRevenue = docs
      .filter(d => d.status === NFSE_STATUS.PENDING || d.status === NFSE_STATUS.PROCESSING)
      .reduce((s, d) => s + Number(d.invoice?.totalAmount ?? 0), 0);

    return {
      summary: {
        totalDocuments,
        totalAuthorized,
        totalPending,
        totalProcessing,
        totalError,
        totalCancelled,
        authorizationRate,
        errorRate,
        avgRetryCount,
        documentsAtRetryLimit,
        issRatePercent,
        grossServiceRevenue: Math.round(grossServiceRevenue * 100) / 100,
        estimatedIssAmount,
        netServiceRevenue,
        pendingGrossRevenue: Math.round(pendingGrossRevenue * 100) / 100,
      },
      statusDistribution,
      items,
      errorBreakdown,
    };
  }
}
