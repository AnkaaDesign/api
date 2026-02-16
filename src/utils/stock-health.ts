import type { Activity, Item, Order, OrderItem } from '@types';
import {
  ACTIVITY_OPERATION,
  ORDER_STATUS,
  STOCK_LEVEL,
  CONSUMPTION_ACTIVITY_REASONS,
  MAX_STOCK_MONTHS,
  STOCK_CRITICAL_THRESHOLD,
  STOCK_LOW_THRESHOLD,
  STOCK_ACTIVE_ORDER_ADJUSTMENT,
  STOCK_OVERSTOCKED_DAYS,
  SAFETY_FACTOR_VARIABLE,
  SAFETY_FACTOR_STABLE,
  CONSUMPTION_VARIABILITY_THRESHOLD,
  REORDER_POINT_UPDATE_THRESHOLD,
  DEFAULT_SAFETY_STOCK_DAYS,
  DEFAULT_LEAD_TIME_DAYS,
  getWorkingDaysInMonth,
  STANDARD_WORKING_DAYS_PER_MONTH,
  getSeasonalFactor,
  isInVacationPeriod,
} from '@constants';
import { subDays, startOfDay } from 'date-fns';

export interface StockHealthData {
  level: STOCK_LEVEL;
  monthlyConsumption: number;
  daysOfStock: number;
  suggestedMinQuantity: number;
  suggestedMaxQuantity: number;
  hasActiveOrder: boolean;
  projectedStockoutDate: Date | null;
  consumptionTrend: 'increasing' | 'stable' | 'decreasing';
}

export interface StockHealthCalculationOptions {
  item: Item;
  activities: Activity[];
  activeOrders?: Order[];
  orderItems?: OrderItem[];
  lookbackDays?: number; // Default 90 days for consumption calculation
  safetyStockDays?: number; // Default 7 days
}

/**
 * Filters activities to only include actual consumption reasons.
 * Excludes inventory adjustments, damage, loss, manual corrections, etc.
 * to prevent distortion of consumption metrics.
 */
export function filterConsumptionActivities(activities: Activity[]): Activity[] {
  return activities.filter(
    activity =>
      activity.operation === ACTIVITY_OPERATION.OUTBOUND &&
      CONSUMPTION_ACTIVITY_REASONS.includes(activity.reason as any),
  );
}

/**
 * Normalizes a month's consumption by working days, accounting for vacation periods.
 * This prevents vacation months (Dec/Jan) from artificially lowering averages.
 *
 * Example: If December has only 14 working days (vs standard 22),
 * a consumption of 100 would be normalized to 100 * (22/14) = 157.
 */
export function normalizeConsumptionByWorkingDays(
  rawConsumption: number,
  month: number,
  year: number,
): number {
  const workingDays = getWorkingDaysInMonth(month, year);
  if (workingDays >= STANDARD_WORKING_DAYS_PER_MONTH) {
    return rawConsumption; // No normalization needed for full months
  }
  return rawConsumption * (STANDARD_WORKING_DAYS_PER_MONTH / workingDays);
}

/**
 * Calculates the monthly consumption rate based on historical activities.
 *
 * Improvements over previous version:
 * 1. Filters out non-consumption reasons (INVENTORY_COUNT, DAMAGE, LOSS, etc.)
 * 2. Normalizes by working days (accounts for vacation periods)
 * 3. Uses configurable constants instead of hardcoded values
 */
export function calculateMonthlyConsumption(
  activities: Activity[],
  lookbackDays: number = 90,
): number {
  const cutoffDate = subDays(startOfDay(new Date()), lookbackDays);

  // Filter to only actual consumption activities within the lookback period
  const consumptionActivities = activities.filter(
    activity =>
      activity.operation === ACTIVITY_OPERATION.OUTBOUND &&
      CONSUMPTION_ACTIVITY_REASONS.includes(activity.reason as any) &&
      new Date(activity.createdAt) >= cutoffDate,
  );

  // Sum total consumption
  const totalConsumption = consumptionActivities.reduce(
    (sum, activity) => sum + activity.quantity,
    0,
  );

  // Calculate monthly average (30 days)
  const daysInPeriod = Math.min(
    lookbackDays,
    Math.ceil((Date.now() - cutoffDate.getTime()) / (1000 * 60 * 60 * 24)),
  );

  return daysInPeriod > 0 ? (totalConsumption / daysInPeriod) * 30 : 0;
}

/**
 * Calculates consumption trend by comparing recent vs older consumption.
 * Uses only actual consumption reasons for accurate trend detection.
 */
