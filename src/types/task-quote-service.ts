// packages/interfaces/src/task-quote-service.ts

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
import type { TaskQuote, TaskQuoteIncludes, TaskQuoteOrderBy } from './task-quote';
import type { Customer } from './customer';

// =====================
// TaskQuoteService Interface
// =====================

export interface TaskQuoteService extends BaseEntity {
  description: string;
  observation?: string | null;
  amount: number;
  shouldSync: boolean;
  quoteId: string;
  invoiceToCustomerId: string | null;
  discountType: string;
  discountValue?: number | null;
  discountReference?: string | null;

  // Relations
  quote?: TaskQuote;
  invoiceToCustomer?: Customer;
}

// =====================
// Include Types
// =====================

export interface TaskQuoteServiceIncludes {
  quote?:
    | boolean
    | {
        include?: TaskQuoteIncludes;
      };
  invoiceToCustomer?: boolean | { select?: { id?: boolean; fantasyName?: boolean; cnpj?: boolean } };
}

// =====================
// OrderBy Types
// =====================

export interface TaskQuoteServiceOrderBy {
  id?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  amount?: ORDER_BY_DIRECTION;
  quoteId?: ORDER_BY_DIRECTION;
  invoiceToCustomerId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  quote?: TaskQuoteOrderBy;
}

// =====================
// Response Interfaces - TaskQuoteService
// =====================

export interface TaskQuoteServiceGetUniqueResponse extends BaseGetUniqueResponse<TaskQuoteService> {}
export interface TaskQuoteServiceGetManyResponse extends BaseGetManyResponse<TaskQuoteService> {}
export interface TaskQuoteServiceCreateResponse extends BaseCreateResponse<TaskQuoteService> {}
export interface TaskQuoteServiceUpdateResponse extends BaseUpdateResponse<TaskQuoteService> {}
export interface TaskQuoteServiceDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses - TaskQuoteService
// =====================

export interface TaskQuoteServiceBatchCreateResponse<T> extends BaseBatchResponse<
  TaskQuoteService,
  T
> {}
export interface TaskQuoteServiceBatchUpdateResponse<T> extends BaseBatchResponse<
  TaskQuoteService,
  T & { id: string }
> {}
export interface TaskQuoteServiceBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
