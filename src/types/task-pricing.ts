// packages/interfaces/src/task-pricing.ts

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
import type { TaskPricingItem } from './task-pricing-item';

// =====================
// TaskPricing Status Enum (mirrored from constants)
// =====================

export type TASK_PRICING_STATUS = 'DRAFT' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

// =====================
// TaskPricing Interface
// =====================

export interface TaskPricing extends BaseEntity {
  total: number;
  expiresAt: Date;
  status: TASK_PRICING_STATUS;
  taskId: string;

  // Relations
  task?: Task;
  items?: TaskPricingItem[];
}

// =====================
// Include Types
// =====================

export interface TaskPricingIncludes {
  task?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  items?: boolean;
}

// Alias for backward compatibility
export type TaskPricingInclude = TaskPricingIncludes;

// =====================
// OrderBy Types
// =====================

export interface TaskPricingOrderBy {
  id?: ORDER_BY_DIRECTION;
  total?: ORDER_BY_DIRECTION;
  expiresAt?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  taskId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  task?: TaskOrderBy;
}

// =====================
// Where/Filter Types
// =====================

export interface TaskPricingWhere {
  id?: string | { in: string[] };
  taskId?: string;
  status?: TASK_PRICING_STATUS | { in: TASK_PRICING_STATUS[] };
  expiresAt?: Date | { gte?: Date; lte?: Date };
  createdAt?: Date | { gte?: Date; lte?: Date };
}

// =====================
// Response Interfaces - TaskPricing
// =====================

export interface TaskPricingGetUniqueResponse extends BaseGetUniqueResponse<TaskPricing> {}
export interface TaskPricingGetManyResponse extends BaseGetManyResponse<TaskPricing> {}
export interface TaskPricingCreateResponse extends BaseCreateResponse<TaskPricing> {}
export interface TaskPricingUpdateResponse extends BaseUpdateResponse<TaskPricing> {}
export interface TaskPricingDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses - TaskPricing
// =====================

export interface TaskPricingBatchCreateResponse<T> extends BaseBatchResponse<TaskPricing, T> {}
export interface TaskPricingBatchUpdateResponse<T> extends BaseBatchResponse<
  TaskPricing,
  T & { id: string }
> {}
export interface TaskPricingBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
