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

  /**
   * Returns the id plus all descendant category ids (children, grandchildren, ...)
   * for the given category id, used to filter items by a category subtree.
   * The returned array always includes the input id itself.
   */
  abstract listDescendantIds(id: string): Promise<string[]>;
}