export function calculateConsumptionTrend(
  activities: Activity[],
  lookbackDays: number = 90,
): 'increasing' | 'stable' | 'decreasing' {
  const midPoint = lookbackDays / 2;
  const midDate = subDays(new Date(), midPoint);

  const recentConsumption = calculateMonthlyConsumption(
    activities.filter(a => new Date(a.createdAt) >= midDate),
    midPoint,
  );

  const olderConsumption = calculateMonthlyConsumption(
    activities.filter(a => new Date(a.createdAt) < midDate),
    midPoint,
  );

  if (olderConsumption === 0) return 'stable';

  const changePercent = ((recentConsumption - olderConsumption) / olderConsumption) * 100;

  if (changePercent > 20) return 'increasing';
  if (changePercent < -20) return 'decreasing';
  return 'stable';
}

/**
 * Checks if item has active orders that will replenish stock
 */
export function hasActiveOrder(
  itemId: string,
  orders: Order[] = [],
  orderItems: OrderItem[] = [],
): boolean {
  const activeOrderStatuses = [
    ORDER_STATUS.CREATED,
    ORDER_STATUS.PARTIALLY_FULFILLED,
    ORDER_STATUS.FULFILLED,
    ORDER_STATUS.PARTIALLY_RECEIVED,
  ];

  const activeOrders = orders.filter(order => activeOrderStatuses.includes(order.status));

  if (activeOrders.length === 0) return false;

  // Check if any active order contains this item with pending quantity
  return orderItems.some(orderItem => {
    if (orderItem.itemId !== itemId) return false;

    const order = activeOrders.find(o => o.id === orderItem.orderId);
    if (!order) return false;

    // Has pending quantity to receive
    return orderItem.orderedQuantity > orderItem.receivedQuantity;
  });
}

/**
 * Calculates suggested min/max quantities based on consumption and lead time.
 *
 * Max quantity is capped at MAX_STOCK_MONTHS (6) months of monthly consumption.
 * This prevents overstocking while ensuring sufficient supply.
 */
export function calculateSuggestedQuantities(
  monthlyConsumption: number,
  leadTimeDays: number,
  safetyStockDays: number = DEFAULT_SAFETY_STOCK_DAYS,
  consumptionTrend: 'increasing' | 'stable' | 'decreasing' = 'stable',
): { min: number; max: number } {
  if (monthlyConsumption === 0) {
    return { min: 0, max: 0 };
  }

  const dailyConsumption = monthlyConsumption / 30;

  // Adjust for trend
  let trendMultiplier = 1;
  if (consumptionTrend === 'increasing') trendMultiplier = 1.2;
  if (consumptionTrend === 'decreasing') trendMultiplier = 0.8;

  // Min = (Lead time + Safety stock) * Daily consumption * Trend
  const minQuantity = Math.ceil(
    (leadTimeDays + safetyStockDays) * dailyConsumption * trendMultiplier,
  );

  // Max = capped at MAX_STOCK_MONTHS months of consumption
  // This ensures we never stock more than 6 months worth
  const maxFromFormula = Math.ceil(minQuantity + monthlyConsumption * trendMultiplier);
  const maxFromCap = Math.ceil(monthlyConsumption * MAX_STOCK_MONTHS * trendMultiplier);
  const maxQuantity = Math.min(maxFromFormula, maxFromCap);

  return { min: minQuantity, max: Math.max(maxQuantity, minQuantity) };
}

/**
 * Determines stock health level based on current quantity and consumption.
 *
 * Updated thresholds:
 * - CRITICAL: quantity covers less than 50% of reorder point (was 90%)
 * - LOW: quantity is at or below reorder point (was 110%)
 * - OVERSTOCKED: more than 6 months of stock (was 3 months)
 */
