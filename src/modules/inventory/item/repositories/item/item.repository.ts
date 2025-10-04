import { Item } from '../../../../../types';
import {
  ItemCreateFormData,
  ItemUpdateFormData,
  ItemInclude,
  ItemOrderBy,
  ItemWhere,
} from '../../../../../schemas/item';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class ItemRepository extends BaseStringRepository<
  Item,
  ItemCreateFormData,
  ItemUpdateFormData,
  ItemInclude,
  ItemOrderBy,
  ItemWhere
> {
  /**
   * Find an item by barcode
   * @param barcode The barcode to search for
   * @param options Optional includes
   * @returns The item if found, null otherwise
   */
  abstract findByBarcode(
    barcode: string,
    options?: { include?: ItemInclude },
  ): Promise<Item | null>;

  /**
   * Find an item by barcode within a transaction
   * @param transaction The Prisma transaction
   * @param barcode The barcode to search for
   * @param options Optional includes
   * @returns The item if found, null otherwise
   */
  abstract findByBarcodeWithTransaction(
    transaction: PrismaTransaction,
    barcode: string,
    options?: { include?: ItemInclude },
  ): Promise<Item | null>;

  /**
   * Find an item by name
   * @param name The name to search for
   * @param options Optional includes
   * @returns The item if found, null otherwise
   */
  abstract findByName(name: string, options?: { include?: ItemInclude }): Promise<Item | null>;

  /**
   * Find an item by name within a transaction
   * @param transaction The Prisma transaction
   * @param name The name to search for
   * @param options Optional includes
   * @returns The item if found, null otherwise
   */
  abstract findByNameWithTransaction(
    transaction: PrismaTransaction,
    name: string,
    options?: { include?: ItemInclude },
  ): Promise<Item | null>;

  /**
   * Find multiple items by their IDs
   * @param ids Array of item IDs to search for
   * @param options Optional includes
   * @returns Array of items found
   */
  abstract findByIds(ids: string[], options?: { include?: ItemInclude }): Promise<Item[]>;

  /**
   * Find multiple items by their IDs within a transaction
   * @param transaction The Prisma transaction
   * @param ids Array of item IDs to search for
   * @param options Optional includes
   * @returns Array of items found
   */
  abstract findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: { include?: ItemInclude },
  ): Promise<Item[]>;
}
