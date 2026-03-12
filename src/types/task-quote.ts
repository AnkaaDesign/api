// packages/interfaces/src/task-quote.ts

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
import type { TaskQuoteService } from './task-quote-service';
import type { TaskQuoteCustomerConfig } from './task-quote-customer-config';
import type { File } from './file';

// =====================
// TaskQuote Status Enum (mirrored from constants)
// =====================

export type TASK_QUOTE_STATUS = 'PENDING' | 'BUDGET_APPROVED' | 'VERIFIED_BY_FINANCIAL' | 'INTERNAL_APPROVED' | 'UPCOMING' | 'DUE' | 'PARTIAL' | 'SETTLED';
export type DISCOUNT_TYPE = 'NONE' | 'PERCENTAGE' | 'FIXED_VALUE';

// =====================
// TaskQuote Interface
// =====================

export interface TaskQuote extends BaseEntity {
  budgetNumber: number; // Auto-generated sequential number for display
  subtotal: number; // Aggregate: sum of config subtotals
  total: number; // Aggregate: sum of config totals
  expiresAt: Date;
  status: TASK_QUOTE_STATUS;
  statusOrder: number;

  // Guarantee Terms
  guaranteeYears: number | null;
  customGuaranteeText: string | null;

  // Custom Forecast - manual override for production days displayed in budget
  customForecastDays: number | null;

  // Layout File
  layoutFileId: string | null;
  layoutFile?: File;

  simultaneousTasks: number | null;

  // Relations
  task?: Task; // One-to-one relationship with task
  services?: TaskQuoteService[];
  customerConfigs?: TaskQuoteCustomerConfig[];
}

// =====================
// Include Types
// =====================

export interface TaskQuoteIncludes {
  task?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  services?:
    | boolean
    | {
        orderBy?: {
          position?: 'asc' | 'desc';
        };
        include?: {
          invoiceToCustomer?: boolean | { select?: { id?: boolean; fantasyName?: boolean; cnpj?: boolean } };
        };
      };
  layoutFile?: boolean;
  customerConfigs?:
    | boolean
    | {
        include?: {
          customer?: boolean | { select?: { id?: boolean; fantasyName?: boolean; cnpj?: boolean } };
          customerSignature?: boolean;
          responsible?: boolean;
          installments?: boolean | { orderBy?: { number?: 'asc' | 'desc' } };
        };
      };
}

// Alias for backward compatibility
export type TaskQuoteInclude = TaskQuoteIncludes;

// =====================
// OrderBy Types
// =====================

export interface TaskQuoteOrderBy {
  id?: ORDER_BY_DIRECTION;
  total?: ORDER_BY_DIRECTION;
  expiresAt?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  taskId?: ORDER_BY_DIRECTION;
  simultaneousTasks?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  task?: TaskOrderBy;
}

// =====================
// Where/Filter Types
// =====================

export interface TaskQuoteWhere {
  id?: string | { in: string[] };
  taskId?: string;
  status?: TASK_QUOTE_STATUS | { in: TASK_QUOTE_STATUS[] };
  expiresAt?: Date | { gte?: Date; lte?: Date };
  simultaneousTasks?: number | { gte?: number; lte?: number; equals?: number };
  createdAt?: Date | { gte?: Date; lte?: Date };
}

// =====================
// Response Interfaces - TaskQuote
// =====================

export interface TaskQuoteGetUniqueResponse extends BaseGetUniqueResponse<TaskQuote> {}
export interface TaskQuoteGetManyResponse extends BaseGetManyResponse<TaskQuote> {}
export interface TaskQuoteCreateResponse extends BaseCreateResponse<TaskQuote> {}
export interface TaskQuoteUpdateResponse extends BaseUpdateResponse<TaskQuote> {}
export interface TaskQuoteDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses - TaskQuote
// =====================

export interface TaskQuoteBatchCreateResponse<T> extends BaseBatchResponse<TaskQuote, T> {}
export interface TaskQuoteBatchUpdateResponse<T> extends BaseBatchResponse<
  TaskQuote,
  T & { id: string }
> {}
export interface TaskQuoteBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
