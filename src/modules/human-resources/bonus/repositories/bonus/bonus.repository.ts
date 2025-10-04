// repositories/bonus.repository.ts

import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { BatchCreateResult, CreateManyOptions } from '../../../../../types';

// Temporary interfaces for bonus until schemas are created
interface BonusCreateFormData {
  userId: string;
  baseBonus: number;
  year: number;
  month: number;
  performanceLevel: number;
  payrollId?: string;
  ponderedTaskCount?: number;
  averageTasksPerUser?: number;
  calculationPeriodStart?: Date;
  calculationPeriodEnd?: Date;
}

interface BonusUpdateFormData {
  baseBonus?: number;
  performanceLevel?: number;
  payrollId?: string;
  ponderedTaskCount?: number;
  averageTasksPerUser?: number;
  calculationPeriodStart?: Date;
  calculationPeriodEnd?: Date;
}

interface BonusInclude {
  user?: boolean;
  bonusDiscounts?: boolean;
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

// Temporary Bonus interface
interface Bonus {
  id: string;
  userId: string;
  baseBonus: number;
  year: number;
  month: number;
  performanceLevel: number;
  payrollId?: string;
  ponderedTaskCount: number;
  averageTasksPerUser: number;
  calculationPeriodStart: Date;
  calculationPeriodEnd: Date;
  createdAt: Date;
  updatedAt: Date;
  user?: any;
  bonusDiscounts?: any[];
  payroll?: any;
  tasks?: any[];
  users?: any[];
}

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
    tx?: PrismaTransaction
  ): Promise<Bonus | null>;

  abstract findOrGenerateLive(
    userId: string,
    year: number,
    month: number,
    include?: BonusInclude,
    tx?: PrismaTransaction
  ): Promise<Bonus>;

  abstract findByPeriod(
    year: string,
    month: string,
    include?: BonusInclude,
    tx?: PrismaTransaction
  ): Promise<Bonus[]>;

  abstract getPayrollData(
    year: string,
    month: string,
    userId?: string,
    sectorId?: string,
    tx?: PrismaTransaction
  ): Promise<any[]>;

  abstract batchCreate(
    data: BonusCreateFormData[],
    options?: CreateManyOptions<BonusInclude>
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
