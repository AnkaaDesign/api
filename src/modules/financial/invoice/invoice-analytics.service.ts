import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  INVOICE_STATUS,
  INSTALLMENT_STATUS,
  BANK_SLIP_STATUS,
  BANK_SLIP_TYPE,
} from '../../../constants/enums';
import type {
  CollectionAnalyticsData,
  CollectionItem,
  AgingBand,
  RevenueFunnel,
  BankSlipPerformanceData,
  BankSlipPerformanceItem,
  StatusDistributionItem,
  TypeDistributionItem,
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
}

@Injectable()
export class InvoiceAnalyticsService {
  private readonly logger = new Logger(InvoiceAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // 1. Collection Analytics
  // ---------------------------------------------------------------------------

  async getCollectionAnalytics(filters: AnalyticsFilters): Promise<CollectionAnalyticsData> {
    const { customerIds, status, groupBy = 'month' } = filters;
    const dateRange = this.resolveDateRange(filters);
    const now = new Date();

    const keyFn = groupBy === 'week' ? weekKey : monthKey;

    // Build where clause for invoices
    const invoiceWhere: any = {
      createdAt: {
        gte: dateRange.start,
        lte: dateRange.end,
      },
      status: { not: INVOICE_STATUS.CANCELLED },
      ...(customerIds?.length && { customerId: { in: customerIds } }),
      ...(status?.length && { status: { in: status } }),
    };

    // Fetch invoices with installments
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

    // ---------- Items: grouped by period ----------
    const byPeriod = new Map<
      string,
      { invoicedAmount: number; paidAmount: number; overdueAmount: number }
    >();

    for (const invoice of invoices) {
      const key = keyFn(invoice.createdAt);
      if (!byPeriod.has(key)) {
        byPeriod.set(key, { invoicedAmount: 0, paidAmount: 0, overdueAmount: 0 });
      }
      const bucket = byPeriod.get(key)!;
      bucket.invoicedAmount += Number(invoice.totalAmount);
      bucket.paidAmount += Number(invoice.paidAmount);

      for (const inst of invoice.installments) {
        if (
          inst.status === INSTALLMENT_STATUS.OVERDUE ||
          (inst.dueDate < now && inst.status !== INSTALLMENT_STATUS.PAID && inst.status !== INSTALLMENT_STATUS.CANCELLED)
        ) {
          bucket.overdueAmount += Number(inst.amount) - Number(inst.paidAmount);
        }
      }
    }

    const sortedKeys = Array.from(byPeriod.keys()).sort();

    const items: CollectionItem[] = sortedKeys.map((key) => {
      const data = byPeriod.get(key)!;
      const collectionRate =
        data.invoicedAmount > 0
          ? Math.round((data.paidAmount / data.invoicedAmount) * 1000) / 10
          : 0;

      return {
        period: key,
        periodLabel: groupBy === 'week' ? key : monthLabel(key),
        invoicedAmount: Math.round(data.invoicedAmount * 100) / 100,
        paidAmount: Math.round(data.paidAmount * 100) / 100,
        collectionRate,
        overdueAmount: Math.round(data.overdueAmount * 100) / 100,
      };
    });

    // ---------- Summary ----------
    const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + Number(inv.paidAmount), 0);
    const collectionRate =
      totalInvoiced > 0 ? Math.round((totalPaid / totalInvoiced) * 1000) / 10 : 0;

    // Avg days to payment: from dueDate to paidAt for paid installments
    const allInstallments = invoices.flatMap((inv) => inv.installments);
    const paidInstallments = allInstallments.filter(
      (inst) => inst.status === INSTALLMENT_STATUS.PAID && inst.paidAt,
    );
    const daysToPayment = paidInstallments.map((inst) =>
      diffDays(inst.dueDate, inst.paidAt!),
    );
    const avgDaysToPayment =
      daysToPayment.length > 0
        ? Math.round((daysToPayment.reduce((a, b) => a + b, 0) / daysToPayment.length) * 10) / 10
        : 0;

    // Total overdue
    const overdueInstallments = allInstallments.filter(
      (inst) =>
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
      (inst) => inst.status !== INSTALLMENT_STATUS.CANCELLED,
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
      Math.round(
        invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0) * 100,
      ) / 100;

    const billedTotal =
      Math.round(
        allInstallments
          .filter((inst) => inst.bankSlip != null)
          .reduce((sum, inst) => sum + Number(inst.amount), 0) * 100,
      ) / 100;

    const collectedTotal =
      Math.round(
        paidInstallments.reduce((sum, inst) => sum + Number(inst.paidAmount), 0) * 100,
      ) / 100;

    const outstandingTotal =
      Math.round((invoicedTotal - collectedTotal) * 100) / 100;

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
    const byPeriod = new Map<
      string,
      { totalSlips: number; paidSlips: number; delays: number[] }
    >();

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

    const items: BankSlipPerformanceItem[] = sortedKeys.map((key) => {
      const data = byPeriod.get(key)!;
      const conversionRate =
        data.totalSlips > 0
          ? Math.round((data.paidSlips / data.totalSlips) * 1000) / 10
          : 0;
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
    const paidSlips = bankSlips.filter((s) => s.status === BANK_SLIP_STATUS.PAID).length;
    const conversionRate =
      totalSlips > 0 ? Math.round((paidSlips / totalSlips) * 1000) / 10 : 0;

    const allDelays = bankSlips
      .filter((s) => s.status === BANK_SLIP_STATUS.PAID && s.paidAt)
      .map((s) => diffDays(s.dueDate, s.paidAt!))
      .filter((d) => d > 0);

    const avgDelayDays =
      allDelays.length > 0
        ? Math.round((allDelays.reduce((a, b) => a + b, 0) / allDelays.length) * 10) / 10
        : 0;

    const errorSlips = bankSlips.filter(
      (s) => s.status === BANK_SLIP_STATUS.ERROR || s.status === BANK_SLIP_STATUS.REJECTED,
    ).length;
    const errorRate =
      totalSlips > 0 ? Math.round((errorSlips / totalSlips) * 1000) / 10 : 0;

    const activeSlips = bankSlips.filter(
      (s) => s.status === BANK_SLIP_STATUS.ACTIVE || s.status === BANK_SLIP_STATUS.OVERDUE,
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
    const typeCounts = new Map<
      string,
      { count: number; amount: number; paidCount: number }
    >();

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
        conversionRate:
          data.count > 0 ? Math.round((data.paidCount / data.count) * 1000) / 10 : 0,
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
    if (filters.startDate && filters.endDate) {
      return { start: new Date(filters.startDate), end: new Date(filters.endDate) };
    }

    // Default: last 12 months
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 12);
    return { start, end };
  }
}
