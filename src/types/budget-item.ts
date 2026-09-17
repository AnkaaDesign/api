// packages/interfaces/src/budget-item.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { ORDER_BY_DIRECTION } from '@constants';
import type { Budget, BudgetIncludes, BudgetOrderBy } from './budget';
import type { Customer } from './customer';

// =====================
// BudgetItem Interface
// =====================

export interface BudgetItem extends BaseEntity {
  description: string;
  observation?: string | null;
  amount: number;
  quoteId: string;
  invoiceToCustomerId: string | null;

  // Relations
  quote?: Budget;
  invoiceToCustomer?: Customer;
}

// =====================
// Include Types
// =====================

export interface BudgetItemIncludes {
  quote?:
    | boolean
    | {
        include?: BudgetIncludes;
      };
  invoiceToCustomer?:
    | boolean
    | { select?: { id?: boolean; fantasyName?: boolean; cnpj?: boolean } };
}

// =====================
// OrderBy Types
// =====================

export interface BudgetItemOrderBy {
  id?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  amount?: ORDER_BY_DIRECTION;
  quoteId?: ORDER_BY_DIRECTION;
  invoiceToCustomerId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  quote?: BudgetOrderBy;
}

// =====================
// Response Interfaces - BudgetItem
// =====================

export interface BudgetItemGetUniqueResponse extends BaseGetUniqueResponse<BudgetItem> {}
export interface BudgetItemGetManyResponse extends BaseGetManyResponse<BudgetItem> {}
export interface BudgetItemCreateResponse extends BaseCreateResponse<BudgetItem> {}
export interface BudgetItemUpdateResponse extends BaseUpdateResponse<BudgetItem> {}
export interface BudgetItemDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses - BudgetItem
// =====================

export interface BudgetItemBatchCreateResponse<T> extends BaseBatchResponse<
  BudgetItem,
  T
> {}
export interface BudgetItemBatchUpdateResponse<T> extends BaseBatchResponse<
  BudgetItem,
  T & { id: string }
> {}
export interface BudgetItemBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
