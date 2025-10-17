// packages/interfaces/src/budget.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { ORDER_BY_DIRECTION } from '@constants';
import type { Task, TaskIncludes, TaskOrderBy } from "./task";

// =====================
// Budget Interface
// =====================

export interface Budget extends BaseEntity {
  referencia: string;
  valor: number;
  taskId: string;

  // Relations
  task?: Task;
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
  referencia?: ORDER_BY_DIRECTION;
  valor?: ORDER_BY_DIRECTION;
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
export interface BudgetBatchUpdateResponse<T> extends BaseBatchResponse<Budget, T & { id: string }> {}
export interface BudgetBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
