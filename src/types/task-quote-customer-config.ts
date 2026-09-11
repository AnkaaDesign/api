// packages/interfaces/src/task-quote-customer-config.ts

import type { BaseEntity } from './common';
import type { TaskQuote } from './task-quote';
import type { Customer } from './customer';
import type { Installment } from './invoice';
import type { File } from './file';

// =====================
// TaskQuoteCustomerConfig Interface
// =====================

export interface TaskQuoteCustomerConfig extends BaseEntity {
  quoteId: string;
  customerId: string;
  /**
   * A TAREFA que esta fatia fatura, ou NULO para "todas as do orçamento".
   *
   * É a chave do "pagar junto ou separado": nulo = uma fatura para os N veículos
   * (`JOINT`); preenchido = uma fatia por veículo (`PER_TASK`), cada uma com sua
   * fatura, suas parcelas, seus boletos e sua NFS-e.
   */
  taskId?: string | null;
  /**
   * Quando ESTA fatia teve o faturamento aprovado. `TaskQuote.billingApprovedAt`
   * é a data em que a ÚLTIMA fechou.
   */
  billingApprovedAt?: Date | null;
  subtotal: number;
  total: number;
  discountType: string;
  discountValue?: number | null;
  discountReference?: string | null;
  customPaymentText: string | null;
  generateInvoice?: boolean;
  generateBankSlip?: boolean;
  /** @deprecated Mora em `Task.customerOrderNumber` — o pedido é por veículo. */
  orderNumber?: string | null;
  responsibleId?: string | null;
  paymentCondition?: string | null;
  paymentConfig?: {
    type: 'CASH' | 'INSTALLMENTS';
    cashDays?: number;
    installmentCount?: number;
    installmentStep?: number;
    entryDays?: number;
    specificDate?: string;
  } | null;

  // Customer Signature (uploaded by customer on public page)
  customerSignatureId?: string | null;
  customerSignature?: File;

  // Relations
  quote?: TaskQuote;
  customer?: Customer;
  responsible?: { id: string; name: string; roles: string[] };
  installments?: Installment[];
}
