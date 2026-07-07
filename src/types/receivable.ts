// =====================
// Unified receivables (Contas a Receber) — the ENTRADA analog of payables.
// =====================

import type { ClearanceState } from './order';

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
  /** Task-quote (faturamento) this receivable belongs to — row navigation target. */
  taskId: string | null;
  customerId: string | null;
  customerName: string;
  /** The task (faturamento) name — the row's primary label. Falls back to the
   *  customer/parcela description for non-task receivables. */
  description: string;
  amount: number;
  paidAmount: number;
  state: ReceivableState;
  dueDate: Date | null;
  paidAt: Date | null;
  /** This installment's position (1-based). */
  number: number;
  /** How many installments the parent has, so the UI can show "2/3". */
  totalInstallments: number;
  /** Free-form payment method (BANK_SLIP / PIX / CASH / ...). Null until paid. */
  paymentMethod: string | null;
  /** A Sicredi boleto exists — receipt reconciles via the boleto bridge. */
  hasBankSlip: boolean;
  /** Already conciliated against a bank credit. */
  reconciled: boolean;
  /** Bank transaction this receipt was conciliated against (for row linking). */
  transactionId: string | null;
  /**
   * Axis B — bank-confirmation state, the receivables analog of the payables
   * `clearanceState`. Derived from the non-reversed ReconciliationMatch + amount
   * comparison (UNCLEARED until a credit confirms it; DISPUTED on amount drift).
   * `reconciled` stays as the simple boolean for back-compat; this is the
   * three-valued field web/mobile should prefer.
   */
  clearanceState: ClearanceState;
  /** When the confirming bank credit cleared this row. */
  clearedAt: Date | null;
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
