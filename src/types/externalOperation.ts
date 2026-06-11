// packages/interfaces/src/externalOperation.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type {
  ORDER_BY_DIRECTION,
  EXTERNAL_OPERATION_TYPE,
  EXTERNAL_OPERATION_STATUS,
} from '@constants';
import type { File, FileIncludes } from './file';
import type { Item, ItemIncludes, ItemOrderBy } from './item';
import type { Customer } from './customer';
import type { Invoice, Installment } from './invoice';

// =====================
// Main Entity Interfaces
// =====================

export interface ExternalOperation extends BaseEntity {
  withdrawerName: string | null;
  type: EXTERNAL_OPERATION_TYPE;
  status: EXTERNAL_OPERATION_STATUS;
  statusOrder: number;
  invoiceIds?: string[];
  receiptIds?: string[];
  notes: string | null;
  // Computed total: Σ(items: price × withdrawedQuantity) + Σ(services: amount)
  totalPrice?: number;

  // Billing fields (CHARGEABLE only)
  customerId?: string | null;
  generateInvoice?: boolean;
  generateBankSlip?: boolean;
  paymentCondition?: string | null;
  paymentConfig?: {
    type: 'CASH' | 'INSTALLMENTS';
    cashDays?: number;
    installmentCount?: number;
    installmentStep?: number;
    entryDays?: number;
    specificDate?: string;
  } | null;
  billedAt?: Date | null;

  // Relations (optional, populated based on query)
  invoices?: File[];
  invoiceReimbursements?: File[];
  receipts?: File[];
  reimbursements?: File[];
  items?: ExternalOperationItem[];
  customer?: Customer | null;
  services?: ExternalOperationServiceItem[];
  billingInvoice?: Invoice | null;
  installments?: Installment[];
}

export interface ExternalOperationServiceItem extends BaseEntity {
  externalOperationId: string;
  description: string;
  amount: number;
  position: number;

  // Relations (optional, populated based on query)
  externalOperation?: ExternalOperation;
}

export interface ExternalOperationItem extends BaseEntity {
  externalOperationId: string;
  itemId: string;
  withdrawedQuantity: number;
  returnedQuantity: number;
  price: number | null;
  unitPrice?: number;

  // Relations (optional, populated based on query)
  externalOperation?: ExternalOperation;
  item?: Item;
}

// =====================
// Include Types
// =====================

export interface ExternalOperationIncludes {
  invoices?:
    | boolean
    | {
        include?: FileIncludes;
      };
  receipts?:
    | boolean
    | {
        include?: FileIncludes;
      };
  items?:
    | boolean
    | {
        include?: ExternalOperationItemIncludes;
      };
  customer?: boolean | { include?: Record<string, unknown> };
  services?: boolean | { include?: Record<string, unknown> };
  billingInvoice?:
    | boolean
    | {
        include?: {
          customer?: boolean;
          installments?: boolean | { include?: { bankSlip?: boolean } };
          nfseDocuments?: boolean;
        };
      };
  installments?: boolean | { include?: { bankSlip?: boolean; invoice?: boolean } };
}

export interface ExternalOperationItemIncludes {
  externalOperation?:
    | boolean
    | {
        include?: ExternalOperationIncludes;
      };
  item?:
    | boolean
    | {
        include?: ItemIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface ExternalOperationOrderBy {
  id?: ORDER_BY_DIRECTION;
  withdrawerName?: ORDER_BY_DIRECTION;
  type?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  notes?: ORDER_BY_DIRECTION;
  customerId?: ORDER_BY_DIRECTION;
  billedAt?: ORDER_BY_DIRECTION;
  customer?: { fantasyName?: ORDER_BY_DIRECTION };
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface ExternalOperationItemOrderBy {
  id?: ORDER_BY_DIRECTION;
  externalOperationId?: ORDER_BY_DIRECTION;
  itemId?: ORDER_BY_DIRECTION;
  withdrawedQuantity?: ORDER_BY_DIRECTION;
  returnedQuantity?: ORDER_BY_DIRECTION;
  price?: ORDER_BY_DIRECTION;
  unitPrice?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  item?: ItemOrderBy;
  externalOperation?: ExternalOperationOrderBy;
}

// =====================
// Response Interfaces
// =====================

// ExternalOperation Responses
export interface ExternalOperationGetUniqueResponse extends BaseGetUniqueResponse<ExternalOperation> {}
export interface ExternalOperationGetManyResponse extends BaseGetManyResponse<ExternalOperation> {}
export interface ExternalOperationCreateResponse extends BaseCreateResponse<ExternalOperation> {}
export interface ExternalOperationUpdateResponse extends BaseUpdateResponse<ExternalOperation> {}
export interface ExternalOperationDeleteResponse extends BaseDeleteResponse {}

// ExternalOperationItem Responses
export interface ExternalOperationItemGetUniqueResponse extends BaseGetUniqueResponse<ExternalOperationItem> {}
export interface ExternalOperationItemGetManyResponse extends BaseGetManyResponse<ExternalOperationItem> {}
export interface ExternalOperationItemCreateResponse extends BaseCreateResponse<ExternalOperationItem> {}
export interface ExternalOperationItemUpdateResponse extends BaseUpdateResponse<ExternalOperationItem> {}
export interface ExternalOperationItemDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

// ExternalOperation Batch Operations
export interface ExternalOperationBatchCreateResponse<T> extends BaseBatchResponse<
  ExternalOperation,
  T
> {}
export interface ExternalOperationBatchUpdateResponse<T> extends BaseBatchResponse<
  ExternalOperation,
  T & { id: string }
> {}
export interface ExternalOperationBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}

// ExternalOperationItem Batch Operations
export interface ExternalOperationItemBatchCreateResponse<T> extends BaseBatchResponse<
  ExternalOperationItem,
  T
> {}
export interface ExternalOperationItemBatchUpdateResponse<T> extends BaseBatchResponse<
  ExternalOperationItem,
  T & { id: string }
> {}
export interface ExternalOperationItemBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
