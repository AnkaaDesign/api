// packages/interfaces/src/budget.ts

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
import type { Task, TaskIncludes, TaskOrderBy } from './task';
import type { BudgetItem } from './budgetItem';

// =====================
// Budget Interface
// =====================

export interface Budget extends BaseEntity {
  total: number;
  expiresIn: Date;
  taskId: string;

  // Relations
  task?: Task;
  items?: BudgetItem[];
}

// =====================
// Include Types
// =====================

export interface BudgetIncludes {
  task?:
    | boolean
    | {
        include?: TaskIncludes;
      };
}

// =====================
// OrderBy Types
// =====================

export interface BudgetOrderBy {
  id?: ORDER_BY_DIRECTION;
  total?: ORDER_BY_DIRECTION;
  expiresIn?: ORDER_BY_DIRECTION;
  taskId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  task?: TaskOrderBy;
}

// =====================
// Response Interfaces - Budget
// =====================

export interface BudgetGetUniqueResponse extends BaseGetUniqueResponse<Budget> {}
export interface BudgetGetManyResponse extends BaseGetManyResponse<Budget> {}
export interface BudgetCreateResponse extends BaseCreateResponse<Budget> {}
export interface BudgetUpdateResponse extends BaseUpdateResponse<Budget> {}
export interface BudgetDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses - Budget
// =====================

export interface BudgetBatchCreateResponse<T> extends BaseBatchResponse<Budget, T> {}
export interface BudgetBatchUpdateResponse<T>
  extends BaseBatchResponse<Budget, T & { id: string }> {}
export interface BudgetBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
