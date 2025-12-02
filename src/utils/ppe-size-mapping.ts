import { PPE_SIZE } from '@constants';

/**
 * Maps PPE size enum values to numeric values for storage in measures table
 * This allows us to store categorical sizes as numeric values in the measures.value field
 */
export const PPE_SIZE_TO_NUMERIC: Record<string, number> = {
  // Shirt, Sleeves, Mask sizes
  [PPE_SIZE.P]: 1,
  [PPE_SIZE.M]: 2,
  [PPE_SIZE.G]: 3,
  [PPE_SIZE.GG]: 4,
  [PPE_SIZE.XG]: 5,

  // Boots and Pants sizes (numeric)
  [PPE_SIZE.SIZE_36]: 36,
  [PPE_SIZE.SIZE_38]: 38,
  [PPE_SIZE.SIZE_40]: 40,
  [PPE_SIZE.SIZE_42]: 42,
  [PPE_SIZE.SIZE_44]: 44,
  [PPE_SIZE.SIZE_46]: 46,
  [PPE_SIZE.SIZE_48]: 48,
};

/**
 * Maps numeric values back to PPE size enum values
 */
export const NUMERIC_TO_PPE_SIZE: Record<number, string> = Object.fromEntries(
  Object.entries(PPE_SIZE_TO_NUMERIC).map(([size, value]) => [value, size]),
);

/**
 * Convert PPE size string to numeric value for storage
 */
export function ppeSizeToNumeric(size: string): number | null {
  return PPE_SIZE_TO_NUMERIC[size] || null;
}

/**
 * Convert numeric value back to PPE size string
 */
export function numericToPpeSize(value: number): string | null {
  return NUMERIC_TO_PPE_SIZE[value] || null;
}

/**
 * Get PPE size from an item's measures
 */
export function getPpeSizeFromMeasures(
  measures: Array<{ measureType: string; value: number }>,
): string | null {
  const sizeMeasure = measures.find(m => m.measureType === 'SIZE');
  if (!sizeMeasure) return null;
  return numericToPpeSize(sizeMeasure.value);
}

/**
 * Create a measure object for PPE size
 * @deprecated Use createPpeSizeMeasure from @utils/item instead
 * This function has incorrect logic - sizes should be stored in the unit field, not value
 */
export function createPpeSizeMeasureDeprecated(size: string, itemId: string) {
  const numericValue = ppeSizeToNumeric(size);
  if (!numericValue) return null;

  return {
    measureType: 'SIZE',
    value: numericValue,
    unit: 'UNIT', // SIZE measures use UNIT as the unit
    itemId,
  };
}
