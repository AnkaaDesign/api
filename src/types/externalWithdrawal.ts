// packages/interfaces/src/externalWithdrawal.ts

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
  EXTERNAL_WITHDRAWAL_TYPE,
  EXTERNAL_WITHDRAWAL_STATUS,
} from '@constants';
import type { File, FileIncludes } from './file';
import type { Item, ItemIncludes, ItemOrderBy } from './item';

// =====================
// Main Entity Interfaces
// =====================

export interface ExternalWithdrawal extends BaseEntity {
  withdrawerName: string;
  type: EXTERNAL_WITHDRAWAL_TYPE;
  status: EXTERNAL_WITHDRAWAL_STATUS;
  statusOrder: number;
  invoiceIds?: string[];
  receiptIds?: string[];
  notes: string | null;
  totalPrice?: number;

  // Relations (optional, populated based on query)
  invoices?: File[];
  invoiceReimbursements?: File[];
  receipts?: File[];
  reimbursements?: File[];
  items?: ExternalWithdrawalItem[];
}

export interface ExternalWithdrawalItem extends BaseEntity {
  externalWithdrawalId: string;
  itemId: string;
  withdrawedQuantity: number;
  returnedQuantity: number;
  price: number | null;
  unitPrice?: number;

  // Relations (optional, populated based on query)
  externalWithdrawal?: ExternalWithdrawal;
  item?: Item;
}

// =====================
// Include Types
// =====================

export interface ExternalWithdrawalIncludes {
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
        include?: ExternalWithdrawalItemIncludes;
      };
}

export interface ExternalWithdrawalItemIncludes {
  externalWithdrawal?:
    | boolean
    | {
        include?: ExternalWithdrawalIncludes;
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

export interface ExternalWithdrawalOrderBy {
  id?: ORDER_BY_DIRECTION;
  withdrawerName?: ORDER_BY_DIRECTION;
  type?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  notes?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface ExternalWithdrawalItemOrderBy {
  id?: ORDER_BY_DIRECTION;
  externalWithdrawalId?: ORDER_BY_DIRECTION;
  itemId?: ORDER_BY_DIRECTION;
  withdrawedQuantity?: ORDER_BY_DIRECTION;
  returnedQuantity?: ORDER_BY_DIRECTION;
  price?: ORDER_BY_DIRECTION;
  unitPrice?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  item?: ItemOrderBy;
  externalWithdrawal?: ExternalWithdrawalOrderBy;
}

// =====================
// Response Interfaces
// =====================

// ExternalWithdrawal Responses
export interface ExternalWithdrawalGetUniqueResponse
  extends BaseGetUniqueResponse<ExternalWithdrawal> {}
export interface ExternalWithdrawalGetManyResponse
  extends BaseGetManyResponse<ExternalWithdrawal> {}
export interface ExternalWithdrawalCreateResponse extends BaseCreateResponse<ExternalWithdrawal> {}
export interface ExternalWithdrawalUpdateResponse extends BaseUpdateResponse<ExternalWithdrawal> {}
export interface ExternalWithdrawalDeleteResponse extends BaseDeleteResponse {}

// ExternalWithdrawalItem Responses
export interface ExternalWithdrawalItemGetUniqueResponse
  extends BaseGetUniqueResponse<ExternalWithdrawalItem> {}
export interface ExternalWithdrawalItemGetManyResponse
  extends BaseGetManyResponse<ExternalWithdrawalItem> {}
export interface ExternalWithdrawalItemCreateResponse
  extends BaseCreateResponse<ExternalWithdrawalItem> {}
export interface ExternalWithdrawalItemUpdateResponse
  extends BaseUpdateResponse<ExternalWithdrawalItem> {}
export interface ExternalWithdrawalItemDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

// ExternalWithdrawal Batch Operations
export interface ExternalWithdrawalBatchCreateResponse<T>
  extends BaseBatchResponse<ExternalWithdrawal, T> {}
export interface ExternalWithdrawalBatchUpdateResponse<T>
  extends BaseBatchResponse<ExternalWithdrawal, T & { id: string }> {}
export interface ExternalWithdrawalBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// ExternalWithdrawalItem Batch Operations
export interface ExternalWithdrawalItemBatchCreateResponse<T>
  extends BaseBatchResponse<ExternalWithdrawalItem, T> {}
export interface ExternalWithdrawalItemBatchUpdateResponse<T>
  extends BaseBatchResponse<ExternalWithdrawalItem, T & { id: string }> {}
export interface ExternalWithdrawalItemBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
