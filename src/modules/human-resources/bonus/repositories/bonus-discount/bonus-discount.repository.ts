import {
  BonusDiscount,
  BonusDiscountIncludes,
  BonusDiscountOrderBy,
  BonusDiscountWhere,
  BonusDiscountGetManyParams,
  FindManyResult,
} from '../../../../../types';
import {
  BonusDiscountCreateFormData,
} from '../../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

// Note: BonusDiscount typically doesn't have updates, only create/delete
// So we use the same type as create for consistency with the base repository pattern
export type BonusDiscountUpdateFormData = Partial<BonusDiscountCreateFormData>;

export abstract class BonusDiscountRepository extends BaseStringRepository<
  BonusDiscount,
  BonusDiscountCreateFormData,
  BonusDiscountUpdateFormData,
  BonusDiscountIncludes,
  BonusDiscountOrderBy,
  BonusDiscountWhere
> {
  /**
   * Find all discounts for a specific bonus
   * @param bonusId The bonus ID
   * @param options Optional includes
   * @returns Array of bonus discounts
   */
  abstract findByBonusId(
    bonusId: string,
    options?: { include?: BonusDiscountIncludes },
  ): Promise<BonusDiscount[]>;

  /**
   * Find all discounts for a specific bonus within a transaction
   * @param transaction The Prisma transaction
   * @param bonusId The bonus ID
   * @param options Optional includes
   * @returns Array of bonus discounts
   */
  abstract findByBonusIdWithTransaction(
    transaction: PrismaTransaction,
    bonusId: string,
    options?: { include?: BonusDiscountIncludes },
  ): Promise<BonusDiscount[]>;

  /**
   * Find all discounts with a specific reference
   * @param reference The discount reference
   * @param options Optional pagination and includes
   * @returns Array of bonus discounts with metadata
   */
  abstract findByReference(
    reference: string,
    options?: BonusDiscountGetManyParams,
  ): Promise<FindManyResult<BonusDiscount>>;

  /**
   * Find all discounts with a specific reference within a transaction
   * @param transaction The Prisma transaction
   * @param reference The discount reference
   * @param options Optional pagination and includes
   * @returns Array of bonus discounts with metadata
   */
  abstract findByReferenceWithTransaction(
    transaction: PrismaTransaction,
    reference: string,
    options?: BonusDiscountGetManyParams,
  ): Promise<FindManyResult<BonusDiscount>>;

  /**
   * Delete all discounts for a specific bonus
   * @param bonusId The bonus ID
   * @returns Number of deleted records
   */
  abstract deleteByBonusId(bonusId: string): Promise<number>;

  /**
   * Delete all discounts for a specific bonus within a transaction
   * @param transaction The Prisma transaction
   * @param bonusId The bonus ID
   * @returns Number of deleted records
   */
  abstract deleteByBonusIdWithTransaction(
    transaction: PrismaTransaction,
    bonusId: string,
  ): Promise<number>;
}