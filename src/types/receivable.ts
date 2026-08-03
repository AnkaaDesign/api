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

// =====================
// Task-anchored manual conciliation (credit ↔ Task, quote optional)
// =====================

/**
 * Billing shape of a Task, as far as an incoming credit is concerned.
 *
 * The migration left many tasks with `quoteId = NULL`, so the receivable spine
 * (quote → customerConfig → invoice → installment) that the whole matcher is
 * built on simply does not exist for them. This enum is what the operator sees
 * and what decides how much work `matchTasks` has to do before it can allocate.
 */
export type TaskBillingState =
  /** No quote at all — the migration casualty. One will be minted on match. */
  | 'NO_QUOTE'
  /** Quote exists but was never billed: no installments to allocate against. */
  | 'QUOTE_UNBILLED'
  /** Quote is billed and still has open balance. Allocate straight onto it. */
  | 'QUOTE_OPEN'
  /** Quote is billed and fully settled. Extra money needs new capacity. */
  | 'QUOTE_SETTLED';

/** A Task offered as a conciliation target for a bank credit. */
export interface TaskMatchCandidate {
  taskId: string;
  taskName: string | null;
  taskSerialNumber: string | null;
  taskStatus: string;
  plate: string | null;
  /** The task's own customer — the default billing target when minting. */
  customerId: string | null;
  customerName: string | null;
  customerCnpjCpf: string | null;
  quoteId: string | null;
  budgetNumber: number | null;
  quoteStatus: string | null;
  quoteTotal: number | null;
  billingState: TaskBillingState;
  /** Outstanding balance already billed and allocatable without new capacity. */
  openCapacity: number;
  /** Already-open installments, so the UI can show what the money will land on. */
  openInstallments: {
    installmentId: string;
    number: number;
    dueDate: Date;
    amount: number;
    paidAmount: number;
    remaining: number;
    status: string;
    hasBankSlip: boolean;
  }[];
  /** Sum already conciliated against this task from ANY credit. */
  reconciledAmount: number;
  /** How much of THIS credit is still unallocated when the list was built. */
  suggestedAmount: number;
  /** 0-100, same scorer as the installment candidates. */
  confidence: number;
  /** Human-readable "why this showed up". */
  reason: string;
  /** Reference date used for scoring/dating (finishedAt ?? entryDate ?? createdAt). */
  referenceDate: Date | null;
}

/** One task's share of a credit. */
export interface TaskMatchAllocationInput {
  taskId: string;
  amount: number;
  /** Billing customer. Required when the task has neither a quote nor a customer. */
  customerId?: string;
  /** Due date for any parcela that has to be created. Defaults to the credit's date. */
  dueDate?: Date;
  /** Service line description for a minted/extended quote. */
  description?: string;
}

/** What `matchTasks` did, per task — surfaced so the UI can be honest about it. */
export interface TaskMatchOutcome {
  taskId: string;
  quoteId: string;
  budgetNumber: number;
  /** True when this call created the quote. */
  quoteCreated: boolean;
  /** True when this call added a service + parcela to an existing quote. */
  quoteExtended: boolean;
  /** True when this call materialized invoice + parcelas from an unbilled quote. */
  invoiceCreated: boolean;
  allocated: number;
  installmentIds: string[];
}

export interface TaskMatchResponse {
  success: boolean;
  message: string;
  data: {
    transactionId: string;
    totalAllocated: number;
    /** RECONCILED when the credit is fully allocated, else PARTIAL. */
    reconciliationStatus: string;
    outcomes: TaskMatchOutcome[];
  };
}
