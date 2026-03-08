// packages/interfaces/src/task-pricing-service.ts

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
import type { Customer } from './customer';

// =====================
// TaskPricingService Interface
// =====================

export interface TaskPricingService extends BaseEntity {
  description: string;
  observation?: string | null;
  amount: number;
  shouldSync: boolean;
  pricingId: string;
  invoiceToCustomerId: string | null;

  // Relations
  pricing?: TaskPricing;
  invoiceToCustomer?: Customer;
}

// =====================
// Include Types
// =====================

export interface TaskPricingServiceIncludes {
  pricing?:
    | boolean
    | {
        include?: TaskPricingIncludes;
      };
  invoiceToCustomer?: boolean | { select?: { id?: boolean; fantasyName?: boolean; cnpj?: boolean } };
}

// =====================
// OrderBy Types
// =====================

export interface TaskPricingServiceOrderBy {
  id?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  amount?: ORDER_BY_DIRECTION;
  pricingId?: ORDER_BY_DIRECTION;
  invoiceToCustomerId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  pricing?: TaskPricingOrderBy;
}

// =====================
// Response Interfaces - TaskPricingService
// =====================

export interface TaskPricingServiceGetUniqueResponse extends BaseGetUniqueResponse<TaskPricingService> {}
export interface TaskPricingServiceGetManyResponse extends BaseGetManyResponse<TaskPricingService> {}
export interface TaskPricingServiceCreateResponse extends BaseCreateResponse<TaskPricingService> {}
export interface TaskPricingServiceUpdateResponse extends BaseUpdateResponse<TaskPricingService> {}
export interface TaskPricingServiceDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses - TaskPricingService
// =====================

export interface TaskPricingServiceBatchCreateResponse<T> extends BaseBatchResponse<
  TaskPricingService,
  T
> {}
export interface TaskPricingServiceBatchUpdateResponse<T> extends BaseBatchResponse<
  TaskPricingService,
  T & { id: string }
> {}
export interface TaskPricingServiceBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
