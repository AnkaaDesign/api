// Inventory calculation constants — calibrated from the 2026-05-15 16-agent
// research consolidation (see /tmp/stock-refactor-findings.md, algorithm-spec.md).
// Helpers split across:
//   - working-days-config.ts (vacation + workdays)
//   - seasonality-config.ts  (decay, curve, corpus)
//   - ppe-config.ts          (PPE intervals, headcount, blend)

import { ABC_CATEGORY, ACTIVITY_REASON, ITEM_CATEGORY_TYPE } from './enums';

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

/** LOW-DATA variant of the matrix — used by safety-stock Layer 2 (items with
 *  3–5 months of history, before statistical safety stock can be trusted).
 *  Values are systematically bumped above ABC_XYZ_MATRIX to compensate for
 *  the unmeasured variability. Once an item has ≥STATISTICAL_LAYER_MIN_MONTHS
 *  of history, the statistical formula (z × σ × √LT) takes over and these
 *  values are no longer consulted. */
export const ABC_XYZ_MATRIX_LOWDATA: Record<AbcXyzKey, SafetyTargetCell> = {
  AX: { safetyFactor: 0.30, targetStockDays: 30 },
  AY: { safetyFactor: 0.40, targetStockDays: 45 },
  AZ: { safetyFactor: 0.55, targetStockDays: 60 },
  BX: { safetyFactor: 0.22, targetStockDays: 45 },
  BY: { safetyFactor: 0.32, targetStockDays: 60 },
  BZ: { safetyFactor: 0.45, targetStockDays: 90 },
  CX: { safetyFactor: 0.18, targetStockDays: 60 },
  CY: { safetyFactor: 0.25, targetStockDays: 90 },
  CZ: { safetyFactor: 0.38, targetStockDays: 120 },
  UNCLASSIFIED: { safetyFactor: 0.30, targetStockDays: 180 },
};

/** Layer-3 (UNCLASSIFIED) fallback when the item has no ABC or XYZ at all. */
export const UNCLASSIFIED_LOWDATA: SafetyTargetCell =
  ABC_XYZ_MATRIX_LOWDATA.UNCLASSIFIED;

/** Service-level z-scores by ABC class for the statistical safety-stock
 *  formula (Layer 1). Higher z = higher service level = more safety. */
export const Z_BY_ABC: Record<ABC_CATEGORY | 'DEFAULT', number> = {
  A: 1.96, // 97.5% service level — A items are high-value, stockout is costly
  B: 1.645, // 95%
  C: 1.28, // 90%
  DEFAULT: 1.645,
};

/** Service-level multiplier applied to the LOW-DATA matrix safety factor
 *  (Layer 2 only). Mirrors the role of Z_BY_ABC for the statistical layer:
 *  A-class items get more safety, C-class less. Without this, A and C in
 *  the same XYZ bucket get the same matrix factor, which under-protects A. */
export const SERVICE_LEVEL_MULTIPLIER_BY_ABC: Record<ABC_CATEGORY | 'DEFAULT', number> = {
  A: 1.30,
  B: 1.10,
  C: 0.95,
  DEFAULT: 1.0,
};

/** Lead-time uncertainty buffer expressed in days of average daily demand.
 *  Added on top of every layer's safety stock. Closes the gap left by σ_LT
 *  being unmeasurable until `fulfilledAt` data is cleaned (see deep-migration
 *  notes). Per ABC: A-class items shoulder more delay-risk cost than C. */
export const LEAD_TIME_BUFFER_DAYS_BY_ABC: Record<ABC_CATEGORY | 'DEFAULT', number> = {
  A: 5,
  B: 3,
  C: 1,
  DEFAULT: 2,
};

/** Cap on the LT-buffer portion of safety stock, as a fraction of cycleStock.
 *  Prevents pathological inflation on items with very short lead times where
 *  `LEAD_TIME_BUFFER_DAYS` could otherwise dwarf the actual cycle. */
export const LEAD_TIME_BUFFER_CYCLE_CAP = 0.4;

/** Minimum non-zero months of history required before the statistical layer
 *  (z × σ × √LT) is trusted. Below this, the low-data matrix is used. */
export const STATISTICAL_LAYER_MIN_MONTHS = 6;

/** Global conservative uplift applied to every computed reorderPoint. Set
 *  while the inventory data still contains historical contamination (un-
 *  distributed INVENTORY_COUNT spikes, item-doubling workarounds, NULL
 *  supplierId orders, etc.). Multiply applied at the *end* of
 *  `calculateReorderPoint` so all three authoritative write paths
 *  (item-recompute, inventory-cron, auto-order) inherit it. Set to 1.0 to
 *  remove the uplift entirely once data quality is verified clean. */
export const CONSERVATIVE_RP_UPLIFT = 1.10;

/** Order-frequency bucket → minimum targetStockDays. Combined with the
 *  ABC/XYZ matrix by taking the HIGHER of the two days values. A bucket of
 *  `days: null` (0 orders/12mo) excludes the item from auto-order entirely.
 *  Slower-moving items need LONGER cover (fewer orders means each order
 *  must last longer) — see spec §6: ≥12/yr=45d, ~6/yr=60d, 3-4/yr=90-120d,
 *  1-2/yr=180d. The ABC/XYZ adjustment further boosts/trims this. */
export const TARGET_STOCK_DAYS_BY_ORDER_FREQUENCY: ReadonlyArray<{
  readonly minOrders: number;
  readonly days: number | null;
}> = [
  { minOrders: 12, days: 45 },
  { minOrders: 6,  days: 60 },
  { minOrders: 4,  days: 90 },
  { minOrders: 2,  days: 120 },
  { minOrders: 1,  days: 180 },
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
// Tool replenishment (target-based, not consumption-based)
// =====================

/** Target on-hand quantity for tool-type items. Tools don't use the
 *  consumption-driven rp/max model — they hold a fixed minimum on the shelf.
 *  A tool is recommended for reorder when its quantity drops BELOW the target,
 *  and the recommended quantity restores it back up to the target:
 *    REGULAR tool (TOOL)            → keep 2 (reorder when qty < 2, i.e. ≤ 1)
 *    ELECTRONIC tool (ELECTRONIC_TOOL) → keep 1 (reorder when qty < 1, i.e. ≤ 0)
 *  PPE is intentionally absent here — PPE is excluded from the auto-order
 *  workflow for now. */
export const TOOL_TARGET_MIN: Readonly<Record<string, number>> = {
  [ITEM_CATEGORY_TYPE.TOOL]: 2,
  [ITEM_CATEGORY_TYPE.ELECTRONIC_TOOL]: 1,
};

/** True for any tool-type category (regular or electronic). Use this instead
 *  of `=== TOOL` so electronic tools route through the same tool logic. */
export function isToolType(type: ITEM_CATEGORY_TYPE | string | null | undefined): boolean {
  return type === ITEM_CATEGORY_TYPE.TOOL || type === ITEM_CATEGORY_TYPE.ELECTRONIC_TOOL;
}

/** Target on-hand quantity for a tool-type item; 0 for non-tool categories. */
export function getToolTarget(type: ITEM_CATEGORY_TYPE | string | null | undefined): number {
  if (type == null) return 0;
  return TOOL_TARGET_MIN[type as string] ?? 0;
}

// =====================
// Trend adjustment (spec §13.2)
// =====================

/** Bounds on safetyFactor after trend adjustment. Raised MAX so the bumped
 *  LOW_DATA matrix can shift up via trend without clipping. */
export const SAFETY_FACTOR_MIN = 0.1;
export const SAFETY_FACTOR_MAX = 0.6;

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