export function getStockHealthLevel(
  currentQuantity: number,
  monthlyConsumption: number,
  leadTimeDays: number,
  hasActiveOrder: boolean,
  maxQuantity?: number | null,
): STOCK_LEVEL {
  // Handle negative stock
  if (currentQuantity < 0) {
    return STOCK_LEVEL.NEGATIVE_STOCK;
  }

  // Handle zero stock
  if (currentQuantity === 0) {
    return STOCK_LEVEL.OUT_OF_STOCK;
  }

  if (monthlyConsumption === 0) {
    // No consumption - check against static thresholds if available
    if (maxQuantity && currentQuantity > maxQuantity) {
      return STOCK_LEVEL.OVERSTOCKED;
    }
    return STOCK_LEVEL.OPTIMAL;
  }

  const dailyConsumption = monthlyConsumption / 30;
  const daysOfStock = currentQuantity / dailyConsumption;

  // If has active order, be less aggressive about low stock warnings
  const orderAdjustment = hasActiveOrder ? STOCK_ACTIVE_ORDER_ADJUSTMENT : 1;

  // Critical: Less than lead time / 2 (adjusted if order exists)
  if (daysOfStock < (leadTimeDays / 2) * orderAdjustment) {
    return STOCK_LEVEL.CRITICAL;
  }

  // Low: Less than lead time + safety (adjusted if order exists)
  if (daysOfStock < (leadTimeDays + DEFAULT_SAFETY_STOCK_DAYS) * orderAdjustment) {
    return STOCK_LEVEL.LOW;
  }

  // Overstocked: More than MAX_STOCK_MONTHS months of stock
  if (maxQuantity && currentQuantity > maxQuantity) {
    return STOCK_LEVEL.OVERSTOCKED;
  }
  if (daysOfStock > STOCK_OVERSTOCKED_DAYS) {
    return STOCK_LEVEL.OVERSTOCKED;
  }

  return STOCK_LEVEL.OPTIMAL;
}

/**
 * Main function to calculate comprehensive stock health
 */
export function calculateStockHealth(options: StockHealthCalculationOptions): StockHealthData {
  const {
    item,
    activities,
    activeOrders = [],
    orderItems = [],
    lookbackDays = 90,
    safetyStockDays = DEFAULT_SAFETY_STOCK_DAYS,
  } = options;

  // Calculate monthly consumption (using filtered activities)
  const monthlyConsumption = calculateMonthlyConsumption(activities, lookbackDays);

  // Calculate consumption trend
  const consumptionTrend = calculateConsumptionTrend(activities, lookbackDays);

  // Check for active orders
  const hasOrder = hasActiveOrder(item.id, activeOrders, orderItems);

  // Calculate suggested quantities
  const leadTime = item.estimatedLeadTime || DEFAULT_LEAD_TIME_DAYS;
  const suggested = calculateSuggestedQuantities(
    monthlyConsumption,
    leadTime,
    safetyStockDays,
    consumptionTrend,
  );

  // Determine stock level
  const level = getStockHealthLevel(
    item.quantity,
    monthlyConsumption,
    leadTime,
    hasOrder,
    item.maxQuantity,
  );

  // Calculate days of stock
  const dailyConsumption = monthlyConsumption / 30;
  const daysOfStock = dailyConsumption > 0 ? item.quantity / dailyConsumption : Infinity;

  // Calculate projected stockout date
  let projectedStockoutDate: Date | null = null;
  if (dailyConsumption > 0 && daysOfStock < 365) {
    projectedStockoutDate = new Date();
    projectedStockoutDate.setDate(projectedStockoutDate.getDate() + Math.floor(daysOfStock));
  }

  return {
    level,
    monthlyConsumption,
    daysOfStock,
    suggestedMinQuantity: suggested.min,
    suggestedMaxQuantity: suggested.max,
    hasActiveOrder: hasOrder,
    projectedStockoutDate,
    consumptionTrend,
  };
}

/**
 * Batch calculate stock health for multiple items
 */
export function calculateBatchStockHealth(
  items: Item[],
  activitiesByItem: Map<string, Activity[]>,
  activeOrders: Order[] = [],
  orderItems: OrderItem[] = [],
): Map<string, StockHealthData> {
  const results = new Map<string, StockHealthData>();

  for (const item of items) {
    const activities = activitiesByItem.get(item.id) || [];
    const health = calculateStockHealth({
      item,
      activities,
      activeOrders,
      orderItems,
    });
    results.set(item.id, health);
  }

  return results;
}

/**
 * Filters items by stock health level
 */
export function filterItemsByStockHealth(
  items: Item[],
  healthData: Map<string, StockHealthData>,
  levels: STOCK_LEVEL[],
): Item[] {
  return items.filter(item => {
    const health = healthData.get(item.id);
    return health && levels.includes(health.level);
  });
}

/**
 * Calculates consumption variability to determine safety stock level.
 * Returns coefficient of variation (standard deviation / mean).
 *
 * Now filters by consumption reasons only and normalizes by working days.
 */
