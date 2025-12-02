// packages/types/src/bonusDiscount.ts

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
import type { Bonus, BonusIncludes } from './bonus';

// =====================
// Main Entity Interface
// =====================

export interface BonusDiscount extends BaseEntity {
  bonusId: string;
  percentage: number | null;
  value: number | null;
  reference: string;
  calculationOrder: number;

  // Relations (optional, populated based on query)
  bonus?: Bonus;
  suspendedTasks?: any[]; // Task type would need to be imported if available
}

// =====================
// Include Types
// =====================

export interface BonusDiscountIncludes {
  bonus?:
    | boolean
    | {
        include?: BonusIncludes;
      };
  suspendedTasks?:
    | boolean
    | {
        include?: any; // Task includes would need proper typing
        where?: any;
        orderBy?: any;
      };
}

// =====================
// Where Types (for filtering)
// =====================

export interface BonusDiscountWhere {
  id?: string | { in?: string[]; notIn?: string[] };
  bonusId?: string | { in?: string[]; notIn?: string[] };
  percentage?: number | { gte?: number; lte?: number; gt?: number; lt?: number } | null;
  value?: number | { gte?: number; lte?: number; gt?: number; lt?: number } | null;
  reference?:
    | string
    | {
        contains?: string;
        mode?: 'default' | 'insensitive';
        startsWith?: string;
        endsWith?: string;
      };
  calculationOrder?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  createdAt?: Date | { gte?: Date; lte?: Date; gt?: Date; lt?: Date };
  updatedAt?: Date | { gte?: Date; lte?: Date; gt?: Date; lt?: Date };

  // Logical operators
  AND?: BonusDiscountWhere | BonusDiscountWhere[];
  OR?: BonusDiscountWhere[];
  NOT?: BonusDiscountWhere | BonusDiscountWhere[];

  // Relations
  bonus?: {
    id?: string | { in?: string[] };
    userId?: string | { in?: string[] };
    year?: number | { in?: number[]; gte?: number; lte?: number };
    month?: number | { in?: number[]; gte?: number; lte?: number };
    status?: string | { in?: string[] };
  };
}

// =====================
// Order By Types
// =====================

export interface BonusDiscountOrderBy {
  id?: ORDER_BY_DIRECTION;
  bonusId?: ORDER_BY_DIRECTION;
  percentage?: ORDER_BY_DIRECTION;
  value?: ORDER_BY_DIRECTION;
  reference?: ORDER_BY_DIRECTION;
  calculationOrder?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;

  // Relations
  bonus?: {
    userId?: ORDER_BY_DIRECTION;
    year?: ORDER_BY_DIRECTION;
    month?: ORDER_BY_DIRECTION;
    calculatedBonus?: ORDER_BY_DIRECTION;
    createdAt?: ORDER_BY_DIRECTION;
  };
}

// =====================
// API Response Types
// =====================

export type BonusDiscountGetUniqueResponse = BaseGetUniqueResponse<BonusDiscount>;
export type BonusDiscountGetManyResponse = BaseGetManyResponse<BonusDiscount>;
export type BonusDiscountCreateResponse = BaseCreateResponse<BonusDiscount>;
export type BonusDiscountUpdateResponse = BaseUpdateResponse<BonusDiscount>;
export type BonusDiscountDeleteResponse = BaseDeleteResponse;
export type BonusDiscountBatchResponse<T = any> = BaseBatchResponse<T>;

// Specific batch operation response types for BonusDiscount
export interface BonusDiscountCreateFormData {
  bonusId: string;
  percentage?: number | null;
  value?: number | null;
  reference: string;
  calculationOrder?: number;
}

export interface BonusDiscountUpdateFormData {
  bonusId?: string;
  percentage?: number | null;
  value?: number | null;
  reference?: string;
  calculationOrder?: number;
}

export type BonusDiscountBatchCreateResponse = BaseBatchResponse<
  BonusDiscount,
  BonusDiscountCreateFormData
>;
export type BonusDiscountBatchUpdateResponse = BaseBatchResponse<
  BonusDiscount,
  BonusDiscountUpdateFormData
>;
export type BonusDiscountBatchDeleteResponse = BaseBatchResponse<string, string>;

// =====================
// Generic Get Many Params
// =====================

export interface BonusDiscountGetManyParams {
  skip?: number;
  page?: number;
  take?: number;
  orderBy?: BonusDiscountOrderBy;
  where?: BonusDiscountWhere;
  include?: BonusDiscountIncludes;
  searchingFor?: string; // Multi-field search parameter

  // Specific bonus discount filters
  bonusId?: string;
  reference?: string;
  calculationOrder?: number;
}

export interface BonusDiscountGetByIdParams {
  include?: BonusDiscountIncludes;
}

// =====================
// Form Data Types
// =====================

export interface BonusDiscountCreateFormData {
  bonusId: string;
  percentage?: number | null;
  value?: number | null;
  reference: string;
  calculationOrder?: number;
}

export interface BonusDiscountUpdateFormData {
  bonusId?: string;
  percentage?: number | null;
  value?: number | null;
  reference?: string;
  calculationOrder?: number;
}
