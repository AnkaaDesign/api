import { ItemCategory } from '../../../../../types';
import {
  ItemCategoryCreateFormData,
  ItemCategoryUpdateFormData,
  ItemCategoryInclude,
  ItemCategoryOrderBy,
  ItemCategoryWhere,
  ItemInclude,
} from '../../../../../schemas/item';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class ItemCategoryRepository extends BaseStringRepository<
  ItemCategory,
  ItemCategoryCreateFormData,
  ItemCategoryUpdateFormData,
  ItemCategoryInclude,
  ItemCategoryOrderBy,
  ItemCategoryWhere
> {
  abstract findByName(
    name: string,
    options?: { include?: ItemInclude },
  ): Promise<ItemCategory | null>;
}
