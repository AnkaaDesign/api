// repositories/bonus/bonus.repository.ts

import { Bonus } from '../../../../../types';
import {
  BonusCreateFormData,
  BonusUpdateFormData,
  BonusInclude,
  BonusOrderBy,
  BonusWhere,
} from '../../../../../schemas/bonus';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

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
    year: number,
    month: number,
    tx?: PrismaTransaction
  ): Promise<Bonus | null>;

  abstract findByPeriod(
    year: number,
    month: number,
    include?: BonusInclude,
    tx?: PrismaTransaction
  ): Promise<Bonus[]>;

  abstract getPayrollData(
    year: number,
    month: number,
    userId?: string,
    sectorId?: string,
    tx?: PrismaTransaction
  ): Promise<any[]>;
}