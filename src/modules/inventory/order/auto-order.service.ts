import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  ORDER_STATUS,
  ACTIVITY_OPERATION,
  ITEM_CATEGORY_TYPE,
  STOCK_LEVEL,
} from '@/constants/enums';
import {
  CONSUMPTION_LOOKBACK_MONTHS,
} from '@/constants/inventory-config';
import { PPE_DEFAULT_INTERVAL_MONTHS } from '@/constants/ppe-config';
import {
  calculateMonthlyConsumption,
  calculateLeadTime,
  calculateReorderPoint,
  calculateMaxQuantity,
  calculateReorderQuantity,
  calculateConsumptionTrend,
  applyTrendAdjustment,
  resolveSafetyTargetCell,
  hasActiveOrder as utilHasActiveOrder,
  isLegacyBulkReceipt,
  type ItemLike,
  type OrderItemLike,
  type OrderLike,
} from '@/utils/stock-health';
import { determineStockLevel } from '@/utils/stock-level';
import { balanceDepletionAcrossItems } from '@/utils/order-coverage';
import { subMonths, differenceInDays, addMonths } from 'date-fns';
import type { PrismaTransaction } from '@modules/common/base/base.repository';

interface DemandAnalysis {
  itemId: string;
  itemName: string;
  currentStock: number;
  monthlyConsumption: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  trendPercentage: number;
  daysUntilStockout: number;
  recommendedOrderQuantity: number;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  supplierId: string | null;
  supplierName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  lastOrderDate: Date | null;
  daysSinceLastOrder: number | null;
  hasActivePendingOrder: boolean;
  estimatedLeadTime: number;
  estimatedCost: number;
  reorderPoint: number | null;
  maxQuantity: number | null;
  isInSchedule: boolean;
  scheduleNextRun: Date | null;
  isEmergencyOverride: boolean;
}

interface AutoOrderRecommendation {
  supplierId: string | null;
  supplierName: string;
  items: DemandAnalysis[];
  totalValue: number;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  consolidatedReasons: string[];
}

/** Internal-only payload that we carry from `analyzeSingleItem` into the
 *  persistence pass so we don't recompute the same numbers twice. */
interface ComputedItemMetrics {
  itemId: string;
  monthlyConsumption: number;
  trendPercentage: number;
  reorderPoint: number;
  maxQuantity: number;
  reorderQuantity: number;
}

const MAX_DAYS_DISPLAY = 999;
const MIN_SUPPLIER_ORDERS_FOR_AUTO_ORDER = 3;
const PERSIST_BATCH_SIZE = 100;
const DUPLICATE_ORDER_GUARD_DAYS = 30;

/** Cadence-driven consolidation window bands (spec §10.2). Picks the window
 *  by observed orders/year for the supplier — not by name. */
const CONSOLIDATION_WINDOW_BANDS: ReadonlyArray<{
  readonly minOrdersPerYear: number;
  readonly windowDays: number;
}> = [
  { minOrdersPerYear: 12, windowDays: 7 },
  { minOrdersPerYear: 6, windowDays: 14 },
  { minOrdersPerYear: 4, windowDays: 30 },
  { minOrdersPerYear: 0, windowDays: 60 },
];

function consolidationWindowForOrdersPerYear(ordersPerYear: number): number {
  for (const band of CONSOLIDATION_WINDOW_BANDS) {
    if (ordersPerYear >= band.minOrdersPerYear) return band.windowDays;
  }
  return CONSOLIDATION_WINDOW_BANDS[CONSOLIDATION_WINDOW_BANDS.length - 1].windowDays;
}

