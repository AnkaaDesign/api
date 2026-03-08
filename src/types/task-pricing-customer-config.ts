// packages/interfaces/src/task-pricing-customer-config.ts

import type { BaseEntity } from './common';
import type { DISCOUNT_TYPE, TaskPricing } from './task-pricing';
import type { Customer } from './customer';
import type { Installment } from './invoice';
import type { File } from './file';

// =====================
// TaskPricingCustomerConfig Interface
// =====================

export interface TaskPricingCustomerConfig extends BaseEntity {
  pricingId: string;
  customerId: string;
  subtotal: number;
  discountType: DISCOUNT_TYPE;
  discountValue: number | null;
  total: number;
  customPaymentText: string | null;
  responsibleId?: string | null;
  discountReference?: string | null;
  paymentCondition?: string | null;
  downPaymentDate?: Date | null;

  // Customer Signature (uploaded by customer on public page)
  customerSignatureId?: string | null;
  customerSignature?: File;

  // Relations
  pricing?: TaskPricing;
  customer?: Customer;
  responsible?: { id: string; name: string; role: string };
  installments?: Installment[];
}
