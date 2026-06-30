import { Injectable, Logger } from '@nestjs/common';
import {
  AccountingType,
  BankTransactionType,
  OrderPaymentStatus,
  OrderStatus,
  ReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PayrollService } from '@modules/personnel-department/payroll/payroll.service';
import { ThirteenthService } from '@modules/personnel-department/thirteenth/thirteenth.service';
import { VacationService } from '@modules/personnel-department/vacation/vacation.service';
import { TransactionCategoryService } from './transaction-category.service';
import { RecurrenceLearnerService } from './recurrence-learner.service';

// Canonical payables convention (see ANDRESSA_WIRING_CONTRACT.md): an order is an OPEN
// obligation iff it is not cancelled, not paid, and still has at least one unfulfilled
// item. Keyed on item fulfillment (not the status label) so fulfilled orders the overdue
// cron flips to OVERDUE still drop out of "Pedidos em aberto".

// Recurring categories already covered by a dedicated forecast section are
// excluded from the "Recorrentes" slice so the month total never counts the
// same money twice:
//  - accountingType IMPOSTO_TARIFAS → the Impostos section;
//  - slug 'folha' (the wage-payment category — a stable classifier key, see
//    ladder.learner.ts) → the payroll aggregate. Other SALARIOS-typed
//    recurrents (Vale Transporte/Alimentação) are provider payments NOT inside
//    payroll grossSalary, so they stay in Recorrentes.
const RECURRING_EXCLUDED_TYPES: AccountingType[] = [AccountingType.IMPOSTO_TARIFAS];
const RECURRING_EXCLUDED_SLUGS = new Set(['folha']);

// How many full calendar months of history back the tax approximation reads.
const TAX_LOOKBACK_MONTHS = 3;

export interface OutflowForecastOrderRow {
  id: string;
  orderNumber: number | null;
  description: string;
  supplierName: string | null;
  paymentStatus: OrderPaymentStatus;
  forecast: Date | null;
  total: number;
}

export interface OutflowForecastScheduleRow {
  id: string;
  name: string | null;
  supplierName: string | null;
  nextRun: Date | null;
  itemCount: number;
}

export interface OutflowForecastTaxRow {
  category: { id: string; name: string; slug: string; color: string | null };
  /** Average of the per-month totals over the lookback window (the basis). */
  monthlyAverage: number;
  /** Per-lookback-month totals, oldest first — shown so the basis is auditable. */
  perMonth: { month: string; amount: number }[];
  /** Already paid inside the reference month. */
  paidThisMonth: number;
  lastAmount: number | null;
  lastPaidAt: Date | null;
}

/**
 * Composes the "Previsão de Saídas" (spec §4.3) server-side from four existing
 * domains:
 *  - Pedidos: open purchase orders by paymentStatus + order schedules due in
 *    the month (payable convention identical to Contas a Pagar);
 *  - Impostos: transparent approximation — per-category average of the last 3
 *    months of DEBIT outflows tagged with IMPOSTO_TARIFAS categories;
 *  - Folha: payroll month aggregate (gross incl. bonus). AGGREGATE ONLY — this
 *    endpoint never exposes per-user payroll rows;
 *  - Recorrentes: the static isRecurring category forecast, minus categories
 *    whose accountingType is already covered above (no double counting), plus
 *    the learned counterparty-cadence forecast as an informational comparison.
 */
@Injectable()
export class OutflowForecastService {
  private readonly logger = new Logger(OutflowForecastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: TransactionCategoryService,
    private readonly recurrence: RecurrenceLearnerService,
    private readonly payrollService: PayrollService,
    private readonly thirteenthService: ThirteenthService,
    private readonly vacationService: VacationService,
  ) {}

  async forecast(reference?: string) {
    const now = new Date();
    const [year, month] = reference
      ? reference.split('-').map(Number)
      : [now.getFullYear(), now.getMonth() + 1];
    const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const to = new Date(year, month, 0, 23, 59, 59, 999);

    const [pedidos, impostos, folha, folhaProgramada, recorrentes, learned] = await Promise.all([
      this.buildOrdersSection(from, to),
      this.buildTaxSection(from, to),
      this.buildPayrollSection(year, month),
      this.buildScheduledPayrollSection(year, month, from, to),
      this.buildRecurringSection(from, to),
      this.buildLearnedSection(from, to, now),
    ]);

    return {
      reference: `${year}-${String(month).padStart(2, '0')}`,
      from,
      to,
      // Composite month total. The TAX slice is now driven by this month's
      // faturamento (taxes estimated from the task quotes invoiced this month —
      // invoicedServices.totalEstimated), NOT the historical 3-month average (which
      // is kept below only as realized context). The learned forecast is
      // informational only (overlaps the static recurring slice by construction).
      // folhaProgramada (13º + férias) is a DISTINCT additive section — it does NOT
      // overlap the monthly folha base, which only covers the current month's wages.
      total:
        pedidos.totalOpen +
        impostos.invoicedServices.totalEstimated +
        folha.total +
        folhaProgramada.total +
        recorrentes.totalForecast,
      pedidos,
      impostos,
      folha,
      folhaProgramada,
      recorrentes,
      learned,
    };
  }

  // ----- (a) Pedidos ---------------------------------------------------------

  private async buildOrdersSection(from: Date, to: Date) {
    const [orders, schedules] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          // Open obligation = money owed: not cancelled and not yet paid. Payability is
          // decoupled from fulfillment — an order is an outflow obligation from creation
          // until it is explicitly paid, regardless of receipt status.
          status: { not: OrderStatus.CANCELLED },
          paymentStatus: { not: OrderPaymentStatus.PAID },
        },
        select: {
          id: true,
          orderNumber: true,
          description: true,
          paymentStatus: true,
          forecast: true,
          freight: true,
          discount: true,
          totalOverride: true,
          supplier: { select: { fantasyName: true } },
          items: { select: { orderedQuantity: true, price: true, icms: true, ipi: true } },
        },
        orderBy: [{ paymentStatusOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.orderSchedule.findMany({
        where: { isActive: true, finishedAt: null, nextRun: { gte: from, lte: to } },
        select: {
          id: true,
          name: true,
          nextRun: true,
          items: true,
          supplier: { select: { fantasyName: true } },
        },
        orderBy: { nextRun: 'asc' },
      }),
    ]);

    const emptyBucket = () => ({ count: 0, total: 0 });
    const byStatus: Record<
      'AWAITING_PAYMENT' | 'PARTIALLY_PAID',
      { count: number; total: number }
    > = {
      AWAITING_PAYMENT: emptyBucket(),
      PARTIALLY_PAID: emptyBucket(),
    };

    const rows: OutflowForecastOrderRow[] = orders.map(order => {
      // Same payable convention as Contas a Pagar / getPaymentSummary:
      // items price×qty (+ICMS/IPI) − discount% on goods subtotal + freight.
      // Manual grand-total override (Valor Total) wins when set, mirroring
      // OrderService.computeOrderPayableTotal (rounded to centavos, floored at 0).
      let total: number;
      if (order.totalOverride != null) {
        total = Math.max(0, Math.round(order.totalOverride * 100) / 100);
      } else {
        let itemsTotal = 0;
        let goodsSubtotal = 0;
        for (const item of order.items) {
          const subtotal = item.orderedQuantity * item.price;
          goodsSubtotal += subtotal;
          itemsTotal += subtotal * (1 + (item.icms || 0) / 100 + (item.ipi || 0) / 100);
        }
        const discountAmount = order.discount > 0 ? goodsSubtotal * (order.discount / 100) : 0;
        total = itemsTotal - discountAmount + (order.freight || 0);
      }

      const bucket = byStatus[order.paymentStatus as keyof typeof byStatus];
      if (bucket) {
        bucket.count += 1;
        bucket.total += total;
      }

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        description: order.description,
        supplierName: order.supplier?.fantasyName ?? null,
        paymentStatus: order.paymentStatus,
        forecast: order.forecast,
        total,
      };
    });

    const scheduleRows: OutflowForecastScheduleRow[] = schedules.map(s => ({
      id: s.id,
      name: s.name,
      supplierName: s.supplier?.fantasyName ?? null,
      nextRun: s.nextRun,
      itemCount: s.items.length,
    }));

    return {
      totalOpen: byStatus.AWAITING_PAYMENT.total + byStatus.PARTIALLY_PAID.total,
      byStatus,
      orders: rows,
      schedules: scheduleRows,
    };
  }

  // ----- (b) Impostos (aproximado) ------------------------------------------

  private async buildTaxSection(from: Date, to: Date) {
    const taxCategories = await this.prisma.transactionCategory.findMany({
      where: { accountingType: AccountingType.IMPOSTO_TARIFAS, isActive: true },
      select: { id: true, name: true, slug: true, color: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const ids = taxCategories.map(c => c.id);

    // Lookback window: the N full calendar months immediately before `from`.
    const lookbackStart = new Date(from);
    lookbackStart.setMonth(lookbackStart.getMonth() - TAX_LOOKBACK_MONTHS);
    const lookbackMonths: string[] = [];
    for (let i = TAX_LOOKBACK_MONTHS; i >= 1; i--) {
      const d = new Date(from);
      d.setMonth(d.getMonth() - i);
      lookbackMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const txs = ids.length
      ? await this.prisma.bankTransaction.findMany({
          where: {
            type: BankTransactionType.DEBIT,
            reconciliationStatus: { not: ReconciliationStatus.IGNORED },
            postedAt: { gte: lookbackStart, lte: to },
            categories: { some: { categoryId: { in: ids } } },
          },
          select: {
            postedAt: true,
            amount: true,
            categories: {
              where: { categoryId: { in: ids } },
              select: { categoryId: true, allocatedAmount: true },
            },
          },
        })
      : [];

    type Entry = { date: Date; amount: number };
    const byCategory = new Map<string, { history: Entry[]; current: Entry[] }>();
    for (const id of ids) byCategory.set(id, { history: [], current: [] });
    for (const tx of txs) {
      const txAmount = Math.abs(Number(tx.amount));
      for (const link of tx.categories) {
        const bucket = byCategory.get(link.categoryId);
        if (!bucket) continue;
        // Split-allocation aware: fall back to the full amount for plain tags.
        const allocated = link.allocatedAmount != null ? Number(link.allocatedAmount) : 0;
        const amount = allocated !== 0 ? Math.abs(allocated) : txAmount;
        const entry: Entry = { date: tx.postedAt, amount };
        if (tx.postedAt >= from) bucket.current.push(entry);
        else bucket.history.push(entry);
      }
    }

    const items: OutflowForecastTaxRow[] = [];
    for (const category of taxCategories) {
      const { history, current } = byCategory.get(category.id)!;
      const monthly = new Map<string, number>(lookbackMonths.map(m => [m, 0]));
      for (const e of history) {
        const key = `${e.date.getFullYear()}-${String(e.date.getMonth() + 1).padStart(2, '0')}`;
        if (monthly.has(key)) monthly.set(key, (monthly.get(key) ?? 0) + e.amount);
      }
      const perMonth = lookbackMonths.map(m => ({ month: m, amount: monthly.get(m) ?? 0 }));
      // Fixed denominator (÷3) keeps the basis honest: a tax that only fires in
      // 1 of the 3 months still averages down rather than projecting its peak.
      const monthlyAverage =
        perMonth.reduce((a, b) => a + b.amount, 0) / TAX_LOOKBACK_MONTHS;
      const paidThisMonth = current.reduce((a, e) => a + e.amount, 0);
      const all = [...history, ...current].sort((a, b) => a.date.getTime() - b.date.getTime());
      const last = all.length ? all[all.length - 1] : null;
      // Skip categories with no signal at all to keep the table readable.
      if (monthlyAverage === 0 && paidThisMonth === 0) continue;
      items.push({
        category,
        monthlyAverage,
        perMonth,
        paidThisMonth,
        lastAmount: last?.amount ?? null,
        lastPaidAt: last?.date ?? null,
      });
    }
    items.sort((a, b) => b.monthlyAverage - a.monthlyAverage);

    // Forward-looking companion: taxes on the SERVICES invoiced this month,
    // derived from the task-quote → invoice → NFS-e workflow. Informational —
    // NOT added to totalForecast (would double-count the historical ISS debits
    // already inside the 3-month average above). Surfaced on the Impostos card.
    const invoicedServices = await this.buildInvoicedServiceTaxForecast(from, to);

    return {
      // The forward forecast is now faturamento-based (invoicedServices); the
      // 3-month category breakdown below is realized context only.
      basis: 'faturamento-do-mes' as const,
      lookbackMonths,
      // Headline forecast used in the month total = taxes on this month's faturamento.
      headlineForecast: invoicedServices.totalEstimated,
      // Realized taxes/fees averaged over the lookback window — shown as context, NOT
      // the forecast driver. (Was the old `totalForecast`.)
      historicalMonthlyAverage: items.reduce((a, b) => a + b.monthlyAverage, 0),
      totalPaidThisMonth: items.reduce((a, b) => a + b.paidThisMonth, 0),
      items,
      invoicedServices,
    };
  }

  /**
   * Estimate the taxes owed on services INVOICED this month, from the task-quote
   * workflow: every Invoice created in the window that emits an NFS-e
   * (nfseDocuments present) is taxable service revenue. ISS = base × the same
   * municipal aliquota used at emission (ELOTECH_OXY_SERVICO_LC_ALIQUOTA, default
   * 2%). Optional federal retention aliquotas (IR/INSS/CSLL/PIS/COFINS) are read
   * from env and default to 0 — most service NFS-e under Simples are not retained,
   * so they only count when explicitly configured.
   */
  private async buildInvoicedServiceTaxForecast(from: Date, to: Date) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { notIn: ['DRAFT', 'CANCELLED'] as any },
        // Tax is owed on actually-issued service notes — count only invoices with
        // an AUTHORIZED NFS-e (ignore drafts/rejected/cancelled NFS-e).
        nfseDocuments: { some: { status: 'AUTHORIZED' as any } },
      },
      select: { totalAmount: true },
    });

    const invoiceCount = invoices.length;
    const invoicedBase = invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0);

    const num = (key: string, def: number) => {
      const v = Number(process.env[key]);
      return Number.isFinite(v) ? v : def;
    };
    const issRatePercent = num('ELOTECH_OXY_SERVICO_LC_ALIQUOTA', 2);
    const federalRates = {
      ir: num('ELOTECH_OXY_ALIQUOTA_IR', 0),
      inss: num('ELOTECH_OXY_ALIQUOTA_INSS', 0),
      csll: num('ELOTECH_OXY_ALIQUOTA_CSLL', 0),
      pis: num('ELOTECH_OXY_ALIQUOTA_PIS', 0),
      cofins: num('ELOTECH_OXY_ALIQUOTA_COFINS', 0),
    };

    const iss = invoicedBase * (issRatePercent / 100);
    const federalRetentions = {
      ir: invoicedBase * (federalRates.ir / 100),
      inss: invoicedBase * (federalRates.inss / 100),
      csll: invoicedBase * (federalRates.csll / 100),
      pis: invoicedBase * (federalRates.pis / 100),
      cofins: invoicedBase * (federalRates.cofins / 100),
    };
    const federalTotal = Object.values(federalRetentions).reduce((a, b) => a + b, 0);

    return {
      basis: 'faturamento-do-mes' as const,
      invoiceCount,
      invoicedBase,
      issRatePercent,
      iss,
      federalRates,
      federalRetentions,
      federalTotal,
      // Total estimated taxes on this month's service faturamento.
      totalEstimated: iss + federalTotal,
    };
  }

  // ----- (c) Folha (com bonificação) ----------------------------------------

  /**
   * Month payroll AGGREGATE. grossSalary already includes the bonus (see
   * CompletePayrollCalculatorService STEP 2), so `total` is "folha com
   * bonificação"; `bonusTotal` is broken out for display only. Per-user rows
   * never leave this method — payroll data is sensitive.
   */
  private async buildPayrollSection(year: number, month: number) {
    try {
      const response = await this.payrollService.getPayrollsWithLiveCalculation({
        where: { year, month },
        page: 1,
        limit: 1000,
      });
      const payrolls = (response.data ?? []) as any[];
      let total = 0;
      let bonusTotal = 0;
      let netTotal = 0;
      for (const p of payrolls) {
        const gross = Number(p.grossSalary ?? p.baseRemuneration ?? 0) || 0;
        total += gross;
        netTotal += Number(p.netSalary ?? 0) || Number(p.grossSalary ?? 0) || 0;
        bonusTotal += Number(p.bonus?.netBonus ?? 0) || 0;
      }
      return {
        available: true,
        total,
        bonusTotal,
        netTotal,
        employeeCount: payrolls.length,
      };
    } catch (error) {
      // Live payroll composition can fail on integration hiccups (e.g.
      // Secullum); the forecast page should degrade, not 500.
      this.logger.warn(
        `Falha ao agregar a folha para previsão de saídas: ${(error as Error)?.message ?? error}`,
      );
      return { available: false, total: 0, bonusTotal: 0, netTotal: 0, employeeCount: 0 };
    }
  }

  // ----- (c2) Folha programada (13º + férias) -------------------------------

  /**
   * Folha PROGRAMADA AGGREGATE for the reference month: the 13º installment(s)
   * and the férias recibos that fall due in this month. This is ADDITIVE and
   * DISTINCT from the monthly folha section (which only covers the current
   * month's base wages incl. bonus) — there is no overlap, so summing both into
   * the month total never double-counts.
   *
   * Per-employee rows never leave this method; both HR services are consumed
   * READ-ONLY via their getForecastProjection() projections (no writes, no
   * change to their public contract).
   *
   * 13º mapping: 1ª parcela → Novembro (≤30/Nov), 2ª parcela → Dezembro
   * (≤20/Dez). Already-paid installments are excluded by status inside the
   * projection (no double count). Only the slice due in `month` is added to the
   * month total; the full-year split is exposed for auditing.
   *
   * Férias mapping: recibo bruto (base + 1/3 + abono) of every non-PAID vacation
   * whose paymentDueDate falls inside [from, to].
   */
  private async buildScheduledPayrollSection(
    year: number,
    month: number,
    from: Date,
    to: Date,
  ) {
    let thirteenth = {
      year,
      november: 0,
      december: 0,
      firstInstallmentTotal: 0,
      secondInstallmentTotal: 0,
      recordCount: 0,
    };
    let thirteenthAvailable = true;
    try {
      thirteenth = await this.thirteenthService.getForecastProjection(year);
    } catch (error) {
      thirteenthAvailable = false;
      this.logger.warn(
        `Falha ao projetar o 13º para previsão de saídas: ${(error as Error)?.message ?? error}`,
      );
    }

    let vacation = { total: 0, recordCount: 0 };
    let vacationAvailable = true;
    try {
      vacation = await this.vacationService.getForecastProjection(from, to);
    } catch (error) {
      vacationAvailable = false;
      this.logger.warn(
        `Falha ao projetar férias para previsão de saídas: ${(error as Error)?.message ?? error}`,
      );
    }

    // Only the 13º installment due in THIS reference month contributes to the
    // month total: 1ª parcela in November (month 11), 2ª in December (month 12).
    let thirteenthThisMonth = 0;
    if (month === 11) thirteenthThisMonth = thirteenth.november;
    else if (month === 12) thirteenthThisMonth = thirteenth.december;

    const total = thirteenthThisMonth + vacation.total;

    return {
      total,
      // Auditable per-source breakdown (mirrors the other sections' discipline).
      thirteenth: {
        available: thirteenthAvailable,
        year,
        // The full-year split (always exposed so Nov/Dez are auditable), plus
        // the slice that actually lands in the reference month total.
        firstInstallmentNovember: thirteenth.november,
        secondInstallmentDecember: thirteenth.december,
        dueThisMonth: thirteenthThisMonth,
        recordCount: thirteenth.recordCount,
      },
      vacation: {
        available: vacationAvailable,
        dueThisMonth: vacation.total,
        recordCount: vacation.recordCount,
      },
    };
  }

  // ----- (d) Recorrentes ------------------------------------------------------

  private async buildRecurringSection(from: Date, to: Date) {
    const full = await this.categories.forecast(from, to);
    const items = full.items.filter(
      item =>
        !RECURRING_EXCLUDED_SLUGS.has(item.category.slug) &&
        (!item.category.accountingType ||
          !RECURRING_EXCLUDED_TYPES.includes(item.category.accountingType)),
    );
    return {
      totalPaid: items.reduce((a, b) => a + b.paidAmount, 0),
      totalForecast: items.reduce((a, b) => a + b.forecastAmount, 0),
      // How many recurring categories were folded into Impostos/Folha instead.
      excludedCount: full.items.length - items.length,
      items,
    };
  }

  /** Learned counterparty-cadence forecast — informational comparison only. */
  private async buildLearnedSection(from: Date, to: Date, now: Date) {
    try {
      const reference = now >= from && now <= to ? now : from;
      const learned = await this.recurrence.forecast(reference);
      return {
        expectedMonthlyTotal: learned.expectedMonthlyTotal,
        itemCount: learned.items.length,
        overdueCount: learned.items.filter((i: any) => i.overdue).length,
      };
    } catch (error) {
      this.logger.warn(
        `Falha ao computar a previsão aprendida: ${(error as Error)?.message ?? error}`,
      );
      return { expectedMonthlyTotal: 0, itemCount: 0, overdueCount: 0 };
    }
  }
}
