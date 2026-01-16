// packages/types/src/bonus.ts
// Simplified Bonus entity - redundant fields removed
// Period dates are computed from year/month (26th of prev month to 25th of current month)
// ponderedTasks is computed from tasks array (FULL_COMMISSION=1.0, PARTIAL_COMMISSION=0.5)

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
import type { User, UserIncludes } from './user';
import type { Task, TaskIncludes } from './task';
import type { BonusDiscount, BonusDiscountIncludes } from './bonusDiscount';

// =====================
// Main Entity Interfaces
// =====================

export interface Bonus extends BaseEntity {
  userId: string;
  payrollId?: string | null;
  year: number;
  month: number;
  performanceLevel: number;
  baseBonus: number | { toNumber: () => number }; // Decimal from Prisma - Gross bonus before discounts
  netBonus: number | { toNumber: () => number }; // Decimal from Prisma - Net bonus after discounts
  weightedTasks: number | { toNumber: () => number }; // Decimal from Prisma - Total weighted tasks in period
  averageTaskPerUser: number | { toNumber: () => number }; // Decimal from Prisma - Average tasks per eligible user

  // Relations (optional, populated based on query)
  user?: User;
  users?: User[]; // All users receiving bonuses in the same period (many-to-many)
  tasks?: Task[];
  bonusDiscounts?: BonusDiscount[];
  payroll?: any; // Payroll type would need to be imported if available

  // Computed fields (added by service layer or frontend)
  _computed?: {
    ponderedTaskCount?: number; // Computed from tasks array
    periodStart?: Date; // Computed from year/month
    periodEnd?: Date; // Computed from year/month
  };
}

// =====================
// Include Types
// =====================

export interface BonusIncludes {
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
  users?:
    | boolean
    | {
        include?: UserIncludes;
      };
  tasks?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  bonusDiscounts?:
    | boolean
    | {
        include?: BonusDiscountIncludes;
      };
  payroll?:
    | boolean
    | {
        include?: any; // Payroll includes would need proper typing
      };
}

// =====================
// Where Types (for filtering)
// =====================

export interface BonusWhere {
  id?: string | { in?: string[]; notIn?: string[] };
  year?: number | { in?: number[]; gte?: number; lte?: number; gt?: number; lt?: number };
  month?: number | { in?: number[]; gte?: number; lte?: number; gt?: number; lt?: number };
  userId?: string | { in?: string[]; notIn?: string[] };
  payrollId?: string | { in?: string[]; notIn?: string[] };
  performanceLevel?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  baseBonus?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  createdAt?: Date | { gte?: Date; lte?: Date; gt?: Date; lt?: Date };
  updatedAt?: Date | { gte?: Date; lte?: Date; gt?: Date; lt?: Date };

  // Logical operators
  AND?: BonusWhere | BonusWhere[];
  OR?: BonusWhere[];
  NOT?: BonusWhere | BonusWhere[];

  // Relations
  user?: {
    id?: string | { in?: string[] };
    name?: string | { contains?: string; mode?: 'default' | 'insensitive' };
    status?: string | { in?: string[] };
    positionId?: string | { in?: string[] };
    sectorId?: string | { in?: string[] };
  };
}

// =====================
// Order By Types
// =====================

export interface BonusOrderBy {
  id?: ORDER_BY_DIRECTION;
  year?: ORDER_BY_DIRECTION;
  month?: ORDER_BY_DIRECTION;
  performanceLevel?: ORDER_BY_DIRECTION;
  baseBonus?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;

  // Relations - for sorting by task count, use tasks._count
  user?: {
    name?: ORDER_BY_DIRECTION;
    createdAt?: ORDER_BY_DIRECTION;
  };
  tasks?: {
    _count?: ORDER_BY_DIRECTION;
  };
}

// =====================

// =====================
// API Response Types
// =====================

export type BonusGetUniqueResponse = BaseGetUniqueResponse<Bonus>;
export type BonusGetManyResponse = BaseGetManyResponse<Bonus>;
export type BonusCreateResponse = BaseCreateResponse<Bonus>;
export type BonusUpdateResponse = BaseUpdateResponse<Bonus>;
export type BonusDeleteResponse = BaseDeleteResponse;
export type BonusBatchResponse<T = any> = BaseBatchResponse<T>;

// =====================
// Generic Get Many Params
// =====================

export interface BonusGetManyParams {
  skip?: number;
  page?: number;
  take?: number;
  orderBy?: BonusOrderBy;
  where?: BonusWhere;
  include?: BonusIncludes;
  searchingFor?: string; // Multi-field search parameter

  // Specific bonus filters
  year?: number;
  month?: number;
  userId?: string;
  payrollId?: string;
}

export interface BonusGetByIdParams {
  include?: BonusIncludes;
}

// =====================
// Form Data Types
// =====================

export interface BonusCreateFormData {
  year: number;
  month: number;
  userId: string;
  performanceLevel: number;
  baseBonus: number;
  payrollId?: string;
}

export interface BonusUpdateFormData {
  year?: number;
  month?: number;
  userId?: string;
  performanceLevel?: number;
  baseBonus?: number;
  payrollId?: string;
}

// =====================
// Live Bonus Types
// =====================

export interface LiveBonus {
  id?: string;
  userId: string;
  year: number;
  month: number;
  performanceLevel: number;
  baseBonus: number; // Gross bonus before discounts
  netBonus: number; // Net bonus after discounts (calculated from baseBonus - discounts)
  weightedTasks?: number; // Total weighted tasks in period
  averageTaskPerUser?: number; // Average tasks per eligible user
  isLive: true;
  tasks?: Task[];
  users?: User[];
  bonusDiscounts?: BonusDiscount[]; // Discounts applied to this bonus
  payrollId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  // Computed fields for live calculations
  _computed?: {
    ponderedTaskCount?: number;
    periodStart?: Date;
    periodEnd?: Date;
  };
}

// =====================
// Live Bonus Response Types
// =====================

export interface LiveBonusGetManyResponse {
  success: boolean;
  message: string;
  data?: LiveBonus[];
  meta?: {
    totalRecords: number;
    page: number;
    hasNextPage: boolean;
    // Period is computed from year/month, not stored
    year: number;
    month: number;
  };
}

// =====================
// Utility Types for Computed Values
// =====================

/**
 * Computed bonus data that can be calculated from the base entity
 * These values are NOT stored in the database but computed on-demand
 */
export interface BonusComputedFields {
  /** Weighted task count: FULL_COMMISSION = 1.0, PARTIAL_COMMISSION = 0.5 */
  ponderedTaskCount: number;
  /** Period start date (26th of previous month) */
  periodStart: Date;
  /** Period end date (25th of current month) */
  periodEnd: Date;
  /** Total eligible users for bonus calculation in this period */
  totalEligibleUsers?: number;
  /** Average tasks per user (ponderedTaskCount / totalEligibleUsers) */
  averageTasksPerUser?: number;
}
