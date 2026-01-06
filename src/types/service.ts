// packages/types/src/service.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { ORDER_BY_DIRECTION, SERVICE_ORDER_TYPE } from '@constants';

// =====================
// Main Entity Interface
// =====================

export interface Service extends BaseEntity {
  description: string;
  type: SERVICE_ORDER_TYPE;
}

// =====================
// Include Types
// =====================

export interface ServiceIncludes {
  // No relations to include
}

// =====================
// Order By Types
// =====================

export interface ServiceOrderBy {
  id?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  type?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface ServiceGetUniqueResponse extends BaseGetUniqueResponse<Service> {}
export interface ServiceGetManyResponse extends BaseGetManyResponse<Service> {}
export interface ServiceCreateResponse extends BaseCreateResponse<Service> {}
export interface ServiceUpdateResponse extends BaseUpdateResponse<Service> {}
export interface ServiceDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface ServiceBatchCreateResponse<T> extends BaseBatchResponse<Service, T> {}
export interface ServiceBatchUpdateResponse<T> extends BaseBatchResponse<
  Service,
  T & { id: string }
> {}
export interface ServiceBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
