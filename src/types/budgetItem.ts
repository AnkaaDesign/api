// packages/interfaces/src/budgetItem.ts

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

// =====================
// BudgetItem Interface
// =====================

export interface BudgetItem extends BaseEntity {
  description: string;
  amount: number;
  budgetId: string;

  // Relations
  budget?: Budget;
}

// =====================
// Include Types
// =====================

export interface BudgetItemIncludes {
  budget?:
    | boolean
    | {
        include?: BudgetIncludes;
      };
}

// =====================
// OrderBy Types
// =====================

export interface BudgetItemOrderBy {
  id?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  amount?: ORDER_BY_DIRECTION;
  budgetId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  budget?: BudgetOrderBy;
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

export interface BudgetItemBatchCreateResponse<T> extends BaseBatchResponse<BudgetItem, T> {}
export interface BudgetItemBatchUpdateResponse<T> extends BaseBatchResponse<
  BudgetItem,
  T & { id: string }
> {}
export interface BudgetItemBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
