import { Price } from '../../../../../types';
import {
  PriceCreateFormData,
  PriceUpdateFormData,
  PriceInclude,
  PriceOrderBy,
  PriceWhere,
} from '../../../../../schemas/item';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class ItemPriceRepository extends BaseStringRepository<
  Price,
  PriceCreateFormData,
  PriceUpdateFormData,
  PriceInclude,
  PriceOrderBy,
  PriceWhere
> {}
