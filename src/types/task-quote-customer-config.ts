// packages/interfaces/src/task-quote-customer-config.ts

import type { BaseEntity } from './common';
import type { TaskQuote } from './task-quote';
import type { Task } from './task';
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
   * A COBERTURA — de quais VEÍCULOS esta fatura é.
   *
   * Era a coluna `taskId`, com nulo querendo dizer "todos". Virou registro
   * (`QuoteBillingTask`) porque a cobertura implícita não sabia responder a
   * "quais dos sessenta?" quando a resposta era vinte, e porque uma fatura já
   * emitida passava a cobrir um caminhão acrescentado depois sem deixar rastro.
   *
   * ⚠️ Relação: um `select` que não a inclui devolve VAZIO, e vazio numa conta
   * de dinheiro é R$ 0,00 numa fatura que tem valor. Leia por `coveredTaskIds()`
   * / `coveredTaskCount()` de `@utils/quote-tasks`.
   */
  coveredTasks?: Array<{ configId: string; taskId: string; customerId: string; task?: Task }>;
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
