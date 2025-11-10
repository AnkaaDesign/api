import type { Item, MonetaryValue } from '@types';
import { dateUtils } from "./date";
import { numberUtils } from "./number";
import { MEASURE_UNIT_LABELS, STOCK_LEVEL_LABELS, ITEM_ISSUE_TYPE_LABELS } from '@constants';
import { MEASURE_UNIT, STOCK_LEVEL, ITEM_ISSUE_TYPE, PPE_TYPE, PPE_SIZE, PPE_DELIVERY_MODE } from '@constants';
import type { PpeType, PpeSize, PpeDeliveryMode } from "@prisma/client";

/**
 * Map PPE enum values to Prisma enums
 */
export function mapPpeTypeToPrisma(type: PPE_TYPE | string | null | undefined): PpeType | null | undefined {
  return type as PpeType | null | undefined;
}

export function mapPpeSizeToPrisma(size: PPE_SIZE | string | null | undefined): PpeSize | null | undefined {
  return size as unknown as PpeSize | null | undefined;
}

export function mapPpeDeliveryModeToPrisma(mode: PPE_DELIVERY_MODE | string | null | undefined): PpeDeliveryMode | null | undefined {
  return mode as PpeDeliveryMode | null | undefined;
}

/**
 * Get stock status based on quantity
 */
export function getStockStatus(item: Item): "critical" | "low" | "normal" | "high" {
  const quantity = item.quantity || 0;
  const reorderPoint = item.reorderPoint || 0;
  const maxQuantity = item.maxQuantity || Infinity;

  if (quantity === 0) return "critical";
  if (quantity <= reorderPoint) return "low";
  if (quantity >= maxQuantity) return "high";
  return "normal";
}

/**
 * Get stock status label
 */
export function getStockStatusLabel(status: "critical" | "low" | "normal" | "high"): string {
  const labels = {
    critical: "Crítico",
    low: "Baixo",
    normal: "Normal",
    high: "Alto",
  };
  return labels[status];
}

/**
 * Get stock status color
 */
export function getStockStatusColor(status: "critical" | "low" | "normal" | "high"): string {
  const colors = {
    critical: "red",
    low: "yellow",
    normal: "green",
    high: "blue",
  };
  return colors[status];
}

/**
 * Check if item should track inventory
 */
export function shouldTrackItem(item: Item): boolean {
  // Since trackInventory doesn't exist, use isActive as indicator
  return item.isActive === true;
}

/**
 * Check if item is in stock
 */
export function isInStock(item: Item): boolean {
  return (item.quantity || 0) > 0;
}

/**
 * Check if item is low stock
 */
export function isLowStock(item: Item): boolean {
  const quantity = item.quantity || 0;
  const reorderPoint = item.reorderPoint || 10;
  return quantity > 0 && quantity <= reorderPoint;
}

/**
 * Check if item is out of stock
 */
export function isOutOfStock(item: Item): boolean {
  return (item.quantity || 0) === 0;
}

/**
 * Check if item needs reorder
 */
export function needsReorder(item: Item): boolean {
  if (!item.reorderPoint) return false;
  return (item.quantity || 0) <= item.reorderPoint;
}

/**
 * Format stock display
 * @deprecated Use formatItemQuantity instead
 */
export function formatStockDisplay(item: Item): string {
  return formatItemQuantity(item);
}

/**
 * Check if quantity update is recent
 */
export function isQuantityUpdateRecent(item: Item, thresholdHours: number = 24): boolean {
  if (!item.updatedAt) return false;
  const hoursSinceUpdate = dateUtils.getHoursAgo(item.updatedAt);
  return hoursSinceUpdate <= thresholdHours;
}

/**
 * Get days since last update
 */
export function getDaysSinceUpdate(item: Item): number | null {
  if (!item.updatedAt) return null;
  return dateUtils.getDaysAgo(item.updatedAt);
}

/**
 * Get latest item price
 */
export function getLatestItemPrice(item: Item): number {
  if (!item.prices || item.prices.length === 0) return 0;
  // Sort by createdAt to ensure we get the latest
  const sortedPrices = [...item.prices].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return sortedPrices[0].value;
}

/**
 * Get formatted price
 */
