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
  subtotal: number;
  total: number;
  customPaymentText: string | null;
  generateInvoice?: boolean;
  responsibleId?: string | null;
  paymentCondition?: string | null;
  downPaymentDate?: Date | null;

  // Customer Signature (uploaded by customer on public page)
  customerSignatureId?: string | null;
  customerSignature?: File;

  // Relations
  quote?: TaskQuote;
  customer?: Customer;
  responsible?: { id: string; name: string; role: string };
  installments?: Installment[];
}
