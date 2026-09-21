// packages/interfaces/src/budget-payer.ts

import type { BaseEntity } from './common';
import type { Budget } from './budget';
import type { Task } from './task';
import type { Customer } from './customer';
import type { Installment } from './invoice';
import type { File } from './file';

// =====================
// BudgetPayer Interface
// =====================

export interface BudgetPayer extends BaseEntity {
  quoteId: string;
  customerId: string;
  /**
   * A COBERTURA — de quais VEÍCULOS esta fatura é.
   *
   * O FATURAMENTO a que este pagador pertence — e de onde vêm a COBERTURA e o
   * ESTADO.
   *
   * Nenhum dos dois mora mais aqui. A cobertura era a coluna `taskId` (nulo =
   * "todos"), depois `QuoteBillingTask` pendurada no pagador; o estado era
   * `billingApprovedAt`, uma data por pagador. Com dois pagadores do mesmo
   * recorte, as duas coisas existiam em duplicata — duas listas de veículos e
   * duas datas para um evento só.
   *
   * ⚠️ Relação: um `select` que não a inclui devolve VAZIO, e vazio numa conta
   * de dinheiro é R$ 0,00 numa fatura que tem valor. Leia por `coveredTaskIds()`
   * / `coveredTaskCount()` / `billingApprovedAtOf()` de `@utils/quote-tasks`, e
   * peça o include por `withCoverageInclude`.
   */
  billing?: {
    id: string;
    quoteId?: string;
    /** Quando ESTE faturamento foi aprovado. `Budget.billingApprovedAt` é a
     *  data em que o ÚLTIMO fechou — "o orçamento inteiro está faturado". */
    approvedAt?: Date | null;
    createdAt?: Date;
    tasks?: Array<{ taskId: string; task?: Task }>;
  } | null;
  billingId?: string;
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
  quote?: Budget;
  customer?: Customer;
  installments?: Installment[];
}
