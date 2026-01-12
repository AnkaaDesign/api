// packages/interfaces/src/task-pricing-item.ts

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
import type { TaskPricing, TaskPricingIncludes, TaskPricingOrderBy } from './task-pricing';

// =====================
// TaskPricingItem Interface
// =====================

export interface TaskPricingItem extends BaseEntity {
  description: string;
  amount: number;
  pricingId: string;

  // Relations
  pricing?: TaskPricing;
}

// =====================
// Include Types
// =====================

export interface TaskPricingItemIncludes {
  pricing?:
    | boolean
    | {
        include?: TaskPricingIncludes;
      };
}

// =====================
// OrderBy Types
// =====================

export interface TaskPricingItemOrderBy {
  id?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  amount?: ORDER_BY_DIRECTION;
  pricingId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  pricing?: TaskPricingOrderBy;
}

// =====================
// Response Interfaces - TaskPricingItem
// =====================

export interface TaskPricingItemGetUniqueResponse extends BaseGetUniqueResponse<TaskPricingItem> {}
export interface TaskPricingItemGetManyResponse extends BaseGetManyResponse<TaskPricingItem> {}
export interface TaskPricingItemCreateResponse extends BaseCreateResponse<TaskPricingItem> {}
export interface TaskPricingItemUpdateResponse extends BaseUpdateResponse<TaskPricingItem> {}
export interface TaskPricingItemDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses - TaskPricingItem
// =====================

export interface TaskPricingItemBatchCreateResponse<T>
  extends BaseBatchResponse<TaskPricingItem, T> {}
export interface TaskPricingItemBatchUpdateResponse<T> extends BaseBatchResponse<
  TaskPricingItem,
  T & { id: string }
> {}
export interface TaskPricingItemBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
