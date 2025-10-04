// packages/constants/src/stock-thresholds.ts

import { STOCK_LEVEL } from "./enums";

/**
 * Stock threshold percentages relative to reorder point
 */
export const CRITICAL_THRESHOLD = 0.9; // 10% below reorder point
export const LOW_THRESHOLD = 1.1; // 10% above reorder point

/**
 * Stock level colors using Tailwind classes
 */
export const STOCK_LEVEL_COLORS: Record<STOCK_LEVEL, string> = {
  [STOCK_LEVEL.NEGATIVE_STOCK]: "text-neutral-500",
  [STOCK_LEVEL.OUT_OF_STOCK]: "text-red-600",
  [STOCK_LEVEL.CRITICAL]: "text-orange-500",
  [STOCK_LEVEL.LOW]: "text-yellow-500",
  [STOCK_LEVEL.OPTIMAL]: "text-green-600",
  [STOCK_LEVEL.OVERSTOCKED]: "text-purple-600",
};
