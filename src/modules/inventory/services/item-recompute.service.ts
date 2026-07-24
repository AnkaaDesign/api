// Activity-write-time per-item recompute service.
//
// Single entry-point (`recomputeItemMetrics`) for callers that need to refresh
// monthlyConsumption / reorderPoint / maxQuantity / reorderQuantity /
// estimatedLeadTime after an activity write. Delegates ALL math to the
// shared utilities in `@/utils/stock-health` so the activity-time path stays
// consistent with the nightly batch in `inventory-cron.service.ts`.
//
// ABC / XYZ classifications are NOT recomputed here — those are population-
// level ranking operations owned by the nightly cron. We reuse whatever
// classification is currently persisted on the item row.

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  ABC_CATEGORY,
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
  ITEM_CATEGORY_TYPE,
  ORDER_STATUS,
  XYZ_CATEGORY,
} from '@/constants/enums';
import {
  CONSUMPTION_LOOKBACK_MONTHS,
  PPE_CONSUMPTION_REASONS,
  REGULAR_CONSUMPTION_REASONS,
  getFixedTarget,
  isFixedTarget,
} from '@/constants/inventory-config';
import { CORPUS_MONTHLY_INDEX } from '@/constants/seasonality-config';
import {
  calculateConsumptionTrend,
  calculateLeadTime,
  calculateMaxQuantity,
  calculateMonthlyConsumption,
  calculatePeakWeekDemand,
  calculateReorderPoint,
  calculateReorderQuantity,
  isLegacyBulkReceipt,
  leadTimeClockStart,
  resolveSafetyTargetCell,
  winsorizeConsumptionSeries,
  type ItemLike,
  type SeasonalContext,
} from '@/utils/stock-health';
import { calculateSafetyStock } from '@/utils/safety-stock';
import { type SeasonalCurve } from '@/utils/seasonality';
import { isVacationDistortedMonth } from '@/utils/working-days';

