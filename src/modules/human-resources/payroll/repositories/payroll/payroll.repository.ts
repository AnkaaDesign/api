// repositories/payroll.repository.ts

import { Payroll } from '../../../../../types';
import {
  PayrollCreateFormData,
  PayrollUpdateFormData,
  PayrollInclude,
  PayrollOrderBy,
  PayrollWhere,
} from '../../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class PayrollRepository extends BaseStringRepository<
  Payroll,
  PayrollCreateFormData,
  PayrollUpdateFormData,
  PayrollInclude,
  PayrollOrderBy,
  PayrollWhere
> {
  /**
   * Find payroll by user and period (unique constraint)
   * @param userId - The user ID
   * @param year - The year
   * @param month - The month
   * @param include - Optional relations to include
   * @returns The payroll if found, null otherwise
   */
  abstract findByUserAndPeriod(
    userId: string,
    year: number,
    month: number,
    include?: PayrollInclude,
  ): Promise<Payroll | null>;

  /**
   * Find payroll by user and period with transaction
   * @param transaction - The Prisma transaction
   * @param userId - The user ID
   * @param year - The year
   * @param month - The month
   * @param include - Optional relations to include
   * @returns The payroll if found, null otherwise
   */
  abstract findByUserAndPeriodWithTransaction(
    transaction: PrismaTransaction,
    userId: string,
    year: number,
    month: number,
    include?: PayrollInclude,
  ): Promise<Payroll | null>;

  /**
   * Create payrolls for all active users for a specific month/year
   * @param year - The year
   * @param month - The month
   * @param transaction - Optional transaction
   * @returns Number of payrolls created
   */
  abstract createManyForMonth(
    year: number,
    month: number,
    transaction?: PrismaTransaction,
  ): Promise<number>;

  /**
   * Get all active users who don't have a payroll for the specified period
   * @param year - The year
   * @param month - The month
   * @returns Array of users without payroll for the period
   */
  abstract getActiveUsersWithoutPayroll(year: number, month: number): Promise<any[]>;
}