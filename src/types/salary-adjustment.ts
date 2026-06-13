// src/types/salary-adjustment.ts
// Reajustes salariais (Departamento Pessoal)

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { SALARY_ADJUSTMENT_TYPE, ORDER_BY_DIRECTION } from '@constants';
import type { User, UserIncludes } from './user';
import type { Position, PositionIncludes } from './position';

// =====================
// Main Entity Interfaces
// =====================

export interface SalaryAdjustment extends BaseEntity {
  type: SALARY_ADJUSTMENT_TYPE;
  percentage: number | null;
  effectiveDate: Date;
  note: string | null;
  appliedById: string | null;

  // Relations (optional, populated based on query)
  appliedBy?: User;
  items?: SalaryAdjustmentItem[];
}

export interface SalaryAdjustmentItem extends BaseEntity {
  salaryAdjustmentId: string;
  positionId: string;
  previousValue: number;
  newValue: number;

  // Relations (optional, populated based on query)
  salaryAdjustment?: SalaryAdjustment;
  position?: Position;
}

// =====================
// Include Types
// =====================

export interface SalaryAdjustmentIncludes {
  appliedBy?:
    | boolean
    | {
        include?: UserIncludes;
      };
  items?:
    | boolean
    | {
        include?: SalaryAdjustmentItemIncludes;
      };
}

export interface SalaryAdjustmentItemIncludes {
  salaryAdjustment?:
    | boolean
    | {
        include?: SalaryAdjustmentIncludes;
      };
  position?:
    | boolean
    | {
        include?: PositionIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface SalaryAdjustmentOrderBy {
  id?: ORDER_BY_DIRECTION;
  type?: ORDER_BY_DIRECTION;
  percentage?: ORDER_BY_DIRECTION;
  effectiveDate?: ORDER_BY_DIRECTION;
  note?: ORDER_BY_DIRECTION;
  appliedById?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Apply Operation Types
// =====================

export interface SalaryAdjustmentApplyResultItem {
  positionId: string;
  positionName: string;
  success: boolean;
  previousValue?: number;
  newValue?: number;
  adjustment?: number;
  percentageApplied?: number | null;
  error?: string;
}

export interface SalaryAdjustmentApplyResult {
  salaryAdjustment: SalaryAdjustment | null;
  totalSuccess: number;
  totalFailed: number;
  results: SalaryAdjustmentApplyResultItem[];
}

export interface SalaryAdjustmentApplyResponse {
  success: boolean;
  message: string;
  data?: SalaryAdjustmentApplyResult;
  error?: string;
}

// =====================
// Response Interfaces
// =====================

export interface SalaryAdjustmentGetUniqueResponse
  extends BaseGetUniqueResponse<SalaryAdjustment> {}
export interface SalaryAdjustmentGetManyResponse extends BaseGetManyResponse<SalaryAdjustment> {}
export interface SalaryAdjustmentCreateResponse extends BaseCreateResponse<SalaryAdjustment> {}
export interface SalaryAdjustmentUpdateResponse extends BaseUpdateResponse<SalaryAdjustment> {}
export interface SalaryAdjustmentDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface SalaryAdjustmentBatchUpdateResponse<T>
  extends BaseBatchResponse<SalaryAdjustment, T & { id: string }> {}
export interface SalaryAdjustmentBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
