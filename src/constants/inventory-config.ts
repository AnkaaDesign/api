// Inventory calculation constants — calibrated from the 2026-05-15 16-agent
// research consolidation (see /tmp/stock-refactor-findings.md, algorithm-spec.md).
// Helpers split across:
//   - working-days-config.ts (vacation + workdays)
//   - seasonality-config.ts  (decay, curve, corpus)
//   - ppe-config.ts          (PPE intervals, headcount, blend)

import { ACTIVITY_REASON } from './enums';

// =====================
// Activity reason classification (spec §2.1, §3.5)
// =====================

/** OUTBOUND activity reasons that count toward monthlyConsumption for the
 *  REGULAR pipeline. INVENTORY_COUNT and MANUAL_ADJUSTMENT are included here
 *  but must be bulk-distributed before aggregation (spec §2.2). */
export const REGULAR_CONSUMPTION_REASONS: ACTIVITY_REASON[] = [
  ACTIVITY_REASON.PRODUCTION_USAGE,
  ACTIVITY_REASON.PAINT_PRODUCTION,
  ACTIVITY_REASON.EXTERNAL_WITHDRAWAL,
  ACTIVITY_REASON.MAINTENANCE,
  ACTIVITY_REASON.DAMAGE,
  ACTIVITY_REASON.LOSS,
  ACTIVITY_REASON.INVENTORY_COUNT,
  ACTIVITY_REASON.MANUAL_ADJUSTMENT,
  ACTIVITY_REASON.OTHER,
];

/** Subset of REGULAR_CONSUMPTION_REASONS that must pass through the
 *  bulk-distributor before aggregation (spec §2.2). */
export const BULK_DISTRIBUTION_REASONS: ACTIVITY_REASON[] = [
  ACTIVITY_REASON.INVENTORY_COUNT,
  ACTIVITY_REASON.MANUAL_ADJUSTMENT,
];

/** OUTBOUND reasons that feed PPE hist_avg (spec §3.5). PPE consumption may
 *  appear under either PPE_DELIVERY or PRODUCTION_USAGE. */
export const PPE_CONSUMPTION_REASONS: ACTIVITY_REASON[] = [
  ACTIVITY_REASON.PPE_DELIVERY,
  ACTIVITY_REASON.PRODUCTION_USAGE,
];

/** Reasons excluded from every consumption calculation. */
export const NON_CONSUMPTION_REASONS: ACTIVITY_REASON[] = [
  ACTIVITY_REASON.BORROW,
  ACTIVITY_REASON.RETURN,
  ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN,
  ACTIVITY_REASON.ORDER_RECEIVED,
];

// =====================
// Consumption window (spec §2.3, §2.8)
// =====================

/** Rolling lookback for monthlyConsumption aggregation. */
export const CONSUMPTION_LOOKBACK_MONTHS = 6;

/** Minimum distinct calendar months of qualifying activity before an item
 *  can be classified. Below this, mc/rp/max all collapse to 0 and the item
 *  gets a `LOW_DATA` data-quality flag (spec §2.8). */
export const CONSUMPTION_MIN_DISTINCT_MONTHS = 3;

/** Minimum number of activities required before the item-write-back path
 *  persists a fresh mc/min/max. */
export const MIN_ACTIVITIES_FOR_MIN_MAX_UPDATE = 5;

/** Update hysteresis: skip the write-back if the new value is within this
 *  fraction of the persisted one. */
export const CONSUMPTION_UPDATE_THRESHOLD = 0.01;
export const REORDER_POINT_UPDATE_THRESHOLD = 0.1;

// =====================
// Lead time (spec §5)
// =====================

/** Tier-3 global default when neither item nor supplier has enough clean
 *  receipts (spec §5.1). Lifted from p90 of clean receipts (n=141 → 24.7d). */
export const DEFAULT_LEAD_TIME_DAYS = 25;
export const LEAD_TIME_MIN_DAYS = 1;
export const LEAD_TIME_MAX_DAYS = 365;

/** Lookback window for the p90 sample. */
export const LEAD_TIME_LOOKBACK_MONTHS = 6;

/** Minimum clean-receipt sample size for tier-1 (item) and tier-2 (supplier)
 *  p90 inference (spec §5.1). */
export const LEAD_TIME_TIER_MIN_CLEAN_RECEIPTS = 5;

/** Legacy bulk-import contamination signature (spec §5.2). Receipts where
 *  `Order.supplierId IS NULL` AND `OrderItem.receivedAt = THIS_DATE` are
 *  dropped from lead-time stats — 564 of 700 receipts otherwise dominate. */
