import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TransactionCategoryService } from './transaction-category.service';

/**
 * Keeps the ITEM_DERIVED TransactionCategory mirror in sync with the inventory
 * ItemCategory tree at runtime. The inventory module emits `item-category.changed`
 * (create/update) and `item-category.deleted`; this listener mirrors each change
 * into the corresponding ITEM_DERIVED reconciliation category so a fiscal-document
 * line tagged with an inventory category resolves to the right chart-of-accounts
 * group (accountingType).
 *
 * Both handlers are idempotent and swallow errors (the inventory mutation must not
 * fail just because the financial mirror could not be updated — the one-off
 * sync script reconciles any drift).
 */
@Injectable()
export class ItemCategoryMirrorListener {
  private readonly logger = new Logger(ItemCategoryMirrorListener.name);

  constructor(private readonly categories: TransactionCategoryService) {}

  @OnEvent('item-category.changed')
  async handleChanged(event: { itemCategoryId?: string; id?: string }): Promise<void> {
    const itemCategoryId = event?.itemCategoryId ?? event?.id;
    if (!itemCategoryId) {
      this.logger.warn('item-category.changed received without an id; skipping mirror sync');
      return;
    }
    try {
      const result = await this.categories.syncMirrorFromItemCategory(itemCategoryId);
      this.logger.log(`Mirror sync for ItemCategory ${itemCategoryId}: ${result}`);
    } catch (err) {
      this.logger.error(`Mirror sync failed for ItemCategory ${itemCategoryId}: ${err}`);
    }
  }

  @OnEvent('item-category.deleted')
  async handleDeleted(event: { itemCategoryId?: string; id?: string }): Promise<void> {
    const itemCategoryId = event?.itemCategoryId ?? event?.id;
    if (!itemCategoryId) {
      this.logger.warn('item-category.deleted received without an id; skipping mirror deactivation');
      return;
    }
    try {
      const changed = await this.categories.deactivateMirror(itemCategoryId);
      this.logger.log(
        `Mirror deactivation for ItemCategory ${itemCategoryId}: ${changed ? 'deactivated' : 'noop'}`,
      );
    } catch (err) {
      this.logger.error(`Mirror deactivation failed for ItemCategory ${itemCategoryId}: ${err}`);
    }
  }
}
