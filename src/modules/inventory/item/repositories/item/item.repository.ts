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

  /**
   * Find many items with list-optimized select
   * Use this for table views and lists where you need basic item info
   * @param options Query options
   * @returns Items with minimal fields for list display
   */
  abstract findManyForList(
    options?: import('@types').FindManyOptions<ItemOrderBy, ItemWhere, ItemInclude>,
  ): Promise<import('@types').FindManyResult<Item>>;

  /**
   * Find many items for combobox/dropdown
   * Returns only id and name fields
   * @param options Query options
   * @returns Minimal item data for comboboxes
   */
  abstract findManyForCombobox(
    options?: import('@types').FindManyOptions<ItemOrderBy, ItemWhere, ItemInclude>,
  ): Promise<import('@types').FindManyResult<Item>>;

  /**
   * Find item by ID with form-optimized select
   * Use this when loading items for editing
   * @param id Item ID
   * @returns Item with all fields needed for forms
   */
  abstract findByIdForForm(id: string): Promise<Item | null>;

  /**
   * Find item by ID with detail-optimized select
   * Use this for detail/view pages
   * @param id Item ID
   * @returns Item with comprehensive data for viewing
   */
  abstract findByIdForDetail(id: string): Promise<Item | null>;

  /**
   * Find items by IDs with list-optimized select
   * Use this for bulk operations where you need basic item info
   * @param ids Array of item IDs
   * @returns Items with minimal fields for list display
   */
  abstract findByIdsForList(ids: string[]): Promise<Item[]>;

  /**
   * Find items by IDs for combobox
   * Returns only essential fields
   * @param ids Array of item IDs
   * @returns Minimal item data
   */
  abstract findByIdsForCombobox(ids: string[]): Promise<Item[]>;
}