export const LEAD_TIME_LEGACY_BULK_RECEIVED_AT = '2026-01-16';

/** Update hysteresis when the cron persists a new lead time. */
export const LEAD_TIME_UPDATE_PERCENT_THRESHOLD = 0.1;
export const LEAD_TIME_UPDATE_DAYS_THRESHOLD = 3;

// =====================
// Safety factor + targetStockDays matrix (spec §9)
// =====================

export type AbcXyzKey =
  | 'AX' | 'AY' | 'AZ'
  | 'BX' | 'BY' | 'BZ'
  | 'CX' | 'CY' | 'CZ'
  | 'UNCLASSIFIED';

export interface SafetyTargetCell {
  safetyFactor: number;
  targetStockDays: number;
}

/** Canonical safety-factor / targetStockDays table. The unclassified fallback
 *  fires whenever `abcCategory IS NULL` OR `xyzCategory IS NULL`. */
export const ABC_XYZ_MATRIX: Record<AbcXyzKey, SafetyTargetCell> = {
  AX: { safetyFactor: 0.15, targetStockDays: 30 },
  AY: { safetyFactor: 0.25, targetStockDays: 45 },
  AZ: { safetyFactor: 0.4,  targetStockDays: 60 },
  BX: { safetyFactor: 0.12, targetStockDays: 45 },
  BY: { safetyFactor: 0.2,  targetStockDays: 60 },
  BZ: { safetyFactor: 0.3,  targetStockDays: 90 },
  CX: { safetyFactor: 0.1,  targetStockDays: 60 },
  CY: { safetyFactor: 0.15, targetStockDays: 90 },
  CZ: { safetyFactor: 0.25, targetStockDays: 120 },
  UNCLASSIFIED: { safetyFactor: 0.2, targetStockDays: 180 },
};

/** Order-frequency bucket → minimum targetStockDays. Combined with the
 *  ABC/XYZ matrix by taking the HIGHER of the two days values. A bucket of
 *  `days: null` (0 orders/12mo) excludes the item from auto-order entirely. */
export const TARGET_STOCK_DAYS_BY_ORDER_FREQUENCY: ReadonlyArray<{
  readonly minOrders: number;
  readonly days: number | null;
}> = [
  { minOrders: 12, days: 15 },
  { minOrders: 4,  days: 30 },
  { minOrders: 2,  days: 60 },
  { minOrders: 1,  days: 120 },
  { minOrders: 0,  days: null },
];

/** Resolves an item's target-stock-days from the order-frequency bucket. */
export function targetStockDaysForOrderFrequency(ordersLast12Months: number): number | null {
  for (const bucket of TARGET_STOCK_DAYS_BY_ORDER_FREQUENCY) {
    if (ordersLast12Months >= bucket.minOrders) return bucket.days;
  }
  return null;
}

// =====================
// Stock-level bands (spec §15)
// =====================

/** LOW band upper bound = reorderPoint × this multiplier. Above this and
 *  ≤ maxQuantity, the item is OPTIMAL. */
export const STOCK_LEVEL_LOW_MULTIPLIER = 1.2;

// =====================
// Trend adjustment (spec §13.2)
// =====================

/** Bounds on safetyFactor after trend adjustment. */
export const SAFETY_FACTOR_MIN = 0.1;
export const SAFETY_FACTOR_MAX = 0.4;

/** ±20% trend triggers a ±0.05 step on safetyFactor. */
export const TREND_ADJUSTMENT_THRESHOLD_PERCENT = 20;
export const TREND_ADJUSTMENT_DELTA = 0.05;

// =====================
// Dormancy (spec §16)
// =====================

/** Months without qualifying consumption before auto-deactivation kicks in.
 *  REGULAR-only — TOOL and PPE never auto-deactivate. */
export const DORMANT_ITEM_MONTHS_THRESHOLD = 4;

export const ITEM_SIMILARITY_THRESHOLD = 0.65;
export const MAX_SIMILAR_ITEMS_TO_CHECK = 5;

// =====================
// Bulk-adjustment distribution config (spec §2.2)
// =====================

/** Distribution is mandatory — 28% of all outbound volume is INVENTORY_COUNT;
 *  without distribution mc is dominated by count-day spikes. */
export const BALANCE_DISTRIBUTION_ENABLED = true;

/** Default distribution window when no prior INVENTORY_COUNT/MANUAL_ADJUSTMENT
 *  bracket exists for the item. */
export const BALANCE_DISTRIBUTION_DEFAULT_MONTHS = 6;

/** Outer bound when searching for the previous count event. */
export const BALANCE_PREVIOUS_COUNT_LOOKBACK_MONTHS = 24;