export function getFormattedPrice(item: Item): string {
  const price = getLatestItemPrice(item);
  return numberUtils.formatCurrency(price);
}

/**
 * Calculate item value (price * quantity)
 */
export function getItemValue(item: Item): number {
  const price = getLatestItemPrice(item);
  const quantity = item.quantity || 0;
  return price * quantity;
}

/**
 * Calculate item total cost including ICMS and IPI
 */
export function getItemTotalCost(item: Item): number {
  const value = getItemValue(item);
  const icms = item.icms || 0;
  const ipi = item.ipi || 0;
  return value + (value * icms) / 100 + (value * ipi) / 100;
}

/**
 * Get price history sorted by date
 */
export function getPriceHistory(item: Item): MonetaryValue[] {
  if (!item.prices) return [];

  return item.prices.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Calculate price change percentage
 */
export function getPriceChangePercentage(item: Item): number | null {
  const prices = getPriceHistory(item);
  if (prices.length < 2) return null;

  const currentPrice = prices[0].value;
  const previousPrice = prices[1].value;

  if (previousPrice === 0) return null;
  return ((currentPrice - previousPrice) / previousPrice) * 100;
}

/**
 * Group items by category
 */
export function groupItemsByCategory(items: Item[]): Record<string, Item[]> {
  return items.reduce(
    (groups, item) => {
      const category = item.category?.name || "Sem categoria";
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(item);
      return groups;
    },
    {} as Record<string, Item[]>,
  );
}

/**
 * Filter items by stock status
 */
export function filterItemsByStockStatus(items: Item[], statuses: Array<"critical" | "low" | "normal" | "high">): Item[] {
  return items.filter((item) => statuses.includes(getStockStatus(item)));
}

/**
 * Filter active items
 */
export function filterActiveItems(items: Item[]): Item[] {
  return items.filter((item) => item.isActive);
}

/**
 * Filter PPE items
 */
export function filterPpeItems(items: Item[]): Item[] {
  return items.filter((item) => isPpe(item));
}

/**
 * Filter PPE items by type
 */
export function filterPpeItemsByType(items: Item[], ppeType: PPE_TYPE): Item[] {
  return items.filter((item) => item.ppeType === ppeType);
}

/**
 * Filter PPE items by size (size stored in measures)
 */
export function filterPpeItemsBySize(items: Item[], ppeSize: string): Item[] {
  return items.filter((item) => {
    const itemSize = getPpeSize(item);
    return itemSize === ppeSize;
  });
}

/**
 * Filter PPE items by type and size (size stored in measures)
 */
export function filterPpeItemsByTypeAndSize(items: Item[], ppeType: PPE_TYPE, ppeSize: string): Item[] {
  return items.filter((item) => {
    const itemSize = getPpeSize(item);
    return item.ppeType === ppeType && itemSize === ppeSize;
  });
}

/**
 * Group PPE items by type
 */
export function groupPpeItemsByType(items: Item[]): Record<PPE_TYPE, Item[]> {
  const ppeItems = filterPpeItems(items);
  const groups: Partial<Record<PPE_TYPE, Item[]>> = {};

  ppeItems.forEach((item) => {
    if (item.ppeType) {
      if (!groups[item.ppeType]) {
        groups[item.ppeType] = [];
      }
      groups[item.ppeType]!.push(item);
    }
  });

  return groups as Record<PPE_TYPE, Item[]>;
}

/**
 * Group PPE items by size (size stored in measures)
 */
export function groupPpeItemsBySize(items: Item[]): Record<string, Item[]> {
  const ppeItems = filterPpeItems(items);
  const groups: Record<string, Item[]> = {};

  ppeItems.forEach((item) => {
    const itemSize = getPpeSize(item);
    if (itemSize) {
      if (!groups[itemSize]) {
        groups[itemSize] = [];
      }
      groups[itemSize].push(item);
    }
  });

  return groups;
}

/**
 * Calculate inventory statistics
 */
export function calculateInventoryStats(items: Item[]) {
  const total = items.length;
  const totalValue = items.reduce((sum, item) => sum + getItemValue(item), 0);
  const totalQuantity = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const totalMonthlyConsumption = items.reduce((sum, item) => sum + (item.monthlyConsumption || 0), 0);

  const stockStatus = {
    critical: 0,
    low: 0,
    normal: 0,
    high: 0,
  };

  items.forEach((item) => {
    const status = getStockStatus(item);
    stockStatus[status]++;
  });

  const outOfStock = items.filter(isOutOfStock).length;
  const lowStock = items.filter(isLowStock).length;
  const needsReorderCount = items.filter(needsReorder).length;
  const activeItems = items.filter((item) => item.isActive).length;
  const ppeItems = items.filter((item) => isPpe(item)).length;

  return {
    total,
    totalValue,
    totalQuantity,
    totalMonthlyConsumption,
    stockStatus,
    outOfStock,
    lowStock,
    needsReorder: needsReorderCount,
    activeItems,
    ppeItems,
  };
}

/**
 * Sort items by update date
 */
export function sortItemsByUpdateDate(items: Item[], order: "asc" | "desc" = "desc"): Item[] {
  return [...items].sort((a, b) => {
    const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return order === "asc" ? dateA - dateB : dateB - dateA;
  });
}

/**
 * Get item summary
 */
export function getItemSummary(item: Item): string {
  const stock = formatItemQuantity(item);
  const price = getFormattedPrice(item);
  const brand = item.brand?.name || "";
  return `${item.name}${brand ? ` - ${brand}` : ""} | ${stock} | ${price}`;
}

/**
 * Check if item has barcode
 */
export function hasBarcode(item: Item): boolean {
  return item.barcodes && item.barcodes.length > 0;
}

/**
 * Check if item has CA number
 */
export function hasCA(item: Item): boolean {
  // CA is now stored directly on item as ppeCA
  if (!item.ppeCA) return false;
  return item.ppeCA !== null && item.ppeCA !== "";
}

/**
 * Check if item is a PPE (Personal Protective Equipment)
 */
export function isPpe(item: Item): boolean {
  return item.ppeType !== null;
}

/**
 * Get PPE type from item
 */
export function getPpeType(item: Item): PPE_TYPE | null {
  return item.ppeType;
}

/**
 * Get PPE size from item's measures array
 */
export function getPpeSize(item: Item): string | null {
  if (!item.measures || item.measures.length === 0) return null;
  const sizeMeasure = item.measures.find(m => m.measureType === "SIZE");
  return sizeMeasure?.unit || null;
}

/**
 * Check if item has PPE configuration
 */
export function hasPpeConfiguration(item: Item): boolean {
  return isPpe(item) && item.ppeDeliveryMode !== null && item.ppeStandardQuantity !== null;
}

/**
 * Check if item has UniCode
 */
export function hasUniCode(item: Item): boolean {
  return item.uniCode !== null && item.uniCode !== "";
}

/**
 * Get measure unit label
 */
export function getMeasureUnitLabel(unit: MEASURE_UNIT): string {
  return MEASURE_UNIT_LABELS[unit] || unit;
}

/**
 * Get stock level label
 */
export function getStockLevelLabel(level: STOCK_LEVEL): string {
  return STOCK_LEVEL_LABELS[level] || level;
}

/**
 * Get item issue type label
 */
export function getItemIssueTypeLabel(type: ITEM_ISSUE_TYPE): string {
  return ITEM_ISSUE_TYPE_LABELS[type] || type;
}

/**
 * Format item quantity with measure unit
 * Properly handles null measure units and provides consistent formatting
 */
export function formatItemQuantity(item: Item): string {
  const quantity = item.quantity || 0;
  const formattedQuantity = numberUtils.formatNumber(quantity);

  // Check if item has measures
  if (!item.measures || item.measures.length === 0) {
    return formattedQuantity;
  }

  // Use the first measure's unit (could be enhanced to find most appropriate unit)
  const measure = item.measures[0];
  if (!measure.unit) {
    return formattedQuantity;
  }
  const unitLabel = MEASURE_UNIT_LABELS[measure.unit] || measure.unit;
  return `${formattedQuantity} ${unitLabel}`;
}

/**
 * Format item quantity with measure value (e.g., "5 units of 1kg each")
 * Used for items that have both quantity and measure value
 */
export function formatItemQuantityWithMeasureValue(item: Item): string {
  const quantity = item.quantity || 0;
  const formattedQuantity = numberUtils.formatNumber(quantity);

  // Check if item has measures
  if (!item.measures || item.measures.length === 0) {
    return formattedQuantity;
  }

  // Use the first measure's unit (could be enhanced to find most appropriate unit)
  const measure = item.measures[0];
  if (!measure.unit) {
    return formattedQuantity;
  }
  const unitLabel = MEASURE_UNIT_LABELS[measure.unit] || measure.unit;

  // If item has a measure value, show it (e.g., "5 units of 1kg each")
  if (measure.value && measure.value > 0) {
    const formattedMeasureValue = numberUtils.formatNumber(measure.value);
    return `${formattedQuantity} ${unitLabel} (${formattedMeasureValue}${unitLabel} cada)`;
  }

  return `${formattedQuantity} ${unitLabel}`;
}

/**
 * Get PPE size from item's measures array
 * Handles both letter sizes (P, M, G) stored in unit field
 * and numeric sizes (36, 38, 40) stored in value field
 * This is a helper function that extracts the SIZE measure
 */
export function getPpeSizeFromItem(item: Item): string | null {
  if (!item.measures || item.measures.length === 0) return null;
  const sizeMeasure = item.measures.find(m => m.measureType === "SIZE");
  if (!sizeMeasure) return null;

  // Letter sizes (P, M, G, GG, XG) are stored in unit field
  if (sizeMeasure.unit) {
    return sizeMeasure.unit;
  }

  // Numeric sizes (36, 38, 40, etc.) are stored in value field
  // Return as string for consistency
  if (sizeMeasure.value !== null && sizeMeasure.value !== undefined) {
    return String(sizeMeasure.value);
  }

  return null;
}

/**
 * Filter items by PPE size (using measures)
 * @param items - Array of items to filter
 * @param size - The PPE size to filter by (e.g., "P", "M", "G", "SIZE_40", etc.)
 * @returns Filtered array of items that have the specified size
 */
export function filterItemsByPpeSize(items: Item[], size: string): Item[] {
  return items.filter(item => {
    const itemSize = getPpeSizeFromItem(item);
    return itemSize === size;
  });
}

/**
 * Check if item has a SIZE measure
 * @param item - The item to check
 * @returns True if the item has a SIZE measure, false otherwise
 */
export function itemHasSizeMeasure(item: Item): boolean {
  if (!item.measures || item.measures.length === 0) return false;
  return item.measures.some(m => m.measureType === "SIZE");
}

/**
 * Set or update PPE size measure for an item
 * This creates a new measure object for use in item creation/update
 * @param size - The size value (e.g., "P", "M", "G", "SIZE_40", etc.)
 * @returns A measure object for the SIZE type
 */
export function createPpeSizeMeasure(size: string): { measureType: string; unit: string; value: null } {
  return {
    measureType: "SIZE",
    unit: size,
    value: null,
  };
}

// Export all item utilities as a namespace object
export const itemUtils = {
  getStockStatus,
  getStockStatusLabel,
  getStockStatusColor,
  shouldTrackItem,
  isInStock,
  isLowStock,
  isOutOfStock,
  needsReorder,
  formatStockDisplay,
  isQuantityUpdateRecent,
  getDaysSinceUpdate,
  getLatestItemPrice,
  getFormattedPrice,
  getItemValue,
  getItemTotalCost,
  getPriceHistory,
  getPriceChangePercentage,
  groupItemsByCategory,
  filterItemsByStockStatus,
  filterActiveItems,
  filterPpeItems,
  calculateInventoryStats,
  sortItemsByUpdateDate,
  getItemSummary,
  hasBarcode,
  hasCA,
  isPpe,
  getPpeType,
  getPpeSize,
  hasPpeConfiguration,
  filterPpeItemsByType,
  filterPpeItemsBySize,
  filterPpeItemsByTypeAndSize,
  groupPpeItemsByType,
  groupPpeItemsBySize,
  hasUniCode,
  getMeasureUnitLabel,
  getStockLevelLabel,
  getItemIssueTypeLabel,
  formatItemQuantity,
  formatItemQuantityWithMeasureValue,
  // New helper functions for PPE size migration
  getPpeSizeFromItem,
  filterItemsByPpeSize,
  itemHasSizeMeasure,
  createPpeSizeMeasure,
};
