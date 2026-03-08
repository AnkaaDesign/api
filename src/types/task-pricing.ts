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
import type { TaskPricingService } from './task-pricing-service';
import type { TaskPricingCustomerConfig } from './task-pricing-customer-config';
import type { File } from './file';

// =====================
// TaskPricing Status Enum (mirrored from constants)
// =====================

export type TASK_PRICING_STATUS = 'PENDING' | 'BUDGET_APPROVED' | 'VERIFIED' | 'INTERNAL_APPROVED' | 'UPCOMING' | 'PARTIAL' | 'SETTLED';
export type DISCOUNT_TYPE = 'NONE' | 'PERCENTAGE' | 'FIXED_VALUE';

// =====================
// TaskPricing Interface
// =====================

export interface TaskPricing extends BaseEntity {
  budgetNumber: number; // Auto-generated sequential number for display
  subtotal: number; // Aggregate: sum of config subtotals
  total: number; // Aggregate: sum of config totals
  expiresAt: Date;
  status: TASK_PRICING_STATUS;
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
  services?: TaskPricingService[];
  customerConfigs?: TaskPricingCustomerConfig[];
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
export type TaskPricingInclude = TaskPricingIncludes;

// =====================
// OrderBy Types
// =====================

export interface TaskPricingOrderBy {
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

export interface TaskPricingWhere {
  id?: string | { in: string[] };
  taskId?: string;
  status?: TASK_PRICING_STATUS | { in: TASK_PRICING_STATUS[] };
  expiresAt?: Date | { gte?: Date; lte?: Date };
  simultaneousTasks?: number | { gte?: number; lte?: number; equals?: number };
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
