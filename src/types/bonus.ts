// packages/types/src/bonus.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { ORDER_BY_DIRECTION } from '@constants';
import type { User, UserIncludes } from "./user";
import type { Task, TaskIncludes } from "./task";
import type { BonusDiscount, BonusDiscountIncludes } from "./bonusDiscount";

// =====================
// Main Entity Interfaces
// =====================

export interface Bonus extends BaseEntity {
  userId: string;
  payrollId?: string | null;
  year: number;
  month: number;
  performanceLevel: number;
  baseBonus: number | { toNumber: () => number }; // Decimal from Prisma
  ponderedTaskCount: number | { toNumber: () => number }; // Decimal from Prisma
  averageTasksPerUser: number | { toNumber: () => number }; // Decimal from Prisma
  calculationPeriodStart: Date;
  calculationPeriodEnd: Date;

  // Relations (optional, populated based on query)
  user?: User;
  users?: User[]; // All users receiving bonuses in the same period (many-to-many)
  tasks?: Task[];
  bonusDiscounts?: BonusDiscount[];
  payroll?: any; // Payroll type would need to be imported if available
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
  ponderedTaskCount?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  averageTasksPerUser?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  calculationPeriodStart?: Date | { gte?: Date; lte?: Date; gt?: Date; lt?: Date };
  calculationPeriodEnd?: Date | { gte?: Date; lte?: Date; gt?: Date; lt?: Date };
  createdAt?: Date | { gte?: Date; lte?: Date; gt?: Date; lt?: Date };
  updatedAt?: Date | { gte?: Date; lte?: Date; gt?: Date; lt?: Date };

  // Logical operators
  AND?: BonusWhere | BonusWhere[];
  OR?: BonusWhere[];
  NOT?: BonusWhere | BonusWhere[];

  // Relations
  user?: {
    id?: string | { in?: string[] };
    name?: string | { contains?: string; mode?: "default" | "insensitive" };
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
  ponderedTaskCount?: ORDER_BY_DIRECTION;
  averageTasksPerUser?: ORDER_BY_DIRECTION;
  calculationPeriodStart?: ORDER_BY_DIRECTION;
  calculationPeriodEnd?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;

  // Relations
  user?: {
    name?: ORDER_BY_DIRECTION;
    createdAt?: ORDER_BY_DIRECTION;
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
  ponderedTaskCount?: number;
  averageTasksPerUser?: number;
  calculationPeriodStart?: Date;
  calculationPeriodEnd?: Date;
  payrollId?: string;
}

export interface BonusUpdateFormData {
  year?: number;
  month?: number;
  userId?: string;
  performanceLevel?: number;
  baseBonus?: number;
  ponderedTaskCount?: number;
  averageTasksPerUser?: number;
  calculationPeriodStart?: Date;
  calculationPeriodEnd?: Date;
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
  baseBonus: number;
  ponderedTaskCount: number;
  averageTasksPerUser: number;
  calculationPeriodStart: Date;
  calculationPeriodEnd: Date;
  isLive: true;
  totalTasks?: number;
  weightedTaskCount?: number;
  tasks?: Task[];
  users?: User[];
  payrollId?: string;
  createdAt?: Date;
  updatedAt?: Date;
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
    calculationPeriod: {
      start: Date;
      end: Date;
    };
  };
}