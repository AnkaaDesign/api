import { ACTIVITY_REASON } from './enums';

// =====================
// Consumption Calculation
// =====================

/**
 * Activity reasons that represent actual consumption (production usage).
 * Only these reasons count toward monthly consumption calculations.
 * Excludes: inventory adjustments, damage, loss, manual corrections, etc.
 */
export const CONSUMPTION_ACTIVITY_REASONS: ACTIVITY_REASON[] = [
  ACTIVITY_REASON.PRODUCTION_USAGE,
  ACTIVITY_REASON.PPE_DELIVERY,
  ACTIVITY_REASON.MAINTENANCE,
  ACTIVITY_REASON.PAINT_PRODUCTION,
  ACTIVITY_REASON.EXTERNAL_WITHDRAWAL,
];

/**
 * Activity reasons that represent non-consumption stock adjustments.
 * These are excluded from monthly consumption calculations to avoid distortion.
 */
export const NON_CONSUMPTION_ACTIVITY_REASONS: ACTIVITY_REASON[] = [
  ACTIVITY_REASON.INVENTORY_COUNT,
  ACTIVITY_REASON.MANUAL_ADJUSTMENT,
  ACTIVITY_REASON.DAMAGE,
  ACTIVITY_REASON.LOSS,
  ACTIVITY_REASON.OTHER,
  ACTIVITY_REASON.BORROW,
  ACTIVITY_REASON.RETURN,
  ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN,
  ACTIVITY_REASON.ORDER_RECEIVED,
];

// =====================
// Consumption Lookback & Weighting
// =====================

/** Number of months to look back for consumption calculation */
export const CONSUMPTION_LOOKBACK_MONTHS = 12;

/** Exponential decay half-life in months (weight halves every N months) */
export const CONSUMPTION_DECAY_HALF_LIFE_MONTHS = 3;

/** Minimum percentage change to trigger a consumption update */
export const CONSUMPTION_UPDATE_THRESHOLD = 0.01;

/** Minimum number of activities required before updating min/max quantities */
export const MIN_ACTIVITIES_FOR_MIN_MAX_UPDATE = 5;

// =====================
// Stock Level Thresholds
// =====================

/** Maximum stock = N months of monthly consumption (automatic calculation) */
export const MAX_STOCK_MONTHS = 6;

/** Critical threshold: quantity at or below this % of reorderPoint */
export const STOCK_CRITICAL_THRESHOLD = 0.5;

/** Low threshold: quantity at or below this % of reorderPoint */
export const STOCK_LOW_THRESHOLD = 1.0;

/** Adjustment factor when an active order exists (reduces urgency) */
export const STOCK_ACTIVE_ORDER_ADJUSTMENT = 1.5;

/** Overstocked threshold in days of stock (for consumption-based level) */
export const STOCK_OVERSTOCKED_DAYS = 180;

// =====================
// Reorder Point
// =====================

/** Safety factor for items with variable consumption (high CV) */
export const SAFETY_FACTOR_VARIABLE = 0.3;

/** Safety factor for items with stable consumption (low CV) */
export const SAFETY_FACTOR_STABLE = 0.2;

/** Coefficient of variation threshold to classify consumption as variable */
export const CONSUMPTION_VARIABILITY_THRESHOLD = 0.3;

/** Minimum percentage change to trigger a reorder point update */
export const REORDER_POINT_UPDATE_THRESHOLD = 0.1;

/** Default safety stock days */
export const DEFAULT_SAFETY_STOCK_DAYS = 7;

/** Default lead time in days when not configured */
export const DEFAULT_LEAD_TIME_DAYS = 30;

// =====================
// Lead Time
// =====================

/** Number of months to look back for lead time calculation */
export const LEAD_TIME_LOOKBACK_MONTHS = 6;

/** Minimum lead time in days (sanity check) */
export const LEAD_TIME_MIN_DAYS = 1;

/** Maximum lead time in days (sanity check) */
export const LEAD_TIME_MAX_DAYS = 365;

/** Minimum % change or days difference to trigger lead time update */
export const LEAD_TIME_UPDATE_PERCENT_THRESHOLD = 0.1;
export const LEAD_TIME_UPDATE_DAYS_THRESHOLD = 3;

// =====================
// Vacation / Business Calendar
// =====================

/**
 * Collective vacation period definition.
 * During this period, consumption is artificially low and should be normalized.
 * Format: { startMonth, startDay, endMonth, endDay } (months are 0-indexed: 0=Jan, 11=Dec)
 */