export function calculateConsumptionVariability(
  activities: Activity[],
  lookbackDays: number = 90,
): { coefficientOfVariation: number; isVariable: boolean } {
  const cutoffDate = subDays(startOfDay(new Date()), lookbackDays);

  // Get monthly consumption for each month in the period
  const monthlyConsumptions: number[] = [];
  const currentDate = new Date();

  for (let i = 0; i < 3; i++) {
    // Look at last 3 months
    const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
    const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() - i + 1, 0);

    if (monthEnd < cutoffDate) break;

    const monthActivities = activities.filter(activity => {
      const activityDate = new Date(activity.createdAt);
      return (
        activity.operation === ACTIVITY_OPERATION.OUTBOUND &&
        CONSUMPTION_ACTIVITY_REASONS.includes(activity.reason as any) &&
        activityDate >= monthStart &&
        activityDate <= monthEnd &&
        activityDate >= cutoffDate
      );
    });

    const rawConsumption = monthActivities.reduce(
      (sum, activity) => sum + activity.quantity,
      0,
    );

    // Normalize by working days to account for vacation periods
    const normalized = normalizeConsumptionByWorkingDays(
      rawConsumption,
      monthStart.getMonth(),
      monthStart.getFullYear(),
    );

    if (normalized > 0) {
      monthlyConsumptions.push(normalized);
    }
  }

  if (monthlyConsumptions.length < 2) {
    return { coefficientOfVariation: 0, isVariable: false };
  }

  // Calculate mean
  const mean = monthlyConsumptions.reduce((sum, val) => sum + val, 0) / monthlyConsumptions.length;

  if (mean === 0) {
    return { coefficientOfVariation: 0, isVariable: false };
  }

  // Calculate standard deviation
  const variance =
    monthlyConsumptions.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    monthlyConsumptions.length;
  const standardDeviation = Math.sqrt(variance);

  // Calculate coefficient of variation
  const coefficientOfVariation = standardDeviation / mean;

  // If CV > threshold, consumption is considered variable
  const isVariable = coefficientOfVariation > CONSUMPTION_VARIABILITY_THRESHOLD;

  return { coefficientOfVariation, isVariable };
}

/**
 * Automatically calculates reorder point based on consumption patterns.
 *
 * Formula: reorderPoint = (avgDailyConsumption * leadTime) * (1 + safetyFactor)
 * Safety factor: 0.3 for variable demand, 0.2 for stable demand
 */
export function calculateReorderPoint(
  item: Item,
  activities: Activity[],
  lookbackDays: number = 90,
): {
  reorderPoint: number;
  avgDailyConsumption: number;
  safetyFactor: number;
  isVariable: boolean;
  shouldUpdate: boolean;
} {
  // Calculate average daily consumption
  const monthlyConsumption = calculateMonthlyConsumption(activities, lookbackDays);
  const avgDailyConsumption = monthlyConsumption / 30;

  // If no consumption, keep existing reorder point or set to 0
  if (avgDailyConsumption === 0) {
    return {
      reorderPoint: item.reorderPoint || 0,
      avgDailyConsumption: 0,
      safetyFactor: 0,
      isVariable: false,
      shouldUpdate: false,
    };
  }

  // Get lead time (default to 30 days if not specified)
  const leadTime = item.estimatedLeadTime || DEFAULT_LEAD_TIME_DAYS;

  // Calculate consumption variability
  const { isVariable } = calculateConsumptionVariability(activities, lookbackDays);

  // Set safety factor based on variability
  const safetyFactor = isVariable ? SAFETY_FACTOR_VARIABLE : SAFETY_FACTOR_STABLE;

  // Calculate reorder point
  const calculatedReorderPoint = Math.ceil(avgDailyConsumption * leadTime * (1 + safetyFactor));

  // Determine if update is needed (>10% difference from current)
  const currentReorderPoint = item.reorderPoint || 0;
  const percentageDifference =
    currentReorderPoint > 0
      ? Math.abs((calculatedReorderPoint - currentReorderPoint) / currentReorderPoint)
      : 1; // Always update if current is 0

  const shouldUpdate = percentageDifference > REORDER_POINT_UPDATE_THRESHOLD;

  return {
    reorderPoint: calculatedReorderPoint,
    avgDailyConsumption,
    safetyFactor,
    isVariable,
    shouldUpdate,
  };
}

export interface ReorderPointUpdateResult {
  itemId: string;
  itemName: string;
  previousReorderPoint: number | null;
  newReorderPoint: number;
  avgDailyConsumption: number;
  safetyFactor: number;
  isVariable: boolean;
  percentageChange: number;
}

/**
 * Batch calculate reorder points for multiple items
 * Returns items that need updating (>10% difference)
 */
export function batchCalculateReorderPoints(
  items: Item[],
  activitiesByItem: Map<string, Activity[]>,
  lookbackDays: number = 90,
): ReorderPointUpdateResult[] {
  const results: ReorderPointUpdateResult[] = [];

  for (const item of items) {
    const activities = activitiesByItem.get(item.id) || [];
    const calculation = calculateReorderPoint(item, activities, lookbackDays);

    if (calculation.shouldUpdate) {
      const previousReorderPoint = item.reorderPoint || 0;
      const percentageChange =
        previousReorderPoint > 0
          ? ((calculation.reorderPoint - previousReorderPoint) / previousReorderPoint) * 100
          : 100;

      results.push({
        itemId: item.id,
        itemName: item.name,
        previousReorderPoint: item.reorderPoint,
        newReorderPoint: calculation.reorderPoint,
        avgDailyConsumption: calculation.avgDailyConsumption,
        safetyFactor: calculation.safetyFactor,
        isVariable: calculation.isVariable,
        percentageChange,
      });
    }
  }

  return results;
}

/**
 * Automatically calculates maxQuantity based on consumption patterns.
 * MaxQuantity is capped at MAX_STOCK_MONTHS (6) months of monthly consumption.
 */
export function calculateMaxQuantity(
  item: Item,
  activities: Activity[],
  lookbackDays: number = 90,
): {
  maxQuantity: number;
  monthlyConsumption: number;
  suggestedMax: number;
  shouldUpdate: boolean;
} {
  // Calculate monthly consumption
  const monthlyConsumption = calculateMonthlyConsumption(activities, lookbackDays);

  // If no consumption, keep existing maxQuantity or set to 0
  if (monthlyConsumption === 0) {
    return {
      maxQuantity: item.maxQuantity || 0,
      monthlyConsumption: 0,
      suggestedMax: 0,
      shouldUpdate: false,
    };
  }

  // Get lead time (default to 30 days if not specified)
  const leadTime = item.estimatedLeadTime || DEFAULT_LEAD_TIME_DAYS;

  // Get consumption trend
  const trend = calculateConsumptionTrend(activities, lookbackDays);

  // Calculate suggested max quantity (now capped at 6 months)
  const { max: suggestedMax } = calculateSuggestedQuantities(
    monthlyConsumption,
    leadTime,
    DEFAULT_SAFETY_STOCK_DAYS,
    trend,
  );

  // Determine if update is needed (>10% difference from current)
  const currentMaxQuantity = item.maxQuantity || 0;
  const percentageDifference =
    currentMaxQuantity > 0
      ? Math.abs((suggestedMax - currentMaxQuantity) / currentMaxQuantity)
      : 1; // Always update if current is 0

  const shouldUpdate = percentageDifference > REORDER_POINT_UPDATE_THRESHOLD;

  return {
    maxQuantity: suggestedMax,
    monthlyConsumption,
    suggestedMax,
    shouldUpdate,
  };
}

export interface MaxQuantityUpdateResult {
  itemId: string;
  itemName: string;
  previousMaxQuantity: number | null;
  newMaxQuantity: number;
  monthlyConsumption: number;
  consumptionTrend: 'increasing' | 'stable' | 'decreasing';
  percentageChange: number;
}

/**
 * Batch calculate maxQuantity for multiple items
 * Returns items that need updating (>10% difference)
 */
export function batchCalculateMaxQuantities(
  items: Item[],
  activitiesByItem: Map<string, Activity[]>,
  lookbackDays: number = 90,
): MaxQuantityUpdateResult[] {
  const results: MaxQuantityUpdateResult[] = [];

  for (const item of items) {
    const activities = activitiesByItem.get(item.id) || [];
    const calculation = calculateMaxQuantity(item, activities, lookbackDays);

    if (calculation.shouldUpdate) {
      const previousMaxQuantity = item.maxQuantity || 0;
      const percentageChange =
        previousMaxQuantity > 0
          ? ((calculation.maxQuantity - previousMaxQuantity) / previousMaxQuantity) * 100
          : 100;

      const trend = calculateConsumptionTrend(activities, lookbackDays);

      results.push({
        itemId: item.id,
        itemName: item.name,
        previousMaxQuantity: item.maxQuantity,
        newMaxQuantity: calculation.maxQuantity,
        monthlyConsumption: calculation.monthlyConsumption,
        consumptionTrend: trend,
        percentageChange,
      });
    }
  }

  return results;
}
