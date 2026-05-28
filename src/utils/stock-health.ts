// Stock-health calculation engine — single source of truth for every
// monthlyConsumption / leadTime / reorderPoint / maxQuantity / reorderQuantity
// formula in the system. Routes per Item.category.type AND ppeDeliveryMode:
//   REGULAR / NULL             → §2, §5, §10, §13
//   PPE (SCHEDULED / BOTH)     → §3, §11  (headcount formula)
//   PPE (ON_DEMAND)            → §2, §5   (same as REGULAR — consumption-driven)
//   TOOL                       → §4, §12
//
// Helpers are split into smaller pure modules:
//   working-days.ts                  — workday math
//   seasonality.ts                   — seasonal factor pipeline + decay weight
//   bulk-adjustment-distributor.ts   — INVENTORY_COUNT / MANUAL_ADJUSTMENT spread
//   ppe-formula.ts                   — PPE-pipeline math
//   abc-xyz.ts                       — classification (cron consumer)

import {
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
  ABC_CATEGORY,
  ITEM_CATEGORY_TYPE,
  ORDER_STATUS,
  PPE_DELIVERY_MODE,
  XYZ_CATEGORY,
} from '@/constants/enums';
import {
  ABC_XYZ_MATRIX,
  AbcXyzKey,
  CONSERVATIVE_RP_UPLIFT,
  CONSUMPTION_LOOKBACK_MONTHS,
  LEAD_TIME_LEGACY_BULK_RECEIVED_AT,
  CONSUMPTION_MIN_DISTINCT_MONTHS,
  DEFAULT_LEAD_TIME_DAYS,
  LEAD_TIME_MAX_DAYS,
  LEAD_TIME_MIN_DAYS,
  LEAD_TIME_TIER_MIN_CLEAN_RECEIPTS,
  REGULAR_CONSUMPTION_REASONS,
  SAFETY_FACTOR_MAX,
  SAFETY_FACTOR_MIN,
  SafetyTargetCell,
  TARGET_STOCK_DAYS_BY_ORDER_FREQUENCY,
  TREND_ADJUSTMENT_DELTA,
  TREND_ADJUSTMENT_THRESHOLD_PERCENT,
  getToolTarget,
  isToolType,
  targetStockDaysForOrderFrequency,
} from '@/constants/inventory-config';
import {
  distributeBulkAdjustments,
  type ActivityLike,
} from './bulk-adjustment-distributor';
import { calculatePpeReorderPoint, predictPpeMonthlyConsumption, type PpeItemLike } from './ppe-formula';
import {
  blendedFactorAcrossDays,
  decayWeight,
  resolveSeasonalFactor,
  type SeasonalCurve,
} from './seasonality';
import {
  detectSaturdayShifts,
  normalizeToWorkdays,
  workingDaysForMonth,
} from './working-days';
import { subMonths } from 'date-fns';

// ============================================================================
// Shared types
// ============================================================================

export interface ItemLike extends PpeItemLike {
  id: string;
  createdAt: Date | string;
  quantity: number;
  reorderPoint: number | null;
  maxQuantity: number | null;
  estimatedLeadTime: number | null;
  boxQuantity: number | null;
  monthlyConsumption?: number | null;
  category?: { type?: ITEM_CATEGORY_TYPE | null } | null;
  abcCategory?: ABC_CATEGORY | null;
  xyzCategory?: XYZ_CATEGORY | null;
}

export interface SeasonalContext {
  itemCurve?: SeasonalCurve | null;
  categoryCurve?: SeasonalCurve | null;
}

export type DataQualityFlag =
  | 'UNCATEGORIZED'
  | 'LOW_DATA'
  | 'NEVER_USED'
  | 'SUSPECT_PHANTOM_MC';

// ============================================================================
// monthlyConsumption
// ============================================================================

export interface MonthlyConsumptionInput {
  item: ItemLike;
  activities: ReadonlyArray<ActivityLike>;
  now?: Date;
  seasonalCtx?: SeasonalContext;
  /** PPE-only — see ppe-formula.ts. */
  ppe?: {
    matchingSizeUserCount?: number;
    totalSizedUserCount?: number;
    /** Sum of PPE_DELIVERY + PRODUCTION_USAGE OUTBOUND quantities, trailing 12mo. */
    histTrailing12mo?: number;
  };
  /** Optional sector-holiday predicate piped into workday counts. */
  holidaysFn?: (d: Date) => boolean;
}

