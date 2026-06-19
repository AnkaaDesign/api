// =====================
// Unified receivables (Contas a Receber) — the ENTRADA analog of payables.
// =====================

export type ReceivableSource = 'TASK_QUOTE' | 'EXTERNAL_OPERATION' | 'INVOICE';

export type ReceivableState =
  | 'AWAITING_RECEIPT'
  | 'PARTIALLY_RECEIVED'
  | 'OVERDUE'
  // Received in the period — surfaced so finance can review what came in.
  | 'RECEIVED';

/** One normalized receivable row: an open (or recently received) installment. */
export interface ReceivableRow {
  source: ReceivableSource;
  /** Installment id (the settle/conciliation target). */
  id: string;
  invoiceId: string | null;
  customerId: string | null;
  customerName: string;
  description: string;
  amount: number;
  paidAmount: number;
  state: ReceivableState;
  dueDate: Date | null;
  paidAt: Date | null;
  number: number;
  /** A Sicredi boleto exists — receipt reconciles via the boleto bridge. */
  hasBankSlip: boolean;
  /** Already conciliated against a bank credit. */
  reconciled: boolean;
  /** Bank transaction this receipt was conciliated against (for row linking). */
  transactionId: string | null;
}

export interface ReceivablesSummaryBucket {
  count: number;
  total: number;
}

export interface ReceivablesSummary {
  AWAITING_RECEIPT: ReceivablesSummaryBucket;
  PARTIALLY_RECEIVED: ReceivablesSummaryBucket;
  OVERDUE: ReceivablesSummaryBucket;
  RECEIVED: ReceivablesSummaryBucket;
}

export interface ReceivablesResponse {
  success: boolean;
  message: string;
  data: {
    rows: ReceivableRow[];
    summary: ReceivablesSummary;
  };
}
