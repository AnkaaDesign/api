// src/types/benefit.ts
// Benefícios e adesões (Departamento Pessoal)

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { BENEFIT_KIND, BENEFIT_ENROLLMENT_STATUS, ORDER_BY_DIRECTION } from '@constants';
import type { User, UserIncludes } from './user';
import type { File } from './file';

// =====================
// Main Entity Interfaces
// =====================

export interface Benefit extends BaseEntity {
  kind: BENEFIT_KIND;
  name: string;
  provider: string | null;
  defaultValue: number | null;
  defaultEmployeeDiscountPercent: number | null;
  isActive: boolean;
  notes: string | null;

  // Relations (optional, populated based on query)
  enrollments?: UserBenefit[];
  _count?: { enrollments?: number };
}

export interface UserBenefit extends BaseEntity {
  userId: string;
  benefitId: string;
  status: BENEFIT_ENROLLMENT_STATUS;
  statusOrder: number;
  startDate: Date;
  endDate: Date | null;
  monthlyValue: number;
  employeeDiscountValue: number | null;
  employeeDiscountPercent: number | null;
  dailyTickets: number | null;
  declarationFileId: string | null;
  notes: string | null;

  // Relations (optional, populated based on query)
  user?: User;
  benefit?: Benefit;
  declarationFile?: File;
}

// =====================
// Include Types
// =====================

export interface BenefitIncludes {
  enrollments?:
    | boolean
    | {
        include?: UserBenefitIncludes;
      };
  _count?: boolean | { select?: { enrollments?: boolean } };
}

export interface UserBenefitIncludes {
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
  benefit?:
    | boolean
    | {
        include?: BenefitIncludes;
      };
  declarationFile?: boolean;
}

// =====================
// Order By Types
// =====================

export interface BenefitOrderBy {
  id?: ORDER_BY_DIRECTION;
  kind?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  provider?: ORDER_BY_DIRECTION;
  defaultValue?: ORDER_BY_DIRECTION;
  defaultEmployeeDiscountPercent?: ORDER_BY_DIRECTION;
  isActive?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface UserBenefitOrderBy {
  id?: ORDER_BY_DIRECTION;
  userId?: ORDER_BY_DIRECTION;
  benefitId?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  startDate?: ORDER_BY_DIRECTION;
  endDate?: ORDER_BY_DIRECTION;
  monthlyValue?: ORDER_BY_DIRECTION;
  employeeDiscountValue?: ORDER_BY_DIRECTION;
  employeeDiscountPercent?: ORDER_BY_DIRECTION;
  dailyTickets?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces — Benefit
// =====================

export interface BenefitGetUniqueResponse extends BaseGetUniqueResponse<Benefit> {}
export interface BenefitGetManyResponse extends BaseGetManyResponse<Benefit> {}
export interface BenefitCreateResponse extends BaseCreateResponse<Benefit> {}
export interface BenefitUpdateResponse extends BaseUpdateResponse<Benefit> {}
export interface BenefitDeleteResponse extends BaseDeleteResponse {}

export interface BenefitBatchCreateResponse<T> extends BaseBatchResponse<Benefit, T> {}
export interface BenefitBatchUpdateResponse<T> extends BaseBatchResponse<
  Benefit,
  T & { id: string }
> {}
export interface BenefitBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}

// =====================
// Response Interfaces — UserBenefit
// =====================

export interface UserBenefitGetUniqueResponse extends BaseGetUniqueResponse<UserBenefit> {}
export interface UserBenefitGetManyResponse extends BaseGetManyResponse<UserBenefit> {}
export interface UserBenefitCreateResponse extends BaseCreateResponse<UserBenefit> {}
export interface UserBenefitUpdateResponse extends BaseUpdateResponse<UserBenefit> {}
export interface UserBenefitDeleteResponse extends BaseDeleteResponse {}

export interface UserBenefitBatchCreateResponse<T> extends BaseBatchResponse<UserBenefit, T> {}
export interface UserBenefitBatchUpdateResponse<T> extends BaseBatchResponse<
  UserBenefit,
  T & { id: string }
> {}
export interface UserBenefitBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