export interface MonthlyConsumptionResult {
  monthlyConsumption: number;
  /** True when classification rules can't run (<3 distinct months). */
  lowData: boolean;
  flags: DataQualityFlag[];
}

/** Top-level router. Dispatches to the per-category pipeline (spec §1). */
export function calculateMonthlyConsumption(
  input: MonthlyConsumptionInput,
): MonthlyConsumptionResult {
  const type = input.item.category?.type ?? null;
  const flags: DataQualityFlag[] = type === null ? ['UNCATEGORIZED'] : [];

  // Tools (regular + electronic) are replenished by a fixed-minimum rule, not
  // by consumption — monthly consumption is always 0.
  if (isToolType(type)) {
    return { monthlyConsumption: 0, lowData: false, flags };
  }
  if (type === ITEM_CATEGORY_TYPE.PPE) {
    // ON_DEMAND PPE items are reactive consumables: stock health is driven
    // entirely by observed activity history — same pipeline as REGULAR items.
    // SCHEDULED and BOTH retain the headcount-based prediction formula because
    // their replenishment cadence is known in advance.
    if (input.item.ppeDeliveryMode !== PPE_DELIVERY_MODE.ON_DEMAND) {
      const { monthlyConsumption } = predictPpeMonthlyConsumption({
        item: input.item,
        matchingSizeUserCount: input.ppe?.matchingSizeUserCount,
        totalSizedUserCount: input.ppe?.totalSizedUserCount,
        histTrailing12mo: input.ppe?.histTrailing12mo,
      });
      return { monthlyConsumption, lowData: false, flags };
    }
    // ON_DEMAND falls through to the regular activity-based pipeline below.
  }

  return calculateMonthlyConsumptionRegular(input, flags);
}

function calculateMonthlyConsumptionRegular(
  input: MonthlyConsumptionInput,
  flags: DataQualityFlag[],
): MonthlyConsumptionResult {
  const now = input.now ?? new Date();
  const lookbackStart = subMonths(now, CONSUMPTION_LOOKBACK_MONTHS);
  const itemCreatedAt = new Date(input.item.createdAt);

  // Lifetime activity-count guard for phantom mc=quantity detection (spec §19).
  if (
    input.activities.length === 0 &&
    input.item.monthlyConsumption != null &&
    Number(input.item.monthlyConsumption) > 0 &&
    Number(input.item.monthlyConsumption) === input.item.quantity
  ) {
    return { monthlyConsumption: 0, lowData: true, flags: [...flags, 'SUSPECT_PHANTOM_MC'] };
  }

  // Distribute bulk adjustments across their windows, then clip to lookback.
  const distributed = distributeBulkAdjustments(input.activities, itemCreatedAt).filter(
    a => a.createdAt >= lookbackStart && a.createdAt <= now,
  );

  // Saturday-shift detection runs on the raw (non-distributed) activities so
  // synthetic per-day rows don't fake saturdays.
  const saturdayShifts = detectSaturdayShifts(
    input.activities.filter(
      a =>
        a.operation === ACTIVITY_OPERATION.OUTBOUND &&
        REGULAR_CONSUMPTION_REASONS.includes(a.reason as ACTIVITY_REASON),
    ),
    REGULAR_CONSUMPTION_REASONS,
  );

  // Bucket events by calendar month.
  const byMonth = new Map<string, { year: number; month: number; qty: number }>();
  for (const ev of distributed) {
    const y = ev.createdAt.getFullYear();
    const m = ev.createdAt.getMonth();
    const key = `${y}-${m}`;
    const entry = byMonth.get(key) ?? { year: y, month: m, qty: 0 };
    entry.qty += ev.quantity;
    byMonth.set(key, entry);
  }

  if (byMonth.size < CONSUMPTION_MIN_DISTINCT_MONTHS) {
    return {
      monthlyConsumption: 0,
      lowData: true,
      flags: byMonth.size === 0 ? [...flags, 'NEVER_USED'] : [...flags, 'LOW_DATA'],
    };
  }

  // Weighted average per spec §2.7.
  let num = 0;
  let den = 0;
  for (const { year, month, qty } of byMonth.values()) {
    const wd = workingDaysForMonth(year, month, saturdayShifts, input.holidaysFn);
    const monthDate = new Date(year, month, 1);
    const sf = resolveSeasonalFactor(monthDate, input.seasonalCtx);
    const monthsAgo = (now.getFullYear() - year) * 12 + (now.getMonth() - month);
    const w = decayWeight(Math.max(0, monthsAgo));
    const dailyDeseasonalized = qty / wd / (sf || 1);
    num += w * dailyDeseasonalized * 20; // re-project per spec §2.7
    den += w;
  }

  return {
    monthlyConsumption: round2(den > 0 ? num / den : 0),
    lowData: false,
    flags,
  };
}

