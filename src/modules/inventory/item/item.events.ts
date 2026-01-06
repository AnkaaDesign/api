import { Item } from '../../../types';

/**
 * Event emitted when an item's stock falls to or below the reorder point
 */
export class ItemLowStockEvent {
  constructor(
    public readonly item: Item,
    public readonly currentQuantity: number,
    public readonly reorderPoint: number,
  ) {}
}

/**
 * Event emitted when an item is completely out of stock
 */
export class ItemOutOfStockEvent {
  constructor(public readonly item: Item) {}
}

/**
 * Event emitted when an item requires reordering
 */
export class ItemReorderRequiredEvent {
  constructor(
    public readonly item: Item,
    public readonly currentQuantity: number,
    public readonly reorderQuantity: number,
  ) {}
}

/**
 * Event emitted when an item's stock exceeds the maximum quantity
 */
export class ItemOverstockEvent {
  constructor(
    public readonly item: Item,
    public readonly currentQuantity: number,
    public readonly maxQuantity: number,
  ) {}
}
