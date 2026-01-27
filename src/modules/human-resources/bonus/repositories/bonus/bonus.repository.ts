// repositories/bonus.repository.ts
// Clean bonus repository - simplified structure
// Period dates and task counts are computed from year/month and tasks relation

import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { BatchCreateResult, CreateManyOptions } from '../../../../../types';

// =====================
// Form Data Types
// =====================

interface BonusCreateFormData {
  userId: string;
  baseBonus: number;
  year: number;
  month: number;
  performanceLevel: number;
  payrollId?: string;
}

interface BonusUpdateFormData {
  baseBonus?: number;
  performanceLevel?: number;
  payrollId?: string | null;
}

// =====================
// Query Types
// =====================

interface BonusInclude {
  user?: boolean;
  bonusDiscounts?: boolean;
  bonusExtras?: boolean;
  payroll?: boolean;
  tasks?: boolean;
  users?: boolean;
}

interface BonusOrderBy {
  year?: 'asc' | 'desc';
  month?: 'asc' | 'desc';
  baseBonus?: 'asc' | 'desc';
  performanceLevel?: 'asc' | 'desc';
  createdAt?: 'asc' | 'desc';
  user?: { name?: 'asc' | 'desc' };
  tasks?: { _count?: 'asc' | 'desc' };
}

interface BonusWhere {
  userId?: string;
  year?: number | { gte?: number; lte?: number };
  month?: number | { gte?: number; lte?: number };
  baseBonus?: { gte?: number; lte?: number };
  performanceLevel?: number | { gte?: number; lte?: number };
  payrollId?: string;
  user?: {
    name?: { contains?: string; mode?: 'insensitive' };
  };
  payroll?: {
    id?: string;
    name?: { contains?: string; mode?: 'insensitive' };
  };
}

// =====================
// Entity Type
// =====================

interface Bonus {
  id: string;
  userId: string;
  baseBonus: number;
  year: number;
  month: number;
  performanceLevel: number;
  payrollId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Relations (populated based on query)
  user?: any;
  bonusDiscounts?: any[];
  bonusExtras?: any[];
  payroll?: any;
  tasks?: any[];
  users?: any[];
  // Computed fields (added by service layer)
  _computed?: {
    ponderedTaskCount?: number;
    periodStart?: Date;
    periodEnd?: Date;
  };
}

// =====================
// Repository Abstract Class
// =====================

export abstract class BonusRepository extends BaseStringRepository<
  Bonus,
  BonusCreateFormData,
  BonusUpdateFormData,
  BonusInclude,
  BonusOrderBy,
  BonusWhere
> {
  // Bonus-specific methods
  abstract findByUserAndPeriod(
    userId: string,
    year: string,
    month: string,
    include?: BonusInclude,
    tx?: PrismaTransaction,
  ): Promise<Bonus | null>;

  abstract findOrGenerateLive(
    userId: string,
    year: number,
    month: number,
    include?: BonusInclude,
    tx?: PrismaTransaction,
  ): Promise<Bonus>;

  abstract findByPeriod(
    year: string,
    month: string,
    include?: BonusInclude,
    tx?: PrismaTransaction,
  ): Promise<Bonus[]>;

  abstract batchCreate(
    data: BonusCreateFormData[],
    options?: CreateManyOptions<BonusInclude>,
  ): Promise<BatchCreateResult<Bonus, BonusCreateFormData>>;
}

export type {
  Bonus,
  BonusCreateFormData,
  BonusUpdateFormData,
  BonusInclude,
  BonusOrderBy,
  BonusWhere,
};
