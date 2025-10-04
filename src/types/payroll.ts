import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { ORDER_BY_DIRECTION, BONUS_STATUS } from '@constants';
import type { Bonus, BonusIncludes } from "./bonus";
import type { User, UserIncludes } from "./user";
import type { Position, PositionIncludes } from "./position";

// =====================
// Main Entity Interfaces
// =====================

export interface Discount extends BaseEntity {
  percentage: number | null;
  value: number | null;
  calculationOrder: number;
  reference: string;
  payrollId: string;

  // Relations (optional, populated based on query)
  payroll?: Payroll;
}

export interface Payroll extends BaseEntity {
  baseRemuneration: number;
  year: number;
  month: number;
  userId: string;
  positionId?: string | null;

  // Calculated fields (from bonus/discounts)
  performanceLevel?: number;
  bonusAmount?: number;
  remunerationAmount?: number;
  totalEarnings?: number;
  status?: BONUS_STATUS;
  statusOrder?: number;

  // Relations (optional, populated based on query)
  bonus?: Bonus;
  discounts?: Discount[];
  user?: User;
  position?: Position;
  bonusDetails?: any; // BonusDetail type

  // Count fields (when included)
  _count?: {
    discounts?: number;
  };
}

// =====================
// Include Types
// =====================

export interface PayrollIncludes {
  bonus?:
    | boolean
    | {
        include?: BonusIncludes;
      };
  discounts?:
    | boolean
    | {
        include?: DiscountIncludes;
        where?: DiscountWhere;
        orderBy?: DiscountOrderBy;
      };
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
  position?:
    | boolean
    | {
        include?: PositionIncludes;
      };
  bonusDetails?:
    | boolean
    | {
        include?: any; // BonusDetailIncludes when available
      };
}

export interface DiscountIncludes {
  payroll?:
    | boolean
    | {
        include?: PayrollIncludes;
      };
}

// =====================
// Where Types (for filtering)
// =====================

export interface DiscountWhere {
  id?: string | { in?: string[]; notIn?: string[] };
  reference?: string | { contains?: string; mode?: "default" | "insensitive" };
  payrollId?: string | { in?: string[]; notIn?: string[] };
  percentage?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  value?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  calculationOrder?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  createdAt?: Date | { gte?: Date; lte?: Date; gt?: Date; lt?: Date };
  updatedAt?: Date | { gte?: Date; lte?: Date; gt?: Date; lt?: Date };

  // Logical operators
  AND?: DiscountWhere | DiscountWhere[];
  OR?: DiscountWhere[];
  NOT?: DiscountWhere | DiscountWhere[];

  // Relations
  payroll?: {
    id?: string | { in?: string[] };
    userId?: string | { in?: string[] };
    year?: number | { in?: number[] };
    month?: number | { in?: number[] };
  };
}

export interface PayrollWhere {
  id?: string | { in?: string[]; notIn?: string[] };
  userId?: string | { in?: string[]; notIn?: string[] };
  year?: number | { in?: number[]; gte?: number; lte?: number; gt?: number; lt?: number };
  month?: number | { in?: number[]; gte?: number; lte?: number; gt?: number; lt?: number };
  positionId?: string | { in?: string[]; notIn?: string[] };
  baseRemuneration?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  performanceLevel?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  bonusAmount?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  remunerationAmount?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  totalEarnings?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  status?: BONUS_STATUS | { in?: BONUS_STATUS[] };
  statusOrder?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  createdAt?: Date | { gte?: Date; lte?: Date; gt?: Date; lt?: Date };
  updatedAt?: Date | { gte?: Date; lte?: Date; gt?: Date; lt?: Date };

  // Logical operators
  AND?: PayrollWhere | PayrollWhere[];
  OR?: PayrollWhere[];
  NOT?: PayrollWhere | PayrollWhere[];

  // Relations
  user?: {
    id?: string | { in?: string[] };
    name?: string | { contains?: string; mode?: "default" | "insensitive" };
    email?: string | { contains?: string; mode?: "default" | "insensitive" };
    status?: string | { in?: string[] };
    positionId?: string | { in?: string[] };
    sectorId?: string | { in?: string[] };
  };
  position?: {
    id?: string | { in?: string[] };
    name?: string | { contains?: string; mode?: "default" | "insensitive" };
    bonifiable?: boolean;
  };
  bonus?: {
    id?: string | { in?: string[] };
    status?: BONUS_STATUS | { in?: BONUS_STATUS[] };
    performanceLevel?: number | { gte?: number; lte?: number };
    baseBonus?: number | { gte?: number; lte?: number };
  };
}

// =====================
// Order By Types
// =====================

export interface DiscountOrderBy {
  id?: ORDER_BY_DIRECTION;
  calculationOrder?: ORDER_BY_DIRECTION;
  reference?: ORDER_BY_DIRECTION;
  percentage?: ORDER_BY_DIRECTION;
  value?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;

  // Relations
  payroll?: {
    year?: ORDER_BY_DIRECTION;
    month?: ORDER_BY_DIRECTION;
    createdAt?: ORDER_BY_DIRECTION;
  };
}

export interface PayrollOrderBy {
  id?: ORDER_BY_DIRECTION;
  year?: ORDER_BY_DIRECTION;
  month?: ORDER_BY_DIRECTION;
  userId?: ORDER_BY_DIRECTION;
  baseRemuneration?: ORDER_BY_DIRECTION;
  performanceLevel?: ORDER_BY_DIRECTION;
  bonusAmount?: ORDER_BY_DIRECTION;
  remunerationAmount?: ORDER_BY_DIRECTION;
  totalEarnings?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;

  // Relations
  user?: {
    name?: ORDER_BY_DIRECTION;
    email?: ORDER_BY_DIRECTION;
    createdAt?: ORDER_BY_DIRECTION;
  };
  position?: {
    name?: ORDER_BY_DIRECTION;
    bonifiable?: ORDER_BY_DIRECTION;
  };
  bonus?: {
    status?: ORDER_BY_DIRECTION;
    performanceLevel?: ORDER_BY_DIRECTION;
    baseBonus?: ORDER_BY_DIRECTION;
  };
}

// =====================
// Generic Get Many Params
// =====================

export interface PayrollGetManyParams {
  skip?: number;
  page?: number;
  take?: number;
  limit?: number;
  orderBy?: PayrollOrderBy;
  where?: PayrollWhere;
  include?: PayrollIncludes;
  searchingFor?: string; // Multi-field search parameter

  // Specific payroll filters
  year?: number;
  month?: number;
  userId?: string;
  positionId?: string;
  status?: BONUS_STATUS;
  multipleMonths?: boolean; // For querying across multiple months
}

export interface PayrollGetByIdParams {
  include?: PayrollIncludes;
}

// =====================
// API Response Types
// =====================

export type PayrollGetUniqueResponse = BaseGetUniqueResponse<Payroll>;
export type PayrollGetManyResponse = BaseGetManyResponse<Payroll>;
export type PayrollCreateResponse = BaseCreateResponse<Payroll>;
export type PayrollUpdateResponse = BaseUpdateResponse<Payroll>;
export type PayrollDeleteResponse = BaseDeleteResponse;
export type PayrollBatchResponse<T = any> = BaseBatchResponse<T>;

// Discount-specific responses
export type DiscountGetUniqueResponse = BaseGetUniqueResponse<Discount>;
export type DiscountGetManyResponse = BaseGetManyResponse<Discount>;
export type DiscountCreateResponse = BaseCreateResponse<Discount>;
export type DiscountUpdateResponse = BaseUpdateResponse<Discount>;
export type DiscountDeleteResponse = BaseDeleteResponse;
export type DiscountBatchResponse<T = any> = BaseBatchResponse<T>;

// Specific batch operation response types for Discount
export type DiscountBatchCreateResponse<T = DiscountCreateFormData> = BaseBatchResponse<Discount, T>;
export type DiscountBatchUpdateResponse<T = DiscountUpdateFormData> = BaseBatchResponse<Discount, T>;
export type DiscountBatchDeleteResponse = BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }>;

// =====================
// Form Data Types (from schemas)
// =====================

// Payroll form data types
export interface PayrollCreateFormData {
  baseRemuneration: number;
  year: number;
  month: number;
  userId: string;
  positionId?: string | null;
  discounts?: DiscountCreateFormData[];
}

export interface PayrollUpdateFormData {
  baseRemuneration?: number;
  positionId?: string | null;
  discounts?: DiscountCreateFormData[];
}

// Discount form data types
export interface DiscountCreateFormData {
  percentage?: number | null;
  value?: number | null;
  calculationOrder?: number;
  reference: string;
}

export interface DiscountUpdateFormData {
  percentage?: number | null;
  value?: number | null;
  calculationOrder?: number;
  reference?: string;
}

// Query form data types
export interface DiscountGetManyParams {
  where?: DiscountWhere;
  include?: DiscountIncludes;
  orderBy?: DiscountOrderBy;
  skip?: number;
  take?: number;
  page?: number;
  limit?: number;
}

export interface DiscountGetByIdParams {
  include?: DiscountIncludes;
}

// Batch operation types
export interface PayrollBatchCreateFormData {
  payrolls: PayrollCreateFormData[];
}

export interface PayrollBatchUpdateFormData {
  updates: Array<{
    id: string;
    data: PayrollUpdateFormData;
  }>;
}

export interface PayrollBatchDeleteFormData {
  ids: string[];
}

export interface DiscountBatchCreateFormData {
  discounts: Array<DiscountCreateFormData & { payrollId: string }>;
}

export interface DiscountBatchUpdateFormData {
  updates: Array<{
    id: string;
    data: DiscountUpdateFormData;
  }>;
}

export interface DiscountBatchDeleteFormData {
  ids: string[];
}

// =====================
// Live Calculation Types
// =====================

export interface LivePayroll {
  userId: string;
  year: number;
  month: number;
  baseRemuneration: number;
  performanceLevel: number;
  bonusAmount: number;
  remunerationAmount: number;
  totalEarnings: number;
  discountAmount: number;
  netEarnings: number;
  status: BONUS_STATUS;

  // Related data
  user?: User;
  position?: Position;
  bonus?: Bonus;
  discounts?: Discount[];
}

// =====================
// Specialized Query Types
// =====================

export interface PayrollSummaryParams {
  year: number;
  month: number;
  sectorId?: string;
}

export interface LiveBonusCalculationParams {
  year: number;
  month: number;
  userId?: string;
}

export interface BonusSimulationParams {
  year: number;
  month: number;
  taskQuantity?: number;
  sectorIds?: string[];
  excludeUserIds?: string[];
}

export interface PayrollGenerateMonthParams {
  year: number;
  month: number;
  overwriteExisting?: boolean;
}

export interface PayrollLiveCalculationParams {
  include?: PayrollIncludes;
}