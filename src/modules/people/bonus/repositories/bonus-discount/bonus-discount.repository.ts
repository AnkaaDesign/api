// repositories/bonus-discount/bonus-discount.repository.ts

import { BonusDiscount } from '../../../../../types';
import {
  BonusDiscountCreateFormData,
  BonusDiscountUpdateFormData,
  BonusDiscountInclude,
  BonusDiscountOrderBy,
  BonusDiscountWhere,
} from '../../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class BonusDiscountRepository extends BaseStringRepository<
  BonusDiscount,
  BonusDiscountCreateFormData,
  BonusDiscountUpdateFormData,
  BonusDiscountInclude,
  BonusDiscountOrderBy,
  BonusDiscountWhere
> {
  // BonusDiscount-specific methods
  abstract findByBonusId(
    bonusId: string,
    include?: BonusDiscountInclude,
    tx?: PrismaTransaction
  ): Promise<BonusDiscount[]>;

  abstract deleteByBonusId(bonusId: string, tx?: PrismaTransaction): Promise<void>;
}