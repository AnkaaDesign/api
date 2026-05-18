import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ENTITY_TYPE,
  CHANGE_TRIGGERED_BY,
  ORDER_STATUS,
  ACTIVITY_OPERATION,
  ITEM_CATEGORY_TYPE,
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
const FARBEN_CONSOLIDATION_WINDOW_DAYS = 2;
const DEFAULT_CONSOLIDATION_WINDOW_DAYS = 7;
const PERSIST_BATCH_SIZE = 100;
const DUPLICATE_ORDER_GUARD_DAYS = 30;

@Injectable()
export class AutoOrderService {
  private readonly logger = new Logger(AutoOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Analyze all items and generate smart auto-order recommendations.
   *
   * Wired into the post-Phase-3 utility layer:
   *   - mc, rp, max, reorderQty all flow through `stock-health.ts`.
   *   - Supplier suppliers with <3 orders/12mo are filtered out of recs.
   *   - Farben → 2-day consolidation window; others → 7-day.
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

    const scheduledItems = new Map<string, { nextRun: Date | null; scheduleId: string }>();
    activeSchedules.forEach(schedule => {
      schedule.items.forEach(itemId => {
        scheduledItems.set(itemId, {
          nextRun: schedule.nextRun,
          scheduleId: schedule.id,
        });
      });
    });

    this.logger.log(`Found ${scheduledItems.size} items in active schedules`);

    // Suppliers with <3 orders/12mo are excluded from auto-order entirely.
    const eligibleSupplierIds = await this.resolveEligibleSupplierIds(now);
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
    // the supplier's consolidation window.
    const enhancedRecommendations = await this.applySupplierConsolidation(
      groupedBySupplier,
      items,
      scheduledItems,
      supplierLeadTimes,
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
    // as still active).
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

    // If a pending order already exists and stock is not critical, skip.
    if (hasActivePendingOrder && currentStock > reorderPoint * 0.5) {
      return { analysis: null, metrics };
    }

    // Duplicate-order guard: don't reorder within 30 days unless critical.
    const lastOrderDate = item.orderItems[0]?.order?.createdAt ?? null;
    const daysSinceLastOrder = lastOrderDate ? differenceInDays(now, lastOrderDate) : null;
    const isCritical = currentStock <= reorderPoint * 0.5;
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

    // Schedule coordination.
    let isEmergencyOverride = false;
    if (scheduleInfo?.nextRun) {
      const daysUntilScheduledOrder = differenceInDays(scheduleInfo.nextRun, now);
      const daysUntilScheduledDelivery = daysUntilScheduledOrder + leadTimeDays;
      const willStockoutBeforeSchedule = daysUntilStockout < daysUntilScheduledDelivery;

      if (!willStockoutBeforeSchedule && daysUntilScheduledOrder <= leadTimeDays * 1.5) {
        this.logger.debug(
          `Skipping ${item.name}: covered by schedule (next order in ${daysUntilScheduledOrder} days)`,
        );
        return { analysis: null, metrics };
      }
      if (willStockoutBeforeSchedule && currentStock > 0) {
        isEmergencyOverride = true;
        this.logger.warn(
          `EMERGENCY: ${item.name} will stockout in ${daysUntilStockout} days, scheduled order not until ${daysUntilScheduledOrder} days.`,
        );
      }
    }

    // Order-need decision — uses computed rp/max.
    const needsOrdering = this.determineOrderNeed(
      currentStock,
      reorderPoint,
      maxQuantity,
      daysUntilStockout,
      leadTimeDays,
      hasActivePendingOrder,
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

    const urgency = this.determineUrgency(currentStock, reorderPoint, daysUntilStockout, leadTimeDays);
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
      const orderedAt = new Date(order.createdAt);
      const diff = differenceInDays(receivedAt, orderedAt);
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
      const diff = differenceInDays(oi.receivedAt, oi.order.createdAt);
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

  /** Suppliers with <3 orders in the trailing 12 months are excluded. */
  private async resolveEligibleSupplierIds(now: Date): Promise<Set<string>> {
    const twelveMonthsAgo = subMonths(now, 12);
    const grouped = await this.prisma.order.groupBy({
      by: ['supplierId'],
      where: {
        createdAt: { gte: twelveMonthsAgo },
        supplierId: { not: null },
      },
      _count: { _all: true },
    });

    const set = new Set<string>();
    for (const row of grouped) {
      if (row.supplierId && row._count._all >= MIN_SUPPLIER_ORDERS_FOR_AUTO_ORDER) {
        set.add(row.supplierId);
      }
    }
    return set;
  }

  /** Returns the consolidation window (days) for a supplier name.
   *  Farben = 2 days; everyone else = 7 days. */
  private consolidationWindowDaysFor(supplierName: string | null): number {
    if (supplierName && supplierName.toLowerCase().includes('farben')) {
      return FARBEN_CONSOLIDATION_WINDOW_DAYS;
    }
    return DEFAULT_CONSOLIDATION_WINDOW_DAYS;
  }

  /** For each per-supplier recommendation, pull in any same-supplier item
   *  that will reach its reorder point within the consolidation window. */
  private async applySupplierConsolidation(
    recommendations: AutoOrderRecommendation[],
    allAnalyzedItems: any[],
    scheduledItems: Map<string, { nextRun: Date | null; scheduleId: string }>,
    supplierLeadTimes: Map<string, number[]>,
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

      const window = this.consolidationWindowDaysFor(rec.supplierName);
      const existingIds = new Set(rec.items.map(i => i.itemId));
      const candidates = bySupplier.get(rec.supplierId) ?? [];
      const pullIns: DemandAnalysis[] = [];

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
      }

      this.logger.debug(
        `Supplier ${rec.supplierName}: pulled in ${pullIns.length} consolidation items (window=${window}d)`,
      );

      const allItems = [...rec.items, ...pullIns];
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

  private determineOrderNeed(
    currentStock: number,
    reorderPoint: number,
    maxQuantity: number | null,
    daysUntilStockout: number,
    estimatedLeadTime: number,
    hasActivePendingOrder: boolean,
  ): { shouldOrder: boolean; reason: string } {
    if (currentStock === 0) {
      return { shouldOrder: true, reason: 'Item fora de estoque' };
    }
    if (daysUntilStockout < estimatedLeadTime) {
      return {
        shouldOrder: true,
        reason: `Estoque esgotará em ${daysUntilStockout} dias (prazo de entrega: ${estimatedLeadTime} dias)`,
      };
    }
    if (currentStock <= reorderPoint) {
      return {
        shouldOrder: true,
        reason: `Estoque abaixo do ponto de reposição (${currentStock} ≤ ${reorderPoint})`,
      };
    }
    if (currentStock <= reorderPoint * 1.2 && daysUntilStockout < estimatedLeadTime * 1.5) {
      return { shouldOrder: true, reason: 'Reposição preventiva — aproximando do ponto de reposição' };
    }
    return { shouldOrder: false, reason: '' };
  }

  private determineUrgency(
    currentStock: number,
    reorderPoint: number,
    daysUntilStockout: number,
    estimatedLeadTime: number,
  ): 'critical' | 'high' | 'medium' | 'low' {
    if (currentStock === 0 || daysUntilStockout < estimatedLeadTime / 2) return 'critical';
    if (currentStock <= reorderPoint * 0.5 || daysUntilStockout < estimatedLeadTime) return 'high';
    if (currentStock <= reorderPoint * 0.8) return 'medium';
    return 'low';
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
  // Public — order creation + schedule reporting (UNCHANGED API surface)
  // ============================================================================

  /**
   * Create auto-orders from recommendations
   */
  async createAutoOrders(
    recommendations: AutoOrderRecommendation[],
    userId: string,
  ): Promise<any[]> {
    const createdOrders: any[] = [];

    for (const recommendation of recommendations) {
      try {
        const order = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
          const newOrder = await tx.order.create({
            data: {
              description: `Pedido automático - ${recommendation.supplierName}`,
              supplierId: recommendation.supplierId,
              status: ORDER_STATUS.CREATED,
              notes: `Gerado automaticamente:\n${recommendation.consolidatedReasons.join('\n')}`,
              items: {
                create: recommendation.items.map(item => ({
                  itemId: item.itemId,
                  orderedQuantity: item.recommendedOrderQuantity,
                  price: 0,
                  icms: 0,
                  ipi: 0,
                })),
              },
            },
            include: { items: true },
          });

          await tx.item.updateMany({
            where: { id: { in: recommendation.items.map(i => i.itemId) } },
            data: { lastAutoOrderDate: new Date() },
          });

          await this.changeLogService.logChange(
            ENTITY_TYPE.ORDER,
            'CREATE' as any,
            newOrder.id,
            null,
            newOrder,
            userId,
            CHANGE_TRIGGERED_BY.SYSTEM,
            tx,
          );

          return newOrder;
        });

        createdOrders.push(order);
        this.logger.log(`Created auto-order ${order.id} for ${recommendation.supplierName}`);
      } catch (error) {
        this.logger.error(`Failed to create auto-order for ${recommendation.supplierName}:`, error);
      }
    }

    return createdOrders;
  }

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