// ============================================================================
// leadTime (spec §5)
// ============================================================================

export interface LeadTimeInput {
  /** Days between OrderItem.fulfilledAt (when the order was sent to the
   *  supplier) and OrderItem.receivedAt for this item's receipts that pass
   *  the cleanliness filter (spec §5.2). When fulfilledAt is NULL or after
   *  receivedAt, falls back to Order.createdAt — the responsibility of the
   *  caller. */
  itemCleanLeadTimes: ReadonlyArray<number>;
  /** Same metric across the item's primary supplier, all items. */
  supplierCleanLeadTimes?: ReadonlyArray<number>;
}

export function calculateLeadTime(input: LeadTimeInput): number {
  if (input.itemCleanLeadTimes.length >= LEAD_TIME_TIER_MIN_CLEAN_RECEIPTS) {
    return clampLeadTime(p90(input.itemCleanLeadTimes));
  }
  if (
    input.supplierCleanLeadTimes &&
    input.supplierCleanLeadTimes.length >= LEAD_TIME_TIER_MIN_CLEAN_RECEIPTS
  ) {
    return clampLeadTime(p90(input.supplierCleanLeadTimes));
  }
  return DEFAULT_LEAD_TIME_DAYS;
}

/** True iff the receipt should be EXCLUDED from lead-time stats. Mirrors
 *  spec §5.2. Callers should fold this into their initial filter. */
export function isLegacyBulkReceipt(_orderSupplierId: string | null, receivedAt: Date): boolean {
  // The 2026-01-16 cutover was a bulk-receipt event where many historical
  // orders were marked received on that single day. Any OrderItem with that
  // exact receivedAt is bulk-legacy regardless of whether supplierId was
  // populated retroactively (see migration Phase G).
  return receivedAt.toISOString().slice(0, 10) === LEAD_TIME_LEGACY_BULK_RECEIVED_AT;
}

// ============================================================================
// reorderPoint (spec §10, §11, §12) + maxQuantity (spec §13)
// ============================================================================

export interface ReorderPointInput {
  item: ItemLike;
  monthlyConsumption: number;
  leadTimeDays: number;
  /** Legacy fraction-of-cycle-stock multiplier. Used only when `safetyStock`
   *  is NOT provided (back-compat). Prefer `safetyStock` (units) from
   *  `calculateSafetyStock`. */
  safetyFactor: number;
  /** Pre-computed safety stock in UNITS (output of `calculateSafetyStock`).
   *  When provided, the formula is `cycleStock × seasonal + safetyStock`
   *  instead of the legacy `cycleStock × (1 + safetyFactor) × seasonal`. */
  safetyStock?: number;
  seasonalCtx?: SeasonalContext;
  now?: Date;
  /** PPE-only — see ppe-formula.ts. */
  ppe?: { matchingSizeUserCount?: number; totalSizedUserCount?: number };
}

