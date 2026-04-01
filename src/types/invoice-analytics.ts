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