@Injectable()
export class AutoOrderService {
  private readonly logger = new Logger(AutoOrderService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Analyze all items and generate smart auto-order recommendations.
   *
   * Wired into the post-Phase-3 utility layer:
   *   - mc, rp, max, reorderQty all flow through `stock-health.ts`.
   *   - Supplier suppliers with <3 orders/12mo are filtered out of recs.
   *   - Consolidation window is derived from supplier cadence
   *     (orders/12mo) — see `CONSOLIDATION_WINDOW_BANDS`.
   *   - PPE: pulled in only when next default-interval delivery window
   *     falls inside `leadTime + safetyDays`.
   *   - TOOL: only when `quantity === 0`; no rp/max compute.
   *   - Computed mc/trend/rp/max/reorderQty are persisted back to `Item`
   *     in batched transactions at the end of analysis.
   */
  async analyzeItemsForAutoOrder(userId?: string): Promise<AutoOrderRecommendation[]> {
    this.logger.log('Starting intelligent auto-order analysis with schedule coordination...');

    const now = new Date();

    // Resolve all active schedules so we can defer / emergency-override them.
    const activeSchedules = await this.prisma.orderSchedule.findMany({
      where: { isActive: true, finishedAt: null },
      select: { id: true, items: true, nextRun: true, frequency: true },
    });

    // Keep the EARLIEST nextRun across all schedules each item appears in
    // (an item may legitimately belong to multiple schedules). Defaulting to
    // the last-iterated overwrite would silently use the wrong cadence.
    const scheduledItems = new Map<string, { nextRun: Date | null; scheduleId: string }>();
    activeSchedules.forEach(schedule => {
      schedule.items.forEach(itemId => {
        const existing = scheduledItems.get(itemId);
        if (
          !existing ||
          (schedule.nextRun &&
            (!existing.nextRun || schedule.nextRun.getTime() < existing.nextRun.getTime()))
        ) {
          scheduledItems.set(itemId, {
            nextRun: schedule.nextRun,
            scheduleId: schedule.id,
          });
        }
      });
    });

    this.logger.log(`Found ${scheduledItems.size} items in active schedules`);

    // Suppliers with <3 orders/12mo are excluded from auto-order entirely.
    // The same query also feeds the cadence-driven consolidation window.
    const supplierOrdersPerYear = await this.loadSupplierOrdersPerYear(now);
    const eligibleSupplierIds = new Set<string>();
    for (const [supplierId, count] of supplierOrdersPerYear.entries()) {
      if (count >= MIN_SUPPLIER_ORDERS_FOR_AUTO_ORDER) eligibleSupplierIds.add(supplierId);
    }
    this.logger.log(`Eligible suppliers for auto-order: ${eligibleSupplierIds.size}`);

    // Pull every active item. The reorderPoint filter is intentionally
    // removed here: rp is computed below, not read from the row.
    const items = await this.prisma.item.findMany({
      where: { isActive: true },
      include: {
        supplier: true,
        category: true,
        prices: { orderBy: { createdAt: 'desc' }, take: 1 },
        activities: {
          where: {
            createdAt: { gte: subMonths(now, CONSUMPTION_LOOKBACK_MONTHS) },
            operation: ACTIVITY_OPERATION.OUTBOUND,
          },
          orderBy: { createdAt: 'desc' },
        },
        orderItems: {
          include: { order: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    this.logger.log(`Analyzing ${items.length} items...`);

    // Pre-load supplier-level clean lead-time samples for the tier-2 fallback.
    const supplierLeadTimes = await this.loadSupplierLeadTimeSamples(items, now);

    const analyses: DemandAnalysis[] = [];
    const persistQueue: ComputedItemMetrics[] = [];

    for (const item of items) {
      const scheduleInfo = scheduledItems.get(item.id);
      const result = this.analyzeSingleItem(
        item,
        scheduleInfo,
        supplierLeadTimes,
        eligibleSupplierIds,
        now,
      );

      if (result?.metrics) persistQueue.push(result.metrics);
      if (result?.analysis && result.analysis.recommendedOrderQuantity > 0) {
        analyses.push(result.analysis);
      }
    }

    // Persist the freshly-computed values back to Item rows. Best-effort —
    // a failed write doesn't kill the analysis result.
    try {
      await this.persistComputedMetrics(persistQueue);
    } catch (error) {
      this.logger.error('Failed to persist computed item metrics:', error);
    }

    // Group by supplier (already filtered for eligibility above).
    const groupedBySupplier = this.groupBySupplier(analyses);

    // Pull in consolidation candidates: same-supplier items that fall inside
    // the supplier's cadence-driven consolidation window.
    const enhancedRecommendations = await this.applySupplierConsolidation(
      groupedBySupplier,
      items,
      scheduledItems,
      supplierLeadTimes,
      supplierOrdersPerYear,
      now,
    );

    this.logger.log(
      `Generated ${enhancedRecommendations.length} auto-order recommendations`,
    );

    return enhancedRecommendations;
  }

  // ============================================================================
  // Per-item analysis
  // ============================================================================

  /** Computes mc/rp/max/reorderQty and decides whether to recommend. Returns
   *  the persistence payload regardless of recommendation outcome. */
  private analyzeSingleItem(
    item: any,
    scheduleInfo: { nextRun: Date | null; scheduleId: string } | undefined,
    supplierLeadTimes: Map<string, number[]>,
    eligibleSupplierIds: Set<string>,
    now: Date,
  ): { analysis: DemandAnalysis | null; metrics: ComputedItemMetrics | null } | null {
    const categoryType = (item.category?.type ?? null) as ITEM_CATEGORY_TYPE | null;
    const isTool = categoryType === ITEM_CATEGORY_TYPE.TOOL;
    const isPpe = categoryType === ITEM_CATEGORY_TYPE.PPE;

    const itemLike: ItemLike = {
      id: item.id,
      createdAt: item.createdAt,
      quantity: item.quantity,
      reorderPoint: item.reorderPoint,
      maxQuantity: item.maxQuantity,
      estimatedLeadTime: item.estimatedLeadTime,
      boxQuantity: item.boxQuantity,
      monthlyConsumption: item.monthlyConsumption != null ? Number(item.monthlyConsumption) : null,
      category: item.category ? { type: item.category.type } : null,
      abcCategory: item.abcCategory ?? null,
      xyzCategory: item.xyzCategory ?? null,
      ppeType: item.ppeType ?? null,
      ppeStandardQuantity: item.ppeStandardQuantity ?? null,
      ppeDeliveryMode: item.ppeDeliveryMode ?? null,
    };

    // mc — TOOL = 0, REGULAR/PPE via util layer.
    const mcResult = calculateMonthlyConsumption({
      item: itemLike,
      activities: item.activities,
      now,
    });
    const monthlyConsumption = mcResult.monthlyConsumption;

    // Lead time — clamped, with tier-1 (item) → tier-2 (supplier) → default fallback.
    const itemCleanLeadTimes = this.collectItemCleanLeadTimes(item);
    const supplierClean = item.supplierId ? supplierLeadTimes.get(item.supplierId) ?? [] : [];
    const leadTimeDays = calculateLeadTime({
      itemCleanLeadTimes,
      supplierCleanLeadTimes: supplierClean,
    });

    // Trend across the last 6 monthly buckets (working-day normalized happens
    // inside the util; here we just feed raw counts since `calculateConsumptionTrend`
    // does its own arithmetic).
    const monthlyHistory = this.bucketActivitiesByMonth(item.activities, now);
    const trendPercentage = isTool ? 0 : calculateConsumptionTrend(monthlyHistory);
    const trend: 'increasing' | 'stable' | 'decreasing' =
      trendPercentage > 20 ? 'increasing' : trendPercentage < -20 ? 'decreasing' : 'stable';

    // Safety factor + targetStockDays from ABC/XYZ matrix, with order-frequency floor.
    const ordersLast12Months = item.ordersLast12Months ?? null;
    const cell = resolveSafetyTargetCell(
      item.abcCategory ?? null,
      item.xyzCategory ?? null,
      ordersLast12Months,
    );
    const adjustedSafetyFactor = applyTrendAdjustment(cell.safetyFactor, trendPercentage);

    // rp / max — TOOL branch short-circuits inside the util (rp=0, max=item.quantity).
    const reorderPoint = calculateReorderPoint({
      item: itemLike,
      monthlyConsumption,
      leadTimeDays,
      safetyFactor: adjustedSafetyFactor,
      now,
    });
    const maxQuantity = calculateMaxQuantity({
      item: itemLike,
      monthlyConsumption,
      leadTimeDays,
      reorderPoint,
      targetStockDays: cell.targetStockDays,
      now,
    });

    // Incoming pending order quantity feeds reorder-qty shortfall.
    const incomingOrderedQuantity = this.sumIncomingOrderedQuantity(item.orderItems);
    const reorderQuantity = calculateReorderQuantity({
      currentStock: item.quantity,
      maxQuantity,
      incomingOrderedQuantity,
      boxQuantity: item.boxQuantity ?? 1,
    });

    const metrics: ComputedItemMetrics = {
      itemId: item.id,
      monthlyConsumption,
      trendPercentage,
      reorderPoint,
      maxQuantity,
      reorderQuantity,
    };

    // ---- Recommendation gates ----

    // Supplier eligibility filter (no supplier always allowed).
    if (item.supplierId && !eligibleSupplierIds.has(item.supplierId)) {
      return { analysis: null, metrics };
    }

    // TOOL carve-out — only recommend when truly out of stock.
    if (isTool) {
      if (item.quantity !== 0) return { analysis: null, metrics };
      const recOrderQty = item.boxQuantity ?? 1; // minimum unit
      const analysis = this.buildAnalysis(item, {
        currentStock: 0,
        monthlyConsumption: 0,
        trend,
        trendPercentage: 0,
        daysUntilStockout: 0,
        recommendedOrderQuantity: recOrderQty,
        urgency: 'critical',
        reason: 'Ferramenta esgotada — reposição imediata',
        scheduleInfo,
        estimatedLeadTime: leadTimeDays,
        reorderPoint: 0,
        maxQuantity: Math.max(item.quantity, 0),
        isEmergencyOverride: false,
      });
      return { analysis, metrics };
    }

    // mc=0 (LOW_DATA / phantom) → never recommend; nothing to project.
    if (monthlyConsumption <= 0) return { analysis: null, metrics };

    const dailyConsumption = monthlyConsumption / 30;
    const currentStock = item.quantity;
    const rawDaysUntilStockout =
      dailyConsumption > 0 ? Math.floor(currentStock / dailyConsumption) : MAX_DAYS_DISPLAY;
    const daysUntilStockout = Math.min(rawDaysUntilStockout, MAX_DAYS_DISPLAY);

    // Active pending order check (uses util — treats receipt-pending OrderItems
    // as still active). Surfaced for UI only — does NOT shift order thresholds
    // (spec §8: pending orders are a UI overlay, not a decision input).
    const orderRows: OrderLike[] = item.orderItems
      .map((oi: any) => oi.order)
      .filter((o: any) => o)
      .map((o: any) => ({ id: o.id, status: o.status as ORDER_STATUS }));
    const orderItemRows: OrderItemLike[] = item.orderItems.map((oi: any) => ({
      itemId: oi.itemId ?? item.id,
      orderId: oi.orderId,
      orderedQuantity: oi.orderedQuantity,
      receivedQuantity: oi.receivedQuantity ?? 0,
    }));
    const hasActivePendingOrder = utilHasActiveOrder(item.id, orderRows, orderItemRows);

    // Data-quality guard: reject impossible state where rp > max. These items
    // can produce nonsensical reorderQuantity (negative or zero shortfall);
    // skip with a debug log so they surface for manual review.
    if (reorderPoint > 0 && maxQuantity > 0 && reorderPoint > maxQuantity) {
      this.logger.debug(
        `Skipping ${item.name} (${item.id}): reorderPoint(${reorderPoint}) > maxQuantity(${maxQuantity}). Data-quality issue — investigate.`,
      );
      return { analysis: null, metrics };
    }

    // Canonical stock-level classification (spec §15). Open orders projected
    // to arrive feed the effective stock — so an in-flight order naturally
    // moves the band above CRITICAL and the recommendation is suppressed.
    const stockLevel = determineStockLevel({
      quantity: currentStock,
      reorderPoint,
      maxQuantity,
      hasActiveOrder: hasActivePendingOrder,
      incomingOrderedQuantity,
      categoryType,
    });
    const isCritical =
      stockLevel === STOCK_LEVEL.NEGATIVE_STOCK ||
      stockLevel === STOCK_LEVEL.OUT_OF_STOCK ||
      stockLevel === STOCK_LEVEL.CRITICAL;

    // Overstock guard: if the effective stock (current + arriving) already
    // covers reorderPoint, do not recommend a new order unless critical.
    // Prevents double-ordering when a fulfilled order is in transit.
    if (!isCritical && currentStock + incomingOrderedQuantity >= reorderPoint) {
      this.logger.debug(
        `Skipping ${item.name}: incoming(${incomingOrderedQuantity}) + stock(${currentStock}) covers rp(${reorderPoint}).`,
      );
      return { analysis: null, metrics };
    }

    // Duplicate-order guard: don't reorder within 30 days unless the item
    // is in a critical band. (Pending-order existence is intentionally NOT
    // a gate here — a late shipment must not block a fresh recommendation.)
    const lastOrderDate = item.orderItems[0]?.order?.createdAt ?? null;
    const daysSinceLastOrder = lastOrderDate ? differenceInDays(now, lastOrderDate) : null;
    if (
      daysSinceLastOrder !== null &&
      daysSinceLastOrder < DUPLICATE_ORDER_GUARD_DAYS &&
      !isCritical
    ) {
      this.logger.debug(`Skipping ${item.name}: ordered ${daysSinceLastOrder} days ago`);
      return { analysis: null, metrics };
    }

    // PPE consolidation: only include when next default-interval window
    // falls inside `leadTime + safetyDays` (safetyDays = targetStockDays * safetyFactor).
    if (isPpe) {
      const safetyDays = Math.ceil(cell.targetStockDays * adjustedSafetyFactor);
      const ppeWindowOk = this.isPpeWithinDeliveryWindow(item, now, leadTimeDays, safetyDays);
      if (!ppeWindowOk && currentStock > reorderPoint) {
        return { analysis: null, metrics };
      }
    }

    // Schedule coordination. If a scheduled order is going to cover this
    // item before its projected stockout, defer to the schedule. Otherwise
    // surface an emergency override.
    let isEmergencyOverride = false;
    if (scheduleInfo?.nextRun) {
      const daysUntilScheduledOrder = differenceInDays(scheduleInfo.nextRun, now);
      const daysUntilScheduledDelivery = daysUntilScheduledOrder + leadTimeDays;
      const willStockoutBeforeSchedule = daysUntilStockout < daysUntilScheduledDelivery;

      if (!willStockoutBeforeSchedule) {
        this.logger.debug(
          `Skipping ${item.name}: covered by schedule (next order in ${daysUntilScheduledOrder} days)`,
        );
        return { analysis: null, metrics };
      }
      if (currentStock > 0) {
        isEmergencyOverride = true;
        this.logger.warn(
          `EMERGENCY: ${item.name} will stockout in ${daysUntilStockout} days, scheduled order not until ${daysUntilScheduledOrder} days.`,
        );
      }
    }

    // Order-need decision — driven by the canonical stock-level band plus
    // a stockout-vs-lead-time projection. Pending-order existence is NOT
    // a threshold input (spec §8).
    const needsOrdering = this.determineOrderNeed(
      stockLevel,
      currentStock,
      reorderPoint,
      daysUntilStockout,
      leadTimeDays,
    );
    if (!needsOrdering.shouldOrder) return { analysis: null, metrics };

    // Final qty: prefer the util-computed reorderQuantity. If that landed at 0
    // (already covered by incoming), but the gate above said we still need to
    // order (stockout-imminent), fall back to a minimum-reach-rp qty.
    let recommendedOrderQuantity = reorderQuantity;
    if (recommendedOrderQuantity <= 0) {
      const box = Math.max(1, item.boxQuantity ?? 1);
      const fallback = Math.max(0, Math.ceil((reorderPoint - currentStock) / box) * box);
      recommendedOrderQuantity = fallback;
    }
    if (recommendedOrderQuantity <= 0) return { analysis: null, metrics };

    const urgency = this.urgencyFromStockLevel(stockLevel, daysUntilStockout, leadTimeDays);
    let finalReason = needsOrdering.reason;
    if (isEmergencyOverride && scheduleInfo?.nextRun) {
      const daysUntilScheduled = differenceInDays(scheduleInfo.nextRun, now);
      finalReason = `⚠️ EMERGÊNCIA: ${needsOrdering.reason} | Próximo pedido agendado em ${daysUntilScheduled} dias (muito tarde)`;
    }

    const currentPrice = item.prices?.[0]?.value ?? 0;
    const analysis = this.buildAnalysis(item, {
      currentStock,
      monthlyConsumption,
      trend,
      trendPercentage,
      daysUntilStockout,
      recommendedOrderQuantity,
      urgency: isEmergencyOverride ? 'critical' : urgency,
      reason: finalReason,
      scheduleInfo,
      estimatedLeadTime: leadTimeDays,
      reorderPoint,
      maxQuantity,
      isEmergencyOverride,
      hasActivePendingOrder,
      lastOrderDate,
      daysSinceLastOrder,
      estimatedCost: currentPrice * recommendedOrderQuantity,
    });

    return { analysis, metrics };
  }

  /** Lightweight constructor for the response DTO. Keeps the shape stable
   *  across TOOL / REGULAR / PPE branches. */
  private buildAnalysis(
    item: any,
    overrides: {
      currentStock: number;
      monthlyConsumption: number;
      trend: 'increasing' | 'stable' | 'decreasing';
      trendPercentage: number;
      daysUntilStockout: number;
      recommendedOrderQuantity: number;
      urgency: 'critical' | 'high' | 'medium' | 'low';
      reason: string;
      scheduleInfo?: { nextRun: Date | null; scheduleId: string };
      estimatedLeadTime: number;
      reorderPoint: number | null;
      maxQuantity: number | null;
      isEmergencyOverride: boolean;
      hasActivePendingOrder?: boolean;
      lastOrderDate?: Date | null;
      daysSinceLastOrder?: number | null;
      estimatedCost?: number;
    },
  ): DemandAnalysis {
    const currentPrice = item.prices?.[0]?.value ?? 0;
    return {
      itemId: item.id,
      itemName: item.name,
      currentStock: overrides.currentStock,
      monthlyConsumption: overrides.monthlyConsumption,
      trend: overrides.trend,
      trendPercentage: overrides.trendPercentage,
      daysUntilStockout: overrides.daysUntilStockout,
      recommendedOrderQuantity: overrides.recommendedOrderQuantity,
      urgency: overrides.urgency,
      reason: overrides.reason,
      supplierId: item.supplierId,
      supplierName: item.supplier?.fantasyName ?? null,
      categoryId: item.categoryId,
      categoryName: item.category?.name ?? null,
      lastOrderDate: overrides.lastOrderDate ?? null,
      daysSinceLastOrder: overrides.daysSinceLastOrder ?? null,
      hasActivePendingOrder: overrides.hasActivePendingOrder ?? false,
      estimatedLeadTime: overrides.estimatedLeadTime,
      estimatedCost: overrides.estimatedCost ?? currentPrice * overrides.recommendedOrderQuantity,
      reorderPoint: overrides.reorderPoint,
      maxQuantity: overrides.maxQuantity,
      isInSchedule: !!overrides.scheduleInfo,
      scheduleNextRun: overrides.scheduleInfo?.nextRun ?? null,
      isEmergencyOverride: overrides.isEmergencyOverride,
    };
  }

  // ============================================================================
  // Lead-time helpers
  // ============================================================================

  /** Collects clean lead-time samples (in days) from an item's own historical
   *  receipts. "Clean" = NOT (null supplier + receivedAt = 2026-01-16). */
  private collectItemCleanLeadTimes(item: any): number[] {
    const samples: number[] = [];
    for (const oi of item.orderItems ?? []) {
      const receivedAt: Date | null = oi.receivedAt ? new Date(oi.receivedAt) : null;
      if (!receivedAt) continue;
      const order = oi.order;
      if (!order) continue;
      if (isLegacyBulkReceipt(order.supplierId ?? null, receivedAt)) continue;
      const fulfilledAt: Date | null = oi.fulfilledAt ? new Date(oi.fulfilledAt) : null;
      const startDate =
        fulfilledAt && fulfilledAt <= receivedAt
          ? fulfilledAt
          : new Date(order.createdAt);
      const diff = differenceInDays(receivedAt, startDate);
      if (diff > 0) samples.push(diff);
    }
    return samples;
  }

  /** Loads supplier-level clean lead-time samples once, indexed by supplierId. */
  private async loadSupplierLeadTimeSamples(
    items: any[],
    now: Date,
  ): Promise<Map<string, number[]>> {
    const supplierIds = Array.from(
      new Set(items.map(i => i.supplierId).filter((s: string | null): s is string => !!s)),
    );
    if (supplierIds.length === 0) return new Map();

    const sinceDate = subMonths(now, 6);
    const orderItems = await this.prisma.orderItem.findMany({
      where: {
        receivedAt: { not: null, gte: sinceDate },
        order: { supplierId: { in: supplierIds } },
      },
      include: { order: true },
    });

    const map = new Map<string, number[]>();
    for (const oi of orderItems) {
      if (!oi.receivedAt || !oi.order) continue;
      if (isLegacyBulkReceipt(oi.order.supplierId, oi.receivedAt)) continue;
      const supplierId = oi.order.supplierId;
      if (!supplierId) continue;
      const startDate =
        oi.fulfilledAt && oi.fulfilledAt <= oi.receivedAt
          ? oi.fulfilledAt
          : oi.order.createdAt;
      const diff = differenceInDays(oi.receivedAt, startDate);
      if (diff <= 0) continue;
      const arr = map.get(supplierId) ?? [];
      arr.push(diff);
      map.set(supplierId, arr);
    }
    return map;
  }

  // ============================================================================
  // Supplier eligibility + consolidation
  // ============================================================================

  /** Per-supplier order count in the trailing 12 months. Drives both
   *  eligibility (count ≥ 3) and the cadence-based consolidation window. */
  private async loadSupplierOrdersPerYear(now: Date): Promise<Map<string, number>> {
    const twelveMonthsAgo = subMonths(now, 12);
    const grouped = await this.prisma.order.groupBy({
      by: ['supplierId'],
      where: {
        createdAt: { gte: twelveMonthsAgo },
        supplierId: { not: null },
      },
      _count: { _all: true },
    });

    const map = new Map<string, number>();
    for (const row of grouped) {
      if (row.supplierId) map.set(row.supplierId, row._count._all);
    }
    return map;
  }

  /** For each per-supplier recommendation, pull in any same-supplier item
   *  that will reach its reorder point within the consolidation window,
   *  then rebalance quantities so all basket items deplete on a similar
   *  date (spec §10.2 aligned-depletion balancing). */
  private async applySupplierConsolidation(
    recommendations: AutoOrderRecommendation[],
    allAnalyzedItems: any[],
    scheduledItems: Map<string, { nextRun: Date | null; scheduleId: string }>,
    supplierLeadTimes: Map<string, number[]>,
    supplierOrdersPerYear: Map<string, number>,
    now: Date,
  ): Promise<AutoOrderRecommendation[]> {
    const enhanced: AutoOrderRecommendation[] = [];

    // Index analyzed items by supplier for fast lookup.
    const bySupplier = new Map<string, any[]>();
    for (const it of allAnalyzedItems) {
      if (!it.supplierId) continue;
      const arr = bySupplier.get(it.supplierId) ?? [];
      arr.push(it);
      bySupplier.set(it.supplierId, arr);
    }

    for (const rec of recommendations) {
      if (!rec.supplierId) {
        enhanced.push(rec);
        continue;
      }

      const ordersPerYear = supplierOrdersPerYear.get(rec.supplierId) ?? 0;
      const window = consolidationWindowForOrdersPerYear(ordersPerYear);
      const existingIds = new Set(rec.items.map(i => i.itemId));
      const candidates = bySupplier.get(rec.supplierId) ?? [];
      const pullIns: DemandAnalysis[] = [];
      // Tracks per-itemId daily-consumption + lead-time + maxQuantity used by
      // the post-pull-in aligned-depletion balancer.
      const balanceMeta = new Map<
        string,
        {
          dailyConsumption: number;
          maxQuantity: number | null;
          reorderPoint: number;
          leadTimeDays: number;
          incomingQty: number;
        }
      >();

      for (const item of candidates) {
        if (existingIds.has(item.id)) continue;
        if (scheduledItems.has(item.id)) continue;
        if (item.category?.type === ITEM_CATEGORY_TYPE.TOOL) continue;
        // PPE consolidation handled in per-item gate already; skip here to
        // avoid double-pulling PPE items outside their window.
        if (item.category?.type === ITEM_CATEGORY_TYPE.PPE) continue;

        const itemLike: ItemLike = {
          id: item.id,
          createdAt: item.createdAt,
          quantity: item.quantity,
          reorderPoint: item.reorderPoint,
          maxQuantity: item.maxQuantity,
          estimatedLeadTime: item.estimatedLeadTime,
          boxQuantity: item.boxQuantity,
          monthlyConsumption: item.monthlyConsumption != null ? Number(item.monthlyConsumption) : null,
          category: item.category ? { type: item.category.type } : null,
          abcCategory: item.abcCategory ?? null,
          xyzCategory: item.xyzCategory ?? null,
          ppeType: item.ppeType ?? null,
          ppeStandardQuantity: item.ppeStandardQuantity ?? null,
          ppeDeliveryMode: item.ppeDeliveryMode ?? null,
        };

        const mc = calculateMonthlyConsumption({
          item: itemLike,
          activities: item.activities,
          now,
        }).monthlyConsumption;
        if (mc <= 0) continue;

        const itemCleanLeadTimes = this.collectItemCleanLeadTimes(item);
        const supplierClean = supplierLeadTimes.get(item.supplierId) ?? [];
        const leadTimeDays = calculateLeadTime({
          itemCleanLeadTimes,
          supplierCleanLeadTimes: supplierClean,
        });

        const cell = resolveSafetyTargetCell(
          item.abcCategory ?? null,
          item.xyzCategory ?? null,
          item.ordersLast12Months ?? null,
        );
        const trendPct = calculateConsumptionTrend(this.bucketActivitiesByMonth(item.activities, now));
        const safety = applyTrendAdjustment(cell.safetyFactor, trendPct);

        const rp = calculateReorderPoint({
          item: itemLike,
          monthlyConsumption: mc,
          leadTimeDays,
          safetyFactor: safety,
          now,
        });
        const max = calculateMaxQuantity({
          item: itemLike,
          monthlyConsumption: mc,
          leadTimeDays,
          reorderPoint: rp,
          targetStockDays: cell.targetStockDays,
          now,
        });

        const dailyConsumption = mc / 30;
        if (dailyConsumption <= 0) continue;

        // Days until this item drops below RP, given its current stock.
        const daysUntilRp = Math.floor((item.quantity - rp) / dailyConsumption);
        // Only pull in if RP will be reached within `window + leadTime`.
        if (daysUntilRp > window + leadTimeDays) continue;
        if (daysUntilRp < 0) continue; // already below — should be in main rec

        const incoming = this.sumIncomingOrderedQuantity(item.orderItems);
        const qty = calculateReorderQuantity({
          currentStock: item.quantity,
          maxQuantity: max,
          incomingOrderedQuantity: incoming,
          boxQuantity: item.boxQuantity ?? 1,
        });
        if (qty <= 0) continue;

        const daysUntilStockout = Math.min(
          dailyConsumption > 0 ? Math.floor(item.quantity / dailyConsumption) : MAX_DAYS_DISPLAY,
          MAX_DAYS_DISPLAY,
        );
        const currentPrice = item.prices?.[0]?.value ?? 0;

        pullIns.push({
          itemId: item.id,
          itemName: item.name,
          currentStock: item.quantity,
          monthlyConsumption: mc,
          trend: trendPct > 20 ? 'increasing' : trendPct < -20 ? 'decreasing' : 'stable',
          trendPercentage: trendPct,
          daysUntilStockout,
          recommendedOrderQuantity: qty,
          urgency: 'low',
          reason: `Consolidação de fornecedor (${window}d): aproveitar pedido para repor antes do próximo ciclo`,
          supplierId: item.supplierId,
          supplierName: item.supplier?.fantasyName ?? null,
          categoryId: item.categoryId,
          categoryName: item.category?.name ?? null,
          lastOrderDate: null,
          daysSinceLastOrder: null,
          hasActivePendingOrder: false,
          estimatedLeadTime: leadTimeDays,
          estimatedCost: currentPrice * qty,
          reorderPoint: rp,
          maxQuantity: max,
          isInSchedule: false,
          scheduleNextRun: null,
          isEmergencyOverride: false,
        });
        balanceMeta.set(item.id, {
          dailyConsumption,
          maxQuantity: max,
          reorderPoint: rp,
          leadTimeDays,
          incomingQty: incoming,
        });
      }

      // Capture balance metadata for the items that arrived in the original
      // per-supplier rec (so the rebalancer sees the whole basket).
      for (const it of rec.items) {
        if (balanceMeta.has(it.itemId)) continue;
        const sourceItem = (bySupplier.get(rec.supplierId) ?? []).find(c => c.id === it.itemId);
        const incoming = sourceItem ? this.sumIncomingOrderedQuantity(sourceItem.orderItems) : 0;
        const dailyConsumption = it.monthlyConsumption > 0 ? it.monthlyConsumption / 30 : 0;
        balanceMeta.set(it.itemId, {
          dailyConsumption,
          maxQuantity: it.maxQuantity,
          reorderPoint: it.reorderPoint ?? 0,
          leadTimeDays: it.estimatedLeadTime,
          incomingQty: incoming,
        });
      }

      this.logger.debug(
        `Supplier ${rec.supplierName}: pulled in ${pullIns.length} consolidation items (window=${window}d, ordersPerYear=${ordersPerYear})`,
      );

      const combinedItems = [...rec.items, ...pullIns];

      // Aligned-depletion balancing (spec §10.2): trim long-coverage items
      // so the basket runs out around the same date. Critical/high-urgency
      // items are pinned (never trimmed) since they're the reason we're
      // ordering in the first place.
      const urgentIds = new Set(
        combinedItems
          .filter(it => it.urgency === 'critical' || it.urgency === 'high')
          .map(it => it.itemId),
      );
      const balanceable = combinedItems
        .filter(it => !urgentIds.has(it.itemId))
        .map(it => {
          const meta = balanceMeta.get(it.itemId);
          return {
            itemId: it.itemId,
            currentQty: it.currentStock,
            proposedQty: it.recommendedOrderQuantity,
            dailyConsumption: meta?.dailyConsumption ?? 0,
            maxQuantity: meta?.maxQuantity ?? it.maxQuantity ?? null,
            reorderPoint: meta?.reorderPoint ?? it.reorderPoint ?? 0,
            leadTimeDays: meta?.leadTimeDays ?? it.estimatedLeadTime,
            incomingQty: meta?.incomingQty ?? 0,
          };
        });
      const balancedResults = balanceDepletionAcrossItems(balanceable);
      const balancedByItem = new Map(
        balancedResults.map((r, i) => [balanceable[i].itemId, r.balancedQty]),
      );

      const allItems = combinedItems.map(it => {
        if (urgentIds.has(it.itemId)) return it;
        const newQty = balancedByItem.get(it.itemId);
        if (newQty == null || newQty === it.recommendedOrderQuantity) return it;
        const unitPrice =
          it.recommendedOrderQuantity > 0 ? it.estimatedCost / it.recommendedOrderQuantity : 0;
        return {
          ...it,
          recommendedOrderQuantity: newQty,
          estimatedCost: unitPrice * newQty,
        };
      });

      const totalValue = allItems.reduce((sum, it) => sum + (it.estimatedCost ?? 0), 0);
      const urgency = allItems.reduce(
        (max, it) => {
          const order = { critical: 4, high: 3, medium: 2, low: 1 };
          return order[it.urgency] > order[max] ? it.urgency : max;
        },
        'low' as 'critical' | 'high' | 'medium' | 'low',
      );
      const consolidatedReasons = Array.from(new Set(allItems.map(it => it.reason)));

      enhanced.push({
        ...rec,
        items: allItems,
        totalValue,
        urgency,
        consolidatedReasons,
      });
    }

    return enhanced;
  }

  // ============================================================================
  // PPE consolidation window
  // ============================================================================

  /** Returns true iff the next PPE default-interval window starts within
   *  `leadTimeDays + safetyDays` from now, using `Item.ppeType` to pick the
   *  interval and `Item.lastAutoOrderDate` (or item creation) as the anchor. */
  private isPpeWithinDeliveryWindow(
    item: any,
    now: Date,
    leadTimeDays: number,
    safetyDays: number,
  ): boolean {
    if (!item.ppeType) return true; // no type → fall back to standard pipeline
    const intervalMonths = PPE_DEFAULT_INTERVAL_MONTHS[item.ppeType];
    if (!intervalMonths) return true;

    const anchor: Date = item.lastAutoOrderDate
      ? new Date(item.lastAutoOrderDate)
      : new Date(item.createdAt);
    // Roll the anchor forward until we find the next future window start.
    let nextWindow = addMonths(anchor, intervalMonths);
    while (nextWindow < now) nextWindow = addMonths(nextWindow, intervalMonths);

    const daysUntilNextWindow = differenceInDays(nextWindow, now);
    return daysUntilNextWindow <= leadTimeDays + safetyDays;
  }

  // ============================================================================
  // Order need + urgency (matrix-driven thresholds removed; bands are simple)
  // ============================================================================

  /** Recommendation gate keyed off the canonical stock-level band
   *  (spec §15). NEGATIVE_STOCK / OUT_OF_STOCK / CRITICAL always recommend.
   *  LOW recommends. OPTIMAL / OVERSTOCKED skip unless the projected
   *  stockout falls inside the lead time. */
  private determineOrderNeed(
    stockLevel: STOCK_LEVEL,
    currentStock: number,
    reorderPoint: number,
    daysUntilStockout: number,
    estimatedLeadTime: number,
  ): { shouldOrder: boolean; reason: string } {
    switch (stockLevel) {
      case STOCK_LEVEL.NEGATIVE_STOCK:
        return { shouldOrder: true, reason: 'Estoque negativo — reposição urgente' };
      case STOCK_LEVEL.OUT_OF_STOCK:
        return { shouldOrder: true, reason: 'Item fora de estoque' };
      case STOCK_LEVEL.CRITICAL:
        return {
          shouldOrder: true,
          reason: `Estoque abaixo do ponto de reposição (${currentStock} ≤ ${reorderPoint})`,
        };
      case STOCK_LEVEL.LOW:
        return {
          shouldOrder: true,
          reason: 'Reposição preventiva — estoque na faixa baixa',
        };
      case STOCK_LEVEL.OPTIMAL:
      case STOCK_LEVEL.OVERSTOCKED:
        if (daysUntilStockout < estimatedLeadTime) {
          return {
            shouldOrder: true,
            reason: `Estoque esgotará em ${daysUntilStockout} dias (prazo de entrega: ${estimatedLeadTime} dias)`,
          };
        }
        return { shouldOrder: false, reason: '' };
      default:
        return { shouldOrder: false, reason: '' };
    }
  }

  /** Maps the canonical stock-level band onto the auto-order urgency
   *  ladder. Stockout-vs-lead-time projection escalates OPTIMAL to medium
   *  when relevant. */
  private urgencyFromStockLevel(
    stockLevel: STOCK_LEVEL,
    daysUntilStockout: number,
    estimatedLeadTime: number,
  ): 'critical' | 'high' | 'medium' | 'low' {
    switch (stockLevel) {
      case STOCK_LEVEL.NEGATIVE_STOCK:
      case STOCK_LEVEL.OUT_OF_STOCK:
        return 'critical';
      case STOCK_LEVEL.CRITICAL:
        return 'high';
      case STOCK_LEVEL.LOW:
        return 'medium';
      case STOCK_LEVEL.OPTIMAL:
      case STOCK_LEVEL.OVERSTOCKED:
        return daysUntilStockout < estimatedLeadTime ? 'medium' : 'low';
      default:
        return 'low';
    }
  }

  // ============================================================================
  // Helpers — bucketing, incoming order qty, group-by-supplier
  // ============================================================================

  /** Converts raw OUTBOUND activities into a per-month bucket suitable for
   *  `calculateConsumptionTrend`. Chronologically sorted, most recent last. */
  private bucketActivitiesByMonth(
    activities: any[],
    now: Date,
  ): Array<{ year: number; month: number; consumption: number }> {
    const lookbackStart = subMonths(now, 6);
    const buckets = new Map<string, { year: number; month: number; consumption: number }>();

    // Seed all 6 months with zero so the trend has a stable denominator.
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(now, i);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      buckets.set(key, { year: d.getFullYear(), month: d.getMonth(), consumption: 0 });
    }

    for (const a of activities) {
      const ts = new Date(a.createdAt);
      if (ts < lookbackStart) continue;
      const key = `${ts.getFullYear()}-${ts.getMonth()}`;
      const entry = buckets.get(key);
      if (!entry) continue;
      entry.consumption += a.quantity;
    }

    return Array.from(buckets.values()).sort(
      (a, b) => a.year * 12 + a.month - (b.year * 12 + b.month),
    );
  }

  /** Sum of (ordered − received) over the item's still-open OrderItems. */
  private sumIncomingOrderedQuantity(orderItems: any[]): number {
    let total = 0;
    for (const oi of orderItems ?? []) {
      const status = oi.order?.status;
      if (!status) continue;
      if (status === ORDER_STATUS.CANCELLED || status === ORDER_STATUS.RECEIVED) continue;
      const ordered = oi.orderedQuantity ?? 0;
      const received = oi.receivedQuantity ?? 0;
      const open = ordered - received;
      if (open > 0) total += open;
    }
    return total;
  }

  private groupBySupplier(analyses: DemandAnalysis[]): AutoOrderRecommendation[] {
    const grouped = new Map<string, DemandAnalysis[]>();
    analyses.forEach(a => {
      const key = a.supplierId ?? 'NO_SUPPLIER';
      const arr = grouped.get(key) ?? [];
      arr.push(a);
      grouped.set(key, arr);
    });

    return Array.from(grouped.entries()).map(([supplierId, items]) => {
      const totalValue = items.reduce((sum, it) => sum + (it.estimatedCost ?? 0), 0);
      const urgency = items.reduce(
        (max, it) => {
          const order = { critical: 4, high: 3, medium: 2, low: 1 };
          return order[it.urgency] > order[max] ? it.urgency : max;
        },
        'low' as 'critical' | 'high' | 'medium' | 'low',
      );
      const consolidatedReasons = Array.from(new Set(items.map(it => it.reason)));
      return {
        supplierId: supplierId === 'NO_SUPPLIER' ? null : supplierId,
        supplierName: items[0].supplierName ?? 'Sem fornecedor',
        items,
        totalValue,
        urgency,
        consolidatedReasons,
      };
    });
  }

  // ============================================================================
  // Persist computed metrics back to Item rows
  // ============================================================================

  /** Writes computed mc / trend / rp / max / reorderQty back to Item in
   *  batches of ~100 inside a single `$transaction`. Idempotent — if the
   *  computed value matches what's already on the row, the write is still
   *  made (cheap). */
  private async persistComputedMetrics(rows: ComputedItemMetrics[]): Promise<void> {
    if (rows.length === 0) return;

    for (let i = 0; i < rows.length; i += PERSIST_BATCH_SIZE) {
      const chunk = rows.slice(i, i + PERSIST_BATCH_SIZE);
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const r of chunk) {
          await tx.item.update({
            where: { id: r.itemId },
            data: {
              monthlyConsumption: r.monthlyConsumption,
              monthlyConsumptionTrendPercent: r.trendPercentage,
              reorderPoint: r.reorderPoint,
              maxQuantity: r.maxQuantity,
              reorderQuantity: r.reorderQuantity,
            },
          });
        }
      });
    }

    this.logger.log(`Persisted recomputed metrics for ${rows.length} items`);
  }

  // ============================================================================
  // Public — schedule reporting only. Order creation is OUT (spec §10:
  // recommendations only; persistence is a user-initiated action elsewhere).
  // ============================================================================

  /**
   * Get list of items currently in active schedules
   */
  async getScheduledItems(): Promise<
    Array<{
      itemId: string;
      itemName: string;
      scheduleId: string;
      scheduleName: string;
      nextRun: Date | null;
    }>
  > {
    const activeSchedules = await this.prisma.orderSchedule.findMany({
      where: { isActive: true, finishedAt: null },
      select: { id: true, items: true, nextRun: true, frequency: true },
    });

    const scheduledItems: Array<{
      itemId: string;
      itemName: string;
      scheduleId: string;
      scheduleName: string;
      nextRun: Date | null;
    }> = [];

    for (const schedule of activeSchedules) {
      const items = await this.prisma.item.findMany({
        where: { id: { in: schedule.items } },
        select: { id: true, name: true },
      });

      for (const item of items) {
        scheduledItems.push({
          itemId: item.id,
          itemName: item.name,
          scheduleId: schedule.id,
          scheduleName: `Agendamento ${schedule.frequency}`,
          nextRun: schedule.nextRun,
        });
      }
    }

    return scheduledItems;
  }
}