export function calculateReorderPoint(input: ReorderPointInput): number {
  const type = input.item.category?.type ?? null;
  // Tools maintain a fixed target on-hand quantity. We persist the target as
  // both reorderPoint and maxQuantity so the shortfall-based reorderQuantity
  // (max − stock − incoming) naturally restores the target.
  if (isToolType(type)) return getToolTarget(type);
  if (type === ITEM_CATEGORY_TYPE.PPE &&
      input.item.ppeDeliveryMode !== PPE_DELIVERY_MODE.ON_DEMAND) {
    // SCHEDULED / BOTH / null — use delivery-mode-aware PPE reorder point.
    // ON_DEMAND falls through to the regular cycle-stock + safety-stock formula.
    return calculatePpeReorderPoint({
      item: input.item,
      monthlyConsumption: input.monthlyConsumption,
      leadTimeDays: input.leadTimeDays,
      matchingSizeUserCount: input.ppe?.matchingSizeUserCount,
      totalSizedUserCount: input.ppe?.totalSizedUserCount,
    });
  }
  if (input.monthlyConsumption === 0) return 0;

  const avgDaily = input.monthlyConsumption / 30;
  const now = input.now ?? new Date();
  const projectionStart = new Date(now);
  projectionStart.setDate(projectionStart.getDate() + input.leadTimeDays);
  const upcomingSeasonal = resolveSeasonalFactor(projectionStart, input.seasonalCtx);

  const cycleStock = avgDaily * input.leadTimeDays * upcomingSeasonal;
  // Prefer the unit-based safety stock when callers provide it (new layered
  // safety-stock formula). Fall back to the legacy fraction for compatibility.
  const safety =
    input.safetyStock != null
      ? input.safetyStock
      : avgDaily * input.leadTimeDays * input.safetyFactor;
  // Conservative uplift while historical data contamination is being cleaned.
  // Single line to flip when data quality is verified — set CONSERVATIVE_RP_UPLIFT = 1.0.
  const raw = (cycleStock + safety) * CONSERVATIVE_RP_UPLIFT;
  const rp = Math.ceil(raw);
  if (rp > 0 && rp < 1) return 1;
  return rp;
}

export interface MaxQuantityInput {
  item: ItemLike;
  monthlyConsumption: number;
  leadTimeDays: number;
  reorderPoint: number;
  targetStockDays: number;
  seasonalCtx?: SeasonalContext;
  now?: Date;
}

export function calculateMaxQuantity(input: MaxQuantityInput): number {
  const type = input.item.category?.type ?? null;
  // Tools top up to their fixed target (no consumption-based buffer).
  if (isToolType(type)) return getToolTarget(type);
  if (input.monthlyConsumption === 0) return 0;

  const avgDaily = input.monthlyConsumption / 30;
  const now = input.now ?? new Date();
  const projectionStart = new Date(now);
  projectionStart.setDate(projectionStart.getDate() + input.leadTimeDays);

  const seasonalAtTarget = blendedFactorAcrossDays(
    projectionStart,
    input.targetStockDays,
    input.seasonalCtx,
  );

  const stockHorizon = Math.ceil(avgDaily * input.targetStockDays * seasonalAtTarget);
  return input.reorderPoint + stockHorizon;
}

// ============================================================================
// reorderQuantity (spec §14)
// ============================================================================

export interface ReorderQuantityInput {
  currentStock: number;
  maxQuantity: number;
  incomingOrderedQuantity: number;
  boxQuantity: number | null;
  /** Optional order-rule constraints — applied AFTER box rounding. */
  orderRule?: {
    minOrderQuantity?: number | null;
    maxOrderQuantity?: number | null;
    orderMultiple?: number | null;
  } | null;
}

export function calculateReorderQuantity(input: ReorderQuantityInput): number {
  const shortfall = input.maxQuantity - input.currentStock - input.incomingOrderedQuantity;
  if (shortfall <= 0) return 0;

  const box = Math.max(1, input.boxQuantity ?? 1);
  let qty = Math.ceil(shortfall / box) * box;

  if (input.orderRule?.orderMultiple && input.orderRule.orderMultiple > 0) {
    const m = input.orderRule.orderMultiple;
    qty = Math.ceil(qty / m) * m;
  }
  if (input.orderRule?.minOrderQuantity != null) {
    qty = Math.max(qty, input.orderRule.minOrderQuantity);
  }
  if (input.orderRule?.maxOrderQuantity != null) {
    qty = Math.min(qty, input.orderRule.maxOrderQuantity);
  }
  return qty;
}