export interface ItemRecomputeResult {
  mc: number;
  rp: number;
  max: number;
  reorderQty: number;
  leadTime: number;
  abc: ABC_CATEGORY | null;
  xyz: XYZ_CATEGORY | null;
}

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class ItemRecomputeService {
  private readonly logger = new Logger(ItemRecomputeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recomputes and persists `monthlyConsumption`, `reorderPoint`, `maxQuantity`,
   * `reorderQuantity`, and `estimatedLeadTime` for a single item using the
   * canonical stock-health engine. Returns the freshly computed numbers
   * together with the item's existing ABC/XYZ classifications.
   *
   * FIXED_TARGET items short-circuit per spec §4/§12: mc=0,
   * rp=max=fixedTargetQuantity (fallback 1), reorderQty=box-rounded shortfall,
   * leadTime preserved.
   *
   * Safe to call inside a Prisma `$transaction`; pass the transaction client
   * via `tx` so all reads/writes participate in it.
   */
  async recomputeItemMetrics(
    itemId: string,
    tx?: PrismaTx,
  ): Promise<ItemRecomputeResult> {
    const client = tx ?? this.prisma;

    const item = await client.item.findUnique({
      where: { id: itemId },
      include: { category: { select: { id: true, type: true, name: true } } },
    });

    if (!item) {
      throw new Error(`Item ${itemId} not found for recompute`);
    }

    // Fixed-target short-circuit (spec §4/§12) — mirror stock-health.ts.
    // These items hold a fixed target on-hand quantity
    // (item.fixedTargetQuantity ?? 1); reorderPoint and maxQuantity = target,
    // reorderQuantity = box-rounded shortfall to restore it.
    if (isFixedTarget(item)) {
      const existingLeadTime = item.estimatedLeadTime ?? 0;
      const target = getFixedTarget(item);
      const box = Math.max(1, item.boxQuantity ?? 1);
      const reorderQty = Math.max(0, Math.ceil((target - item.quantity) / box) * box);
      await client.item.update({
        where: { id: itemId },
        data: {
          monthlyConsumption: new Prisma.Decimal(0),
          reorderPoint: target,
          maxQuantity: target,
          reorderQuantity: reorderQty,
        },
      });
      return {
        mc: 0,
        rp: target,
        max: target,
        reorderQty,
        leadTime: existingLeadTime,
        abc: (item.abcCategory as ABC_CATEGORY | null) ?? null,
        xyz: (item.xyzCategory as XYZ_CATEGORY | null) ?? null,
      };
    }

    const now = new Date();
    // PPE histTrailing12mo needs a full 12-month window; regular items only
    // need CONSUMPTION_LOOKBACK_MONTHS (6) but loading 12 is harmless since
    // calculateMonthlyConsumptionRegular clips internally.
    const lookbackStart = new Date(now);
    lookbackStart.setMonth(lookbackStart.getMonth() - 12);

    const orderHistoryStart = new Date(now);
    orderHistoryStart.setMonth(orderHistoryStart.getMonth() - 12);

    // Parallelize: activities + order receipts + supplier-level receipts (for
    // tier-2 fallback) + snapshots for seasonal context.
    const [activities, orderItems, snapshots, supplierOrderItems] = await Promise.all([
      client.activity.findMany({
        where: {
          itemId,
          createdAt: { gte: lookbackStart },
        },
        select: {
          operation: true,
          reason: true,
          quantity: true,
          createdAt: true,
        },
      }),
      client.orderItem.findMany({
        where: {
          itemId,
          order: { createdAt: { gte: orderHistoryStart } },
        },
        select: {
          orderId: true,
          orderedQuantity: true,
          receivedQuantity: true,
          receivedAt: true,
          fulfilledAt: true,
          order: {
            select: { id: true, status: true, supplierId: true, createdAt: true },
          },
        },
      }),
      client.consumptionSnapshot.findMany({
        where: { itemId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 24,
        select: {
          year: true,
          month: true,
          normalizedConsumption: true,
          seasonalFactor: true,
        },
      }),
      item.supplierId
        ? client.orderItem.findMany({
            where: {
              order: {
                supplierId: item.supplierId,
                createdAt: { gte: orderHistoryStart },
              },
              receivedAt: { not: null },
            },
            select: {
              receivedAt: true,
              fulfilledAt: true,
              order: { select: { supplierId: true, createdAt: true } },
            },
          })
        : Promise.resolve([] as Array<{
            receivedAt: Date | null;
            fulfilledAt: Date | null;
            order: { supplierId: string | null; createdAt: Date };
          }>),
    ]);

    const seasonalCtx = this.buildSeasonalContext(snapshots);

    // monthlyConsumption — routes by capability fields inside the engine
    // (stockModel / ppeType). PPE identity = ppeType != null.
    const itemLike = this.toItemLike(item);
    const isPpeItem = item.ppeType != null;
    const histTrailing12mo = isPpeItem
      ? activities
          .filter(
            a =>
              a.operation === ACTIVITY_OPERATION.OUTBOUND &&
              (PPE_CONSUMPTION_REASONS as string[]).includes(a.reason),
          )
          .reduce((sum, a) => sum + a.quantity, 0)
      : undefined;
    const activityLikes = activities.map(a => ({
      operation: a.operation as ACTIVITY_OPERATION,
      reason: a.reason as ACTIVITY_REASON,
      quantity: a.quantity,
      createdAt: a.createdAt,
    }));
    const mcResult = calculateMonthlyConsumption({
      item: itemLike,
      activities: activityLikes,
      now,
      seasonalCtx,
      ...(isPpeItem && { ppe: { histTrailing12mo } }),
    });

    // Lead time — P90 of clean per-item receipts, falling back to supplier
    // then global default.
    const itemCleanLeadTimes: number[] = [];
    let incomingOrderedQuantity = 0;
    const distinctOrderIds = new Set<string>();

    for (const oi of orderItems) {
      distinctOrderIds.add(oi.orderId);

      const status = oi.order.status as ORDER_STATUS;
      const isPending =
        status !== ORDER_STATUS.CANCELLED && status !== ORDER_STATUS.RECEIVED;
      if (isPending) {
        const remaining = oi.orderedQuantity - oi.receivedQuantity;
        if (remaining > 0) incomingOrderedQuantity += remaining;
      }

      if (oi.receivedAt) {
        if (!isLegacyBulkReceipt(oi.order.supplierId, oi.receivedAt)) {
          // Lead-time clock starts at fulfilledAt only when it's a real
          // dispatch timestamp (>= 1 day before receipt); otherwise it's
          // bookkeeping noise and order.createdAt is the honest clock start.
          const startDate = leadTimeClockStart(
            oi.fulfilledAt,
            oi.receivedAt,
            oi.order.createdAt,
          );
          const days = Math.max(
            0,
            (oi.receivedAt.getTime() - startDate.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          itemCleanLeadTimes.push(days);
        }
      }
    }

    const supplierCleanLeadTimes: number[] = [];
    for (const oi of supplierOrderItems) {
      if (!oi.receivedAt) continue;
      const supplierId = oi.order.supplierId;
      if (isLegacyBulkReceipt(supplierId, oi.receivedAt)) continue;
      const startDate = leadTimeClockStart(
        oi.fulfilledAt,
        oi.receivedAt,
        oi.order.createdAt,
      );
      const days =
        (oi.receivedAt.getTime() - startDate.getTime()) /
        (1000 * 60 * 60 * 24);
      if (days >= 0) supplierCleanLeadTimes.push(days);
    }

    const leadTime = calculateLeadTime({
      itemCleanLeadTimes,
      supplierCleanLeadTimes,
    });

    // reorderPoint + maxQuantity — using the item's currently-persisted
    // ABC/XYZ. Nightly cron is authoritative for those rankings; activity-
    // write-time recompute only refreshes the per-item math.
    const ordersLast12Months = distinctOrderIds.size;
    const cell = resolveSafetyTargetCell(
      (item.abcCategory as ABC_CATEGORY | null) ?? null,
      (item.xyzCategory as XYZ_CATEGORY | null) ?? null,
      ordersLast12Months,
    );

    // Layered safety-stock formula. Replaces flat % with z×σ×√LT when we
    // have ≥6 months of history; bumped LOW_DATA matrix at 3–5 months;
    // UNCLASSIFIED bonus below that.
    const monthlyHistory = this.buildMonthlyHistoryForSafety(snapshots, now);
    const trendPercent = calculateConsumptionTrend(
      snapshots
        .slice()
        .reverse()
        .map(s => ({ year: s.year, month: s.month, consumption: s.normalizedConsumption })),
    );
    const safetyResult = calculateSafetyStock({
      monthlyConsumption: mcResult.monthlyConsumption,
      leadTimeDays: leadTime,
      abcCategory: (item.abcCategory as ABC_CATEGORY | null) ?? null,
      xyzCategory: (item.xyzCategory as XYZ_CATEGORY | null) ?? null,
      monthlyHistory,
      trendPercent,
    });

    // Conservative rp floor: never below the max single-week demand actually
    // observed in the lookback (CONSUMPTION-model items only; the engine
    // ignores the floor on the FIXED_TARGET/PPE-scheduled branches).
    const peakWeekDemand = calculatePeakWeekDemand(
      activityLikes,
      item.createdAt,
      now,
    );

    const reorderPoint = calculateReorderPoint({
      item: itemLike,
      monthlyConsumption: mcResult.monthlyConsumption,
      leadTimeDays: leadTime,
      safetyFactor: cell.safetyFactor, // kept for back-compat; ignored when safetyStock present
      safetyStock: safetyResult.safetyStock,
      seasonalCtx,
      now,
      peakWeekDemand,
    });

    const maxQuantity = calculateMaxQuantity({
      item: itemLike,
      monthlyConsumption: mcResult.monthlyConsumption,
      leadTimeDays: leadTime,
      reorderPoint,
      targetStockDays: cell.targetStockDays,
      // Per-item absolute coverage override (e.g. "hold ~2 months") wins over the
      // matrix, even during the transient UNCLASSIFIED window.
      overrideCoverageDays: item.targetCoverageDays ?? null,
      seasonalCtx,
      now,
    });

    const reorderQuantity = calculateReorderQuantity({
      currentStock: item.quantity,
      maxQuantity,
      incomingOrderedQuantity,
      boxQuantity: item.boxQuantity ?? null,
    });

    // Persist. Cast to Unchecked* because some columns (ordersLast12Months,
    // etc.) are part of newer Prisma client generations that may lag here.
    await client.item.update({
      where: { id: itemId },
      data: {
        monthlyConsumption: new Prisma.Decimal(mcResult.monthlyConsumption),
        reorderPoint,
        maxQuantity,
        reorderQuantity,
        estimatedLeadTime: leadTime,
      } as Prisma.ItemUncheckedUpdateInput,
    });

    return {
      mc: mcResult.monthlyConsumption,
      rp: reorderPoint,
      max: maxQuantity,
      reorderQty: reorderQuantity,
      leadTime,
      abc: (item.abcCategory as ABC_CATEGORY | null) ?? null,
      xyz: (item.xyzCategory as XYZ_CATEGORY | null) ?? null,
    };
  }

  // ============================================================================
  // Internals
  // ============================================================================

  private toItemLike(
    item: Awaited<ReturnType<PrismaService['item']['findUnique']>>,
  ): ItemLike {
    if (!item) {
      throw new Error('toItemLike: item is null');
    }
    return {
      id: item.id,
      createdAt: item.createdAt,
      quantity: item.quantity,
      reorderPoint: item.reorderPoint,
      maxQuantity: item.maxQuantity,
      estimatedLeadTime: item.estimatedLeadTime,
      boxQuantity: item.boxQuantity,
      monthlyConsumption:
        item.monthlyConsumption == null ? null : Number(item.monthlyConsumption),
      category: (item as any).category
        ? { type: ((item as any).category.type as ITEM_CATEGORY_TYPE | null) ?? null }
        : null,
      stockModel: (item.stockModel as string | null) ?? null,
      fixedTargetQuantity: item.fixedTargetQuantity ?? null,
      abcCategory: (item.abcCategory as ABC_CATEGORY | null) ?? null,
      xyzCategory: (item.xyzCategory as XYZ_CATEGORY | null) ?? null,
      ppeType: (item.ppeType ?? null) as ItemLike['ppeType'],
      ppeStandardQuantity: item.ppeStandardQuantity ?? null,
      ppeDeliveryMode: (item.ppeDeliveryMode ?? null) as ItemLike['ppeDeliveryMode'],
    };
  }

  private buildSeasonalContext(
    history: Array<{
      year: number;
      month: number;
      normalizedConsumption: number;
      seasonalFactor: number;
    }>,
  ): SeasonalContext | undefined {
    if (!history || history.length === 0) return undefined;

    const buckets: number[][] = Array.from({ length: 12 }, () => []);
    for (const row of history) {
      if (row.seasonalFactor && row.seasonalFactor > 0) {
        buckets[row.month].push(row.seasonalFactor);
      }
    }
    const monthsWithData = buckets.filter(arr => arr.length > 0).length;
    if (monthsWithData < 6) return undefined;

    const itemCurve: number[] = buckets.map((arr, idx) => {
      if (arr.length === 0) return CORPUS_MONTHLY_INDEX[idx] ?? 1;
      const sum = arr.reduce((s, v) => s + v, 0);
      return sum / arr.length;
    });
    return { itemCurve: itemCurve as SeasonalCurve };
  }

  /** Builds the trailing monthly-consumption array (oldest first) used by
   *  the layered safety-stock formula. Reads `normalizedConsumption` from
   *  ConsumptionSnapshot to get working-day-normalized values. */
  private buildMonthlyHistoryForSafety(
    history: Array<{
      year: number;
      month: number;
      normalizedConsumption: number;
      seasonalFactor: number;
    }>,
    now: Date,
  ): number[] {
    if (!history || history.length === 0) return [];
    // Trailing 12 months, oldest-first, only non-vacation already since
    // backfill skips full-vacation months.
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 12, 1);
    const series = history
      .filter(
        r => new Date(r.year, r.month, 1) >= cutoff && !isVacationDistortedMonth(r.year, r.month),
      )
      .sort((a, b) => (a.year - b.year) * 12 + (a.month - b.month))
      .map(r => r.normalizedConsumption);
    // Exclude vacation-distorted months (above) + winsorize so a contaminated
    // month doesn't blow up σ.
    return winsorizeConsumptionSeries(series);
  }
}
