import { ItemBrand } from '../../../../../types';
import {
  ItemBrandCreateFormData,
  ItemBrandUpdateFormData,
  ItemBrandInclude,
  ItemBrandOrderBy,
  ItemBrandWhere,
} from '../../../../../schemas/item';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class ItemBrandRepository extends BaseStringRepository<
  ItemBrand,
  ItemBrandCreateFormData,
  ItemBrandUpdateFormData,
  ItemBrandInclude,
  ItemBrandOrderBy,
  ItemBrandWhere
> {}
