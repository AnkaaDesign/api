export interface InvoiceAnalyticsFilters {
  startDate?: Date;
  endDate?: Date;
  customerIds?: string[];
  status?: string[];
  groupBy?: 'month' | 'week';
  sortBy?: 'collectionRate' | 'amount' | 'overdueAmount';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

// Collection Analytics response
export interface CollectionAnalyticsData {
  summary: {
    collectionRate: number; // paidAmount / totalAmount %
    avgDaysToPayment: number; // avg days between dueDate and paidAt
    totalOverdue: number; // sum of unpaid past-due installments (R$)
    overdueRate: number; // % of overdue installments
  };
  items: CollectionItem[];
  agingAnalysis: AgingBand[];
  revenueFunnel: RevenueFunnel;
}

export interface CollectionItem {
  period: string; // "2025-01" format
  periodLabel: string; // "Janeiro 2025"
  invoicedAmount: number;
  paidAmount: number;
  collectionRate: number;
  overdueAmount: number;
}

export interface AgingBand {
  band: string; // "0-30", "31-60", "61-90", "90+"
  bandLabel: string;
  count: number;
  amount: number;
}

export interface RevenueFunnel {
  invoiced: number;
  billed: number; // bank slips created
  collected: number;
  outstanding: number;
}

// Bank Slip Performance response
export interface BankSlipPerformanceData {
  summary: {
    conversionRate: number; // paid / total %
    avgDelayDays: number;
    errorRate: number;
    activeSlips: number;
  };
  items: BankSlipPerformanceItem[];
  statusDistribution: StatusDistributionItem[];
  typeDistribution: TypeDistributionItem[];
}

export interface BankSlipPerformanceItem {
  period: string;
  periodLabel: string;
  totalSlips: number;
  paidSlips: number;
  conversionRate: number;
  avgDelay: number;
}

export interface StatusDistributionItem {
  status: string;
  statusLabel: string;
  count: number;
  amount: number;
}

export interface TypeDistributionItem {
  type: string; // NORMAL or HIBRIDO
  typeLabel: string;
  count: number;
  amount: number;
  paidCount: number;
  conversionRate: number;
}

// =====================================================================
// Quote Funnel Analytics
// =====================================================================

export interface QuoteFunnelAnalyticsFilters {
  startDate?: Date;
  endDate?: Date;
  customerIds?: string[];
  sectorIds?: string[];
  status?: string[];
  groupBy?: 'month' | 'week';
}

export interface QuoteFunnelStage {
  stage: string; // raw enum value e.g. PENDING
  stageLabel: string; // pt-BR label
  count: number;
  totalValue: number;
  conversionFromPrevious: number; // % of previous stage's count
  conversionFromTop: number; // % of total funnel entries
  avgDaysFromCreation: number; // avg age of quotes at this stage (vs createdAt)
}

export interface QuoteFunnelItem {
  period: string;
  periodLabel: string;
  newQuotes: number;
  approvedQuotes: number; // BUDGET_APPROVED count
  billedQuotes: number; // BILLING_APPROVED count (materialized)
  settledQuotes: number; // SETTLED count
  totalValue: number; // sum of TaskQuote.total for new in this period
  settledValue: number; // sum of TaskQuote.total for settled in this period
}

export interface QuoteTopCustomer {
  customerId: string;
  customerName: string;
  quoteCount: number;
  totalValue: number;
  settledValue: number;
  conversionRate: number;
}

export interface QuoteTopSector {
  sectorId: string;
  sectorName: string;
  quoteCount: number;
  totalValue: number;
  settledValue: number;
}

export interface QuoteFunnelAnalyticsData {
  summary: {
    totalQuotes: number;
    totalQuotedValue: number;
    totalSettledValue: number;
    conversionRate: number; // % settled / total
    avgTicket: number; // total settled value / settled count
    avgSalesCycleDays: number; // avg (billingApprovedAt - createdAt) for billing-approved quotes
    activeBacklogValue: number; // sum total for non-cancelled, non-settled quotes
  };
  funnel: QuoteFunnelStage[];
  items: QuoteFunnelItem[];
  topCustomers: QuoteTopCustomer[];
  topSectors: QuoteTopSector[];
}

// =====================================================================
// Receivables Analytics (per-customer aging, DSO, forecast)
// =====================================================================

export interface ReceivablesAnalyticsFilters {
  startDate?: Date; // limits cohort scope, not aging snapshot (aging always uses "now")
  endDate?: Date;
  customerIds?: string[];
  limit?: number; // top-N for delinquents/customer aging
  // Forecast bucketing aligns to the workflow's period unit. The summary
  // chart uses business months (26→25) or calendar years; the forecast cards
  // show N consecutive forward periods of that unit, starting from the period
  // that contains "now". Anything past the horizon is dropped from the
  // bucket list (same trade-off the old day-bucket implementation made).
  forecastPeriodType?: 'month' | 'year';
  forecastPeriodCount?: number; // default 4, max 12
}

export interface ForecastBucketInstallment {
  installmentId: string;
  invoiceId: string | null;
  customerId: string;
  customerName: string;
  taskId: string | null;
  taskName: string | null;
  taskSerialNumber: string | null;
  invoiceTotalAmount: number;
  installmentNumber: number;
  totalInstallments: number;
  dueDate: string; // ISO
  paidAt: string | null; // ISO; set when the installment has been paid (drives PAID bucket display)
  amount: number;
  paidAmount: number;
  remaining: number;
  status: string;
  daysFromNow: number; // negative for past events (overdue, or paid in the past)
}

export interface ForecastPeriodBucket {
  bucket: string; // 'OVERDUE' | 'CURRENT' | 'P1' | 'P2' | ... | 'P{forecastPeriodCount}' | 'BEYOND' | 'PAID'
  bucketLabel: string; // e.g. 'Vencidas', 'Junho 2026', '2027'
  periodStart: string | null; // ISO; null for OVERDUE
  periodEnd: string | null; // ISO; null for OVERDUE
  dueAmount: number;
  installmentCount: number;
  installments: ForecastBucketInstallment[]; // capped at 100 per bucket
  truncated: boolean; // true when more than 100 installments exist
}

export interface RecoveryCohort {
  cohortMonth: string; // "2025-01"
  cohortLabel: string;
  invoicedAmount: number;
  recoveredAt30Days: number; // % of invoiced
  recoveredAt60Days: number;
  recoveredAt90Days: number;
  recoveredFinal: number; // % recovered through now
}

export interface ReceivablesAnalyticsData {
  summary: {
    totalReceivable: number; // sum of unpaid (pending + overdue) installment amounts
    totalOverdue: number;
    totalCurrent: number; // unpaid but not yet due
    avgDso: number; // weighted across customers
    activeCustomers: number; // distinct customers with open installments
  };
  forecastBuckets: ForecastPeriodBucket[];
  recoveryCohorts: RecoveryCohort[];
}

// =====================================================================
// Sicredi Webhook Analytics
// =====================================================================

export interface SicrediWebhookAnalyticsFilters {
  startDate?: Date;
  endDate?: Date;
  groupBy?: 'month' | 'week';
}

export interface SicrediMonthlyItem {
  period: string;
  periodLabel: string;
  eventCount: number;
  liquidation: number;
  discount: number;
  interest: number;
  penalty: number;
  abatement: number;
  failedCount: number;
}

export interface SicrediMovementRow {
  movimento: string;
  count: number;
  totalLiquidation: number;
}

export interface SicrediErrorRow {
  errorMessage: string;
  count: number;
  lastOccurred: string | null;
}

export interface SicrediWebhookAnalyticsData {
  summary: {
    totalEvents: number;
    totalProcessed: number;
    totalFailed: number;
    processingSuccessRate: number;
    totalLiquidation: number;
    totalDiscountGiven: number;
    totalInterestEarned: number;
    totalPenaltyEarned: number;
    totalAbatement: number;
    netSettlementImpact: number; // interest + penalty - discount - abatement
  };
  items: SicrediMonthlyItem[];
  movementBreakdown: SicrediMovementRow[];
  errorBreakdown: SicrediErrorRow[];
}

// =====================================================================
// NFSe Analytics
// =====================================================================

export interface NfseAnalyticsFilters {
  startDate?: Date;
  endDate?: Date;
  status?: string[];
  groupBy?: 'month' | 'week';
}

export interface NfseStatusDistribution {
  status: string;
  statusLabel: string;
  count: number;
}

export interface NfseMonthlyItem {
  period: string;
  periodLabel: string;
  authorized: number;
  pending: number;
  processing: number;
  error: number;
  cancelled: number;
  total: number;
}

export interface NfseErrorRow {
  errorMessage: string;
  count: number;
  lastOccurred: string | null;
}

export interface NfseAnalyticsData {
  summary: {
    totalDocuments: number;
    totalAuthorized: number;
    totalPending: number;
    totalProcessing: number;
    totalError: number;
    totalCancelled: number;
    authorizationRate: number;
    errorRate: number;
    avgRetryCount: number;
    documentsAtRetryLimit: number; // errorCount >= 3
    // Tax estimate over invoices linked to AUTHORIZED NFS-e
    issRatePercent: number;          // e.g. 2 for 2%
    grossServiceRevenue: number;     // Σ invoice.totalAmount for authorized NFS-e
    estimatedIssAmount: number;      // gross × issRatePercent / 100
    netServiceRevenue: number;       // gross − ISS
    pendingGrossRevenue: number;     // Σ invoice.totalAmount for pending/processing NFS-e
  };
  statusDistribution: NfseStatusDistribution[];
  items: NfseMonthlyItem[];
  errorBreakdown: NfseErrorRow[];
}