export const COLLECTIVE_VACATION_PERIOD = {
  startMonth: 11, // December
  startDay: 20,
  endMonth: 0,    // January
  endDay: 10,
};

/**
 * Returns the number of vacation days for a given month (0-indexed).
 * Used to normalize monthly consumption by working days.
 */
export function getVacationDaysInMonth(month: number, year: number): number {
  const { startMonth, startDay, endMonth, endDay } = COLLECTIVE_VACATION_PERIOD;

  // December
  if (month === startMonth) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return daysInMonth - startDay + 1; // Dec 20-31 = 12 days
  }

  // January
  if (month === endMonth) {
    return endDay; // Jan 1-10 = 10 days
  }

  return 0;
}

/**
 * Returns the effective working days in a given month, excluding vacation days.
 * Assumes ~22 working days per month (excludes weekends).
 */
export function getWorkingDaysInMonth(month: number, year: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const vacationDays = getVacationDaysInMonth(month, year);

  // Approximate working days (exclude weekends: ~71.4% of days are weekdays)
  const workingDays = Math.round((daysInMonth - vacationDays) * 0.714);
  return Math.max(workingDays, 1); // At least 1 to avoid division by zero
}

/**
 * Standard working days per month (no vacation, no holidays).
 * Used as the baseline for normalization.
 */
export const STANDARD_WORKING_DAYS_PER_MONTH = 22;

/**
 * Checks if a date falls within the collective vacation period.
 */
export function isInVacationPeriod(date: Date): boolean {
  const month = date.getMonth();
  const day = date.getDate();

  const { startMonth, startDay, endMonth, endDay } = COLLECTIVE_VACATION_PERIOD;

  if (month === startMonth && day >= startDay) return true;
  if (month === endMonth && day <= endDay) return true;

  return false;
}

// =====================
// Seasonal Adjustment Factors
// =====================

/**
 * Monthly seasonal adjustment factors based on typical industrial patterns in Brazil.
 * Values > 1.0 = higher-than-average demand period.
 * Values < 1.0 = lower-than-average demand period.
 *
 * These are DEFAULT factors. The system should calculate actual factors
 * from historical data when available (see ConsumptionSnapshot service).
 *
 * Index 0 = January, 11 = December
 */
export const DEFAULT_SEASONAL_FACTORS: number[] = [
  0.70, // January   - Vacation recovery, slow ramp-up
  0.85, // February  - Carnival, still ramping up
  0.95, // March     - Normal operations begin
  1.00, // April     - Normal
  1.00, // May       - Normal
  1.00, // June      - Normal
  1.00, // July      - Normal (mid-year)
  1.05, // August    - Slight increase
  1.10, // September - Increasing demand
  1.15, // October   - High demand period
  1.15, // November  - High demand period (pre-holiday production)
  0.75, // December  - Collective vacation starts, winding down
];

/**
 * Returns the seasonal adjustment factor for a given month.
 * If custom factors are provided (from historical data), uses those instead.
 */
export function getSeasonalFactor(
  month: number,
  customFactors?: number[] | null,
): number {
  const factors = customFactors && customFactors.length === 12
    ? customFactors
    : DEFAULT_SEASONAL_FACTORS;
  return factors[month] ?? 1.0;
}

// =====================
// Auto-Disable / Dormant Item Detection
// =====================

/** Number of months with no consumption before an item is flagged as dormant */
export const DORMANT_ITEM_MONTHS_THRESHOLD = 4;

/** Minimum similarity score (0-1) for fuzzy name matching to suggest replacement */
export const ITEM_SIMILARITY_THRESHOLD = 0.65;

/** Maximum number of similar items to check per dormant item */
export const MAX_SIMILAR_ITEMS_TO_CHECK = 5;

// =====================
// Balance Distribution
// =====================

/**
 * When an INVENTORY_COUNT activity is created, the system should distribute
 * the adjustment across the months since the last balance for that item.
 * This prevents a single-month spike in consumption data.
 */
export const BALANCE_DISTRIBUTION_ENABLED = true;

/** Default number of months to distribute balance adjustments if no previous balance found */
export const BALANCE_DISTRIBUTION_DEFAULT_MONTHS = 6;

/** Maximum months to look back for the previous inventory count */
export const BALANCE_PREVIOUS_COUNT_LOOKBACK_MONTHS = 24;