// ============================================================================
// Trend adjustment (spec §13.2)
// ============================================================================

/** Returns the signed percent change of last-3-months vs prior-3-months
 *  consumption averages. `monthlyHistory` is in chronological order with the
 *  most recent month last. Returns 0 when prior window has zero base. */
export function calculateConsumptionTrend(
  monthlyHistory: ReadonlyArray<{ year: number; month: number; consumption: number }>,
): number {
  if (monthlyHistory.length < 6) return 0;
  const tail = monthlyHistory.slice(-6);
  const prior = tail.slice(0, 3).reduce((s, m) => s + m.consumption, 0) / 3;
  const recent = tail.slice(3).reduce((s, m) => s + m.consumption, 0) / 3;
  if (prior === 0) return 0;
  return ((recent - prior) / prior) * 100;
}

/** ±5pp safety-factor step when |trend| > 20%, clamped to [0.10, 0.40]. */
export function applyTrendAdjustment(safetyFactor: number, trendPercent: number): number {
  let adjusted = safetyFactor;
  if (trendPercent > TREND_ADJUSTMENT_THRESHOLD_PERCENT) adjusted += TREND_ADJUSTMENT_DELTA;
  else if (trendPercent < -TREND_ADJUSTMENT_THRESHOLD_PERCENT) adjusted -= TREND_ADJUSTMENT_DELTA;
  return Math.min(SAFETY_FACTOR_MAX, Math.max(SAFETY_FACTOR_MIN, adjusted));
}

// ============================================================================
// ABC/XYZ + order-frequency matrix lookup (spec §9)
// ============================================================================

/** Resolves the calibrated `{ safetyFactor, targetStockDays }` cell for the
 *  given ABC/XYZ classification, then applies the order-frequency floor.
 *  Either category being null routes to the UNCLASSIFIED row. */
export function resolveSafetyTargetCell(
  abc: ABC_CATEGORY | null,
  xyz: XYZ_CATEGORY | null,
  ordersLast12Months: number | null,
): SafetyTargetCell {
  const key: AbcXyzKey = abc && xyz ? (`${abc}${xyz}` as AbcXyzKey) : 'UNCLASSIFIED';
  const cell = ABC_XYZ_MATRIX[key] ?? ABC_XYZ_MATRIX.UNCLASSIFIED;

  if (ordersLast12Months == null) return cell;
  const freqDays = targetStockDaysForOrderFrequency(ordersLast12Months);
  if (freqDays == null) return cell; // 0 orders → don't auto-order (caller handles)
  // Per spec §9 companion: combine by taking the HIGHER days value.
  return { safetyFactor: cell.safetyFactor, targetStockDays: Math.max(cell.targetStockDays, freqDays) };
}

export { TARGET_STOCK_DAYS_BY_ORDER_FREQUENCY };

// ============================================================================
// Active-order helper (used by stock-level + dashboard)
// ============================================================================

export interface OrderLike {
  id: string;
  status: ORDER_STATUS;
}
export interface OrderItemLike {
  itemId: string;
  orderId: string;
  orderedQuantity: number;
  receivedQuantity: number;
}

/** True iff the item has pending receipts on an order that is neither
 *  CANCELLED nor fully RECEIVED. */
export function hasActiveOrder(
  itemId: string,
  orders: ReadonlyArray<OrderLike>,
  orderItems: ReadonlyArray<OrderItemLike>,
): boolean {
  const activeIds = new Set(
    orders
      .filter(o => o.status !== ORDER_STATUS.CANCELLED && o.status !== ORDER_STATUS.RECEIVED)
      .map(o => o.id),
  );
  return orderItems.some(
    oi =>
      oi.itemId === itemId &&
      activeIds.has(oi.orderId) &&
      oi.orderedQuantity > oi.receivedQuantity,
  );
}

// ============================================================================
// Internals
// ============================================================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clampLeadTime(days: number): number {
  return Math.min(LEAD_TIME_MAX_DAYS, Math.max(LEAD_TIME_MIN_DAYS, Math.round(days)));
}

function p90(values: ReadonlyArray<number>): number {
  if (values.length === 0) return DEFAULT_LEAD_TIME_DAYS;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9));
  return sorted[idx];
}
