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
import type { File } from './file';
import type { Customer } from './customer';

// =====================
// TaskPricing Status Enum (mirrored from constants)
// =====================

export type TASK_PRICING_STATUS = 'DRAFT' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type DISCOUNT_TYPE = 'NONE' | 'PERCENTAGE' | 'FIXED_VALUE';
export type PAYMENT_CONDITION =
  | 'CASH' // Single payment
  | 'INSTALLMENTS_2' // Down payment + 1 installment (20 days)
  | 'INSTALLMENTS_3' // Down payment + 2 installments (20/40 days)
  | 'INSTALLMENTS_4' // Down payment + 3 installments (20/40/60 days)
  | 'INSTALLMENTS_5' // Down payment + 4 installments (20/40/60/80 days)
  | 'INSTALLMENTS_6' // Down payment + 5 installments (20/40/60/80/100 days)
  | 'INSTALLMENTS_7' // Down payment + 6 installments (20/40/60/80/100/120 days)
  | 'CUSTOM'; // Custom payment terms

// =====================
// TaskPricing Interface
// =====================

export interface TaskPricing extends BaseEntity {
  budgetNumber: number; // Auto-generated sequential number for display
  subtotal: number;
  discountType: DISCOUNT_TYPE;
  discountValue: number | null;
  total: number;
  expiresAt: Date;
  status: TASK_PRICING_STATUS;

  // Payment Terms (simplified)
  paymentCondition: PAYMENT_CONDITION | null;
  downPaymentDate: Date | null;
  customPaymentText: string | null;

  // Guarantee Terms
  guaranteeYears: number | null;
  customGuaranteeText: string | null;

  // Custom Forecast - manual override for production days displayed in budget
  customForecastDays: number | null;

  // Layout File
  layoutFileId: string | null;
  layoutFile?: File;

  // Customer Signature (uploaded by customer on public page)
  customerSignatureId: string | null;
  customerSignature?: File;

  // New fields from Prisma migration
  simultaneousTasks: number | null;
  discountReference: string | null;

  // Relations
  task?: Task; // One-to-one relationship with task
  items?: TaskPricingItem[];
  invoicesToCustomers?: Customer[];
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
  items?:
    | boolean
    | {
        orderBy?: {
          position?: 'asc' | 'desc';
        };
      };
  layoutFile?: boolean;
  customerSignature?: boolean;
  invoicesToCustomers?:
    | boolean
    | {
        select?: { id?: boolean; fantasyName?: boolean; cnpj?: boolean };
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
  taskId?: ORDER_BY_DIRECTION;
  simultaneousTasks?: ORDER_BY_DIRECTION;
  discountReference?: ORDER_BY_DIRECTION;
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
  discountReference?: string | { contains?: string; startsWith?: string; endsWith?: string };
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
