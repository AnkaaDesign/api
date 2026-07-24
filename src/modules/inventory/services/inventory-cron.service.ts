import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  ABC_CATEGORY,
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  ITEM_CATEGORY_TYPE,
  ORDER_STATUS,
  XYZ_CATEGORY,
} from '@/constants/enums';
import {
  DORMANT_ITEM_MONTHS_THRESHOLD,
  ITEM_SIMILARITY_THRESHOLD,
  MAX_SIMILAR_ITEMS_TO_CHECK,
  PPE_CONSUMPTION_REASONS,
  REGULAR_CONSUMPTION_REASONS,
} from '@/constants/inventory-config';
import { CORPUS_MONTHLY_INDEX } from '@/constants/seasonality-config';
import {
  applyTrendAdjustment,
  calculateConsumptionTrend,
  calculateLeadTime,
  calculateMaxQuantity,
  calculateMonthlyConsumption,
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
import { classifyAbc, classifyXyz, type AbcInput, type XyzInput } from '@/utils/abc-xyz';
import {
  computeSeasonalProfile,
  type SeasonalCurve,
} from '@/utils/seasonality';
import {
  detectSaturdayShifts,
  isVacationDistortedMonth,
  workingDaysForMonth,
} from '@/utils/working-days';

// ---------------------------------------------------------------------------
// Types used across the nightly recompute pipeline
// ---------------------------------------------------------------------------

type ItemRecord = Awaited<ReturnType<PrismaService['item']['findMany']>>[number] & {
  category: { id: string; type: ITEM_CATEGORY_TYPE | null; name?: string } | null;
};

interface ItemActivities {
  itemId: string;
  activities: Array<{
    operation: ACTIVITY_OPERATION;
    reason: ACTIVITY_REASON;
    quantity: number;
    createdAt: Date;
  }>;
}

interface RecomputeOutcome {
  itemId: string;
  monthlyConsumption: number;
  monthlyConsumptionTrendPercent: number | null;
  estimatedLeadTime: number;
  reorderPoint: number | null;
  maxQuantity: number | null;
  reorderQuantity: number | null;
  abcCategory: ABC_CATEGORY | null;
  abcCategoryOrder: number | null;
  xyzCategory: XYZ_CATEGORY | null;
  xyzCategoryOrder: number | null;
  ordersLast12Months: number;
}

@Injectable()
export class InventoryCronService {
  private readonly logger = new Logger(InventoryCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  // =====================
  // Monthly Consumption Snapshots
  // =====================

  /**
   * Creates monthly consumption snapshots for all active items.
   * Runs on the 1st of every month at 02:00 SP.
   *
   * On top of the previous-month consumption row, this also (re)computes the
   * per-item seasonal factor using the smoothing + shrinkage pipeline from
   * `computeSeasonalProfile` (spec §6.3) so the next nightly recompute can
   * resolve seasonal factors against fresh data.
   */
  @Cron('0 2 1 * *', { timeZone: 'America/Sao_Paulo' })
  async createMonthlyConsumptionSnapshots(): Promise<{
    total: number;
    created: number;
    errors: number;
  }> {
    this.logger.log('Starting monthly consumption snapshot creation...');

    // Snapshot the PREVIOUS month
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const activeItems = await this.prisma.item.findMany({
      where: { isActive: true },
      select: { id: true, createdAt: true },
    });

    let created = 0;
    let errors = 0;

    const batchSize = 50;
    for (let i = 0; i < activeItems.length; i += batchSize) {
      const batch = activeItems.slice(i, i + batchSize);

      const promises = batch.map(async item => {
        try {
          await this.buildSnapshotForItemMonth(item.id, year, month);
          created++;
        } catch (error) {
          errors++;
          this.logger.error(
            `Error creating snapshot for item ${item.id}: ${error instanceof Error ? error.message : 'Unknown'}`,
          );
        }
      });

      await Promise.all(promises);
    }

    this.logger.log(
      `Consumption snapshots complete: ${created} created, ${errors} errors out of ${activeItems.length} items for ${year}-${month + 1}`,
    );

    return { total: activeItems.length, created, errors };
  }

  /**
   * Build (upsert) the ConsumptionSnapshot for one item + one calendar month
   * (0-indexed `month`, JS getMonth() convention). Single source of truth for
   * the snapshot aggregation — reused by `createMonthlyConsumptionSnapshots`
   * (previous month) and by the backfill script (arbitrary months). Reads
   * Activity only; NEVER writes stock. Idempotent (upsert on itemId_year_month).
   */
  async buildSnapshotForItemMonth(itemId: string, year: number, month: number): Promise<void> {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

    // PPE_DELIVERY is included so ON_DEMAND PPE items accumulate accurate
    // history; REGULAR items never carry it, so this is additive-only.
    const snapshotReasons = [
      ...new Set([...REGULAR_CONSUMPTION_REASONS, ACTIVITY_REASON.PPE_DELIVERY]),
    ] as ACTIVITY_REASON[];
    const activities = await this.prisma.activity.findMany({
      where: {
        itemId,
        operation: ACTIVITY_OPERATION.OUTBOUND,
        reason: { in: snapshotReasons },
        createdAt: { gte: monthStart, lte: monthEnd },
      },
      select: { quantity: true, reason: true, operation: true, createdAt: true },
    });

    const totalConsumption = activities.reduce((sum, a) => sum + a.quantity, 0);
    const consumptionCount = activities.length;

    // Working-day count respects Saturday-shift detection + the vacation
    // calendar (workingDaysForMonth subtracts VACATION_PERIOD days).
    const saturdayShifts = detectSaturdayShifts(
      activities.map(a => ({
        operation: a.operation,
        reason: a.reason,
        createdAt: a.createdAt,
      })),
      REGULAR_CONSUMPTION_REASONS,
    );
    const workingDays = workingDaysForMonth(year, month, saturdayShifts);

    const seasonalFactor = await this.computeItemSeasonalFactor(
      itemId,
      year,
      month,
      totalConsumption,
      workingDays,
    );

    const normalizedConsumption =
      workingDays > 0 ? (totalConsumption / workingDays) * 20 : totalConsumption;

    await this.prisma.consumptionSnapshot.upsert({
      where: { itemId_year_month: { itemId, year, month } },
      create: {
        itemId,
        year,
        month,
        totalConsumption,
        consumptionCount,
        normalizedConsumption,
        workingDays,
        seasonalFactor,
      },
      update: {
        totalConsumption,
        consumptionCount,
        normalizedConsumption,
        workingDays,
        seasonalFactor,
      },
    });
  }

  /**
   * Builds the per-item seasonal curve from the trailing 12 snapshots
   * (including the just-computed month) and returns the factor for
   * `month`. Falls back to the corpus curve when eligibility fails.
   */
  private async computeItemSeasonalFactor(
    itemId: string,
    year: number,
    month: number,
    totalConsumption: number,
    workingDays: number,
  ): Promise<number> {
    // Pull the 12 most recent snapshots; we'll merge in the just-computed
    // month so it participates in the curve before the upsert finishes.
    const history = await this.prisma.consumptionSnapshot.findMany({
      where: { itemId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: 24,
      select: { year: true, month: true, normalizedConsumption: true },
    });

    const normalized = workingDays > 0 ? (totalConsumption / workingDays) * 20 : totalConsumption;
    const seenKeys = new Set<string>();
    const merged: Array<{ year: number; month: number; consumption: number }> = [];
    merged.push({ year, month, consumption: normalized });
    seenKeys.add(`${year}-${month}`);
    for (const row of history) {
      const key = `${row.year}-${row.month}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      merged.push({ year: row.year, month: row.month, consumption: row.normalizedConsumption });
    }
    // Chronological order, oldest first (computeSeasonalProfile expects that).
    merged.sort((a, b) => (a.year - b.year) * 12 + (a.month - b.month));

    const curve = computeSeasonalProfile(merged, CORPUS_MONTHLY_INDEX);
    if (curve && curve.length === 12) return curve[month] ?? 1;
    return CORPUS_MONTHLY_INDEX[month] ?? 1;
  }

  // =====================
  // Nightly recompute (02:30 SP)
  // =====================

  /**
   * Nightly authoritative recompute. For every active item it persists:
   *   monthlyConsumption, monthlyConsumptionTrendPercent,
   *   reorderPoint, maxQuantity, reorderQuantity,
   *   abcCategory, abcCategoryOrder, xyzCategory, xyzCategoryOrder,
   *   ordersLast12Months.
   *
   * Writes are batched in transactions of ~100 items per chunk.
   */
  @Cron('30 2 * * *', { timeZone: 'America/Sao_Paulo' })
  async runNightlyRecompute(): Promise<{
    total: number;
    updated: number;
    errors: number;
  }> {
    this.logger.log('Starting nightly inventory recompute...');

    // Refresh `lastUsedAt` for all items first — keeps the daily refresh
    // semantics that the previous cron entry guaranteed.
    await this.refreshLastUsedDates();

    const now = new Date();
    const items = await this.prisma.item.findMany({
      where: { isActive: true },
      include: { category: { select: { id: true, type: true, name: true } } },
    });

    if (items.length === 0) {
      this.logger.log('Nightly recompute: no active items.');
      return { total: 0, updated: 0, errors: 0 };
    }

    // Pre-load shared data: activities, recent order receipts, current orders.
    const lookbackStart = new Date(now);
    lookbackStart.setMonth(lookbackStart.getMonth() - 12);

    const itemIds = items.map(i => i.id);
    const supplierIds = Array.from(
      new Set(items.map(i => i.supplierId).filter((v): v is string => !!v)),
    );

    // Include PPE_DELIVERY so PPE items get their histTrailing12mo populated.
    // Regular items never have PPE_DELIVERY activities, so the regular path is unaffected.
    const allConsumptionReasons = [
      ...new Set([...REGULAR_CONSUMPTION_REASONS, ...PPE_CONSUMPTION_REASONS]),
    ] as ACTIVITY_REASON[];

    const [activities, orderItems, snapshotsByItem, latestPrices] = await Promise.all([
      this.prisma.activity.findMany({
        where: {
          itemId: { in: itemIds },
          operation: ACTIVITY_OPERATION.OUTBOUND,
          reason: { in: allConsumptionReasons },
          createdAt: { gte: lookbackStart },
        },
        select: { itemId: true, operation: true, reason: true, quantity: true, createdAt: true },
      }),
      this.prisma.orderItem.findMany({
        where: {
          itemId: { in: itemIds },
          order: { createdAt: { gte: lookbackStart } },
        },
        select: {
          itemId: true,
          orderId: true,
          orderedQuantity: true,
          receivedQuantity: true,
          receivedAt: true,
          fulfilledAt: true,
          price: true,
          createdAt: true,
          order: {
            select: { id: true, status: true, supplierId: true, createdAt: true },
          },
        },
      }),
      this.loadSnapshotsByItem(itemIds),
      this.loadLatestPrices(itemIds),
    ]);

    // Group activities by item
    const activitiesByItem = new Map<string, ItemActivities['activities']>();
    for (const a of activities) {
      if (!a.itemId) continue;
      let bucket = activitiesByItem.get(a.itemId);
      if (!bucket) {
        bucket = [];
        activitiesByItem.set(a.itemId, bucket);
      }
      bucket.push({
        operation: a.operation as ACTIVITY_OPERATION,
        reason: a.reason as ACTIVITY_REASON,
        quantity: a.quantity,
        createdAt: a.createdAt,
      });
    }

    // Build supplier-level clean lead-time samples (spec §5).
    const supplierCleanLeadTimes = this.buildSupplierLeadTimeSamples(orderItems, supplierIds);

    // Compute order-count + active-incoming + per-item clean lead-times.
    const orderStats = this.summarizeOrders(orderItems);

    // First pass: compute mc + trend per item (needed for ABC/XYZ ranking).
    const partials: Array<{
      item: ItemRecord;
      mc: number;
      trendPercent: number | null;
      leadTime: number;
      unitPrice: number;
      monthlyHistory: number[];
      ordersLast12Months: number;
    }> = [];

    for (const item of items as ItemRecord[]) {
      try {
        const itemActivities = activitiesByItem.get(item.id) ?? [];
        const seasonalCtx = this.buildSeasonalContext(snapshotsByItem.get(item.id));

        const isPpeItem = item.ppeType != null;
        const histTrailing12mo = isPpeItem
          ? itemActivities
              .filter(a => (PPE_CONSUMPTION_REASONS as string[]).includes(a.reason))
              .reduce((sum, a) => sum + a.quantity, 0)
          : undefined;

        const mcResult = calculateMonthlyConsumption({
          item: this.toItemLike(item),
          activities: itemActivities,
          now,
          seasonalCtx,
          ...(isPpeItem && { ppe: { histTrailing12mo } }),
        });

        const monthlyHistory = this.buildMonthlyHistory(snapshotsByItem.get(item.id), now);
        const trendRaw = calculateConsumptionTrend(
          monthlyHistory.map(h => ({
            year: h.year,
            month: h.month,
            consumption: h.consumption,
          })),
        );

        const stats = orderStats.get(item.id);
        const itemCleanLeadTimes = stats?.itemCleanLeadTimes ?? [];
        const supplierLeadTimes = item.supplierId
          ? supplierCleanLeadTimes.get(item.supplierId) ?? []
          : [];

        const leadTime = calculateLeadTime({
          itemCleanLeadTimes,
          supplierCleanLeadTimes: supplierLeadTimes,
        });

        partials.push({
          item,
          mc: mcResult.monthlyConsumption,
          trendPercent: monthlyHistory.length >= 6 ? trendRaw : null,
          leadTime,
          unitPrice: stats?.latestPrice ?? latestPrices.get(item.id) ?? 0,
          monthlyHistory: monthlyHistory.map(h => h.consumption),
          ordersLast12Months: stats?.distinctOrderCount ?? 0,
        });
      } catch (error) {
        this.logger.error(
          `Error in nightly mc pass for item ${item.id}: ${error instanceof Error ? error.message : 'Unknown'}`,
        );
      }
    }

    // Classification passes (ABC + XYZ are ranking ops over the whole set).
    const abcInputs: AbcInput[] = partials.map(p => ({
      itemId: p.item.id,
      monthlyConsumption: p.mc,
      unitPrice: p.unitPrice,
      eligible: p.item.stockModel === 'CONSUMPTION' && p.mc > 0,
    }));
    const xyzInputs: XyzInput[] = partials.map(p => ({
      itemId: p.item.id,
      trailingMonthlyConsumption: p.monthlyHistory,
      eligible: p.item.stockModel === 'CONSUMPTION',
    }));

    const abcAssignments = new Map(
      classifyAbc(abcInputs).map(a => [a.itemId, a] as const),
    );
    const xyzAssignments = new Map(
      classifyXyz(xyzInputs).map(x => [x.itemId, x] as const),
    );

    // Second pass: rp/max/reorderQty using the now-known classifications.
    const outcomes: RecomputeOutcome[] = [];
    for (const p of partials) {
      try {
        const abc = abcAssignments.get(p.item.id);
        const xyz = xyzAssignments.get(p.item.id);
        const baseCell = resolveSafetyTargetCell(
          abc?.category ?? null,
          xyz?.category ?? null,
          p.ordersLast12Months,
        );
        // Kept for back-compat call surface but ignored when safetyStock is passed.
        const safetyFactor = applyTrendAdjustment(baseCell.safetyFactor, p.trendPercent ?? 0);

        const seasonalCtx = this.buildSeasonalContext(snapshotsByItem.get(p.item.id));
        const itemLike = this.toItemLike(p.item);

        // Layered safety stock (z×σ×√LT for ≥6mo; bumped matrix at 3–5mo;
        // UNCLASSIFIED otherwise).
        const safetyResult = calculateSafetyStock({
          monthlyConsumption: p.mc,
          leadTimeDays: p.leadTime,
          abcCategory: abc?.category ?? null,
          xyzCategory: xyz?.category ?? null,
          monthlyHistory: p.monthlyHistory,
          trendPercent: p.trendPercent ?? 0,
        });

        const reorderPoint = calculateReorderPoint({
          item: itemLike,
          monthlyConsumption: p.mc,
          leadTimeDays: p.leadTime,
          safetyFactor,
          safetyStock: safetyResult.safetyStock,
          seasonalCtx,
          now,
        });

        const maxQuantity = calculateMaxQuantity({
          item: itemLike,
          monthlyConsumption: p.mc,
          leadTimeDays: p.leadTime,
          reorderPoint,
          targetStockDays: baseCell.targetStockDays,
          // Per-item absolute coverage override (e.g. "hold ~2 months") wins over
          // the matrix, even during the transient UNCLASSIFIED window.
          overrideCoverageDays: p.item.targetCoverageDays ?? null,
          seasonalCtx,
          now,
        });

        const stats = orderStats.get(p.item.id);
        const incomingOrderedQuantity = stats?.incomingOrderedQuantity ?? 0;

        const reorderQuantity = calculateReorderQuantity({
          currentStock: p.item.quantity,
          maxQuantity,
          incomingOrderedQuantity,
          boxQuantity: p.item.boxQuantity ?? null,
        });

        outcomes.push({
          itemId: p.item.id,
          monthlyConsumption: p.mc,
          monthlyConsumptionTrendPercent:
            p.trendPercent == null ? null : round2(p.trendPercent),
          estimatedLeadTime: p.leadTime,
          reorderPoint,
          maxQuantity,
          reorderQuantity,
          abcCategory: abc?.category ?? null,
          abcCategoryOrder: abc?.order ?? null,
          xyzCategory: xyz?.category ?? null,
          xyzCategoryOrder: xyz?.order ?? null,
          ordersLast12Months: p.ordersLast12Months,
        });
      } catch (error) {
        this.logger.error(
          `Error in nightly rp/max pass for item ${p.item.id}: ${error instanceof Error ? error.message : 'Unknown'}`,
        );
      }
    }

    // Write back in chunks of ~100 items per transaction.
    let updated = 0;
    let errors = 0;
    const chunkSize = 100;
    for (let i = 0; i < outcomes.length; i += chunkSize) {
      const chunk = outcomes.slice(i, i + chunkSize);
      try {
        await this.prisma.$transaction(
          chunk.map(o =>
            this.prisma.item.update({
              where: { id: o.itemId },
              // Cast: `ordersLast12Months` was added in Phase 1 of the
              // stock-management refactor — the generated Prisma client
              // typings will pick it up after `prisma generate`.
              data: {
                monthlyConsumption: new Prisma.Decimal(o.monthlyConsumption),
                monthlyConsumptionTrendPercent:
                  o.monthlyConsumptionTrendPercent == null
                    ? null
                    : new Prisma.Decimal(o.monthlyConsumptionTrendPercent),
                estimatedLeadTime: o.estimatedLeadTime,
                reorderPoint: o.reorderPoint,
                maxQuantity: o.maxQuantity,
                reorderQuantity: o.reorderQuantity,
                abcCategory: o.abcCategory,
                abcCategoryOrder: o.abcCategoryOrder,
                xyzCategory: o.xyzCategory,
                xyzCategoryOrder: o.xyzCategoryOrder,
                ordersLast12Months: o.ordersLast12Months,
              } as Prisma.ItemUncheckedUpdateInput,
            }),
          ),
        );
        updated += chunk.length;
      } catch (error) {
        errors += chunk.length;
        this.logger.error(
          `Error persisting nightly recompute chunk [${i}..${i + chunk.length - 1}]: ${error instanceof Error ? error.message : 'Unknown'}`,
        );
      }
    }

    this.logger.log(
      `Nightly recompute complete: ${updated} updated, ${errors} errors of ${items.length} items.`,
    );

    return { total: items.length, updated, errors };
  }

  // =====================
  // Dormant Item Detection & Auto-Disable
  // =====================

  /**
   * Detects dormant consumption-model items and auto-disables them if a
   * similar active replacement exists. Also reactivates previously-deactivated
   * items that show fresh consumption activity (bidirectional lifecycle,
   * spec §12). Runs weekly on Sunday at 3 AM.
   *
   * Scope: `stockModel = CONSUMPTION AND ppeType IS NULL`. Fixed-target items
   * (durable / lumpy goods) and PPE never auto-deactivate or reactivate
   * (spec §16).
   */
  @Cron('0 3 * * 0', { timeZone: 'America/Sao_Paulo' })
  async detectAndDisableDormantItems(): Promise<{
    scanned: number;
    dormantFound: number;
    autoDisabled: number;
    reactivated: number;
    errors: number;
  }> {
    this.logger.log('Starting dormant item detection...');

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - DORMANT_ITEM_MONTHS_THRESHOLD);

    const activeItems = await this.prisma.item.findMany({
      where: { isActive: true, stockModel: 'CONSUMPTION', ppeType: null },
      select: {
        id: true,
        name: true,
        categoryId: true,
        supplierId: true,
        quantity: true,
        lastUsedAt: true,
        stockModel: true,
        ppeType: true,
      },
    });

    let dormantFound = 0;
    let autoDisabled = 0;
    let errors = 0;

    for (const item of activeItems) {
      try {
        // Defensive re-check of the where-clause scope: fixed-target items and
        // PPE never auto-deactivate (spec §16).
        if (item.stockModel !== 'CONSUMPTION' || item.ppeType != null) {
          continue;
        }

        const recentActivity = await this.prisma.activity.findFirst({
          where: {
            itemId: item.id,
            operation: ACTIVITY_OPERATION.OUTBOUND,
            reason: { in: REGULAR_CONSUMPTION_REASONS as ACTIVITY_REASON[] },
            createdAt: { gte: cutoffDate },
          },
        });

        if (recentActivity) {
          if (!item.lastUsedAt || new Date(recentActivity.createdAt) > new Date(item.lastUsedAt)) {
            await this.prisma.item.update({
              where: { id: item.id },
              data: { lastUsedAt: recentActivity.createdAt },
            });
          }
          continue;
        }

        // Item is dormant
        dormantFound++;

        const similarItems = await this.findSimilarActiveItems(
          item.id,
          item.name,
          item.categoryId,
          cutoffDate,
        );

        if (similarItems.length > 0) {
          const bestMatch = similarItems[0];

          await this.prisma.item.update({
            where: { id: item.id },
            data: {
              isActive: false,
              deactivatedAt: new Date(),
              deactivationReason: `Desativado automaticamente: sem uso por ${DORMANT_ITEM_MONTHS_THRESHOLD} meses. Item similar ativo encontrado: "${bestMatch.name}" (similaridade: ${(bestMatch.similarity * 100).toFixed(0)}%)`,
            },
          });

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.ITEM,
            entityId: item.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'isActive',
            oldValue: true,
            newValue: false,
            reason: `Desativado automaticamente: sem uso por ${DORMANT_ITEM_MONTHS_THRESHOLD}+ meses. Possível substituição: "${bestMatch.name}" (${(bestMatch.similarity * 100).toFixed(0)}% similar)`,
            triggeredBy: CHANGE_TRIGGERED_BY.AUTOMATIC_MIN_MAX_UPDATE,
            triggeredById: item.id,
            userId: null,
          });

          autoDisabled++;
          this.logger.log(
            `Auto-disabled dormant item "${item.name}" (${item.id}), replacement: "${bestMatch.name}"`,
          );
        }
      } catch (error) {
        errors++;
        this.logger.error(
          `Error processing dormant check for item ${item.id}: ${error instanceof Error ? error.message : 'Unknown'}`,
        );
      }
    }

    // ---------------------------------------------------------------------
    // Reactivation pass — bidirectional lifecycle (spec §12).
    // Finds consumption-model, non-PPE items that are currently
    // isActive=false but have shown genuine consumption inside the dormancy
    // window. Excludes fixed-target items and PPE (never auto-managed) and
    // items deactivated within the last 7 days
    // (anti-bounce buffer — avoids flapping when a stale activity backfill
    // races with the deactivation it triggered).
    // ---------------------------------------------------------------------
    const REACTIVATION_BUFFER_DAYS = 7;
    const reactivationBufferDate = new Date();
    reactivationBufferDate.setDate(
      reactivationBufferDate.getDate() - REACTIVATION_BUFFER_DAYS,
    );

    // Tight "real consumption" reasons — excludes INVENTORY_COUNT and
    // MANUAL_ADJUSTMENT so bookkeeping corrections never trigger reactivation.
    const REACTIVATION_REASONS: ACTIVITY_REASON[] = [
      ACTIVITY_REASON.PRODUCTION_USAGE,
      ACTIVITY_REASON.PPE_DELIVERY,
      ACTIVITY_REASON.MAINTENANCE,
      ACTIVITY_REASON.EXTERNAL_OPERATION,
      ACTIVITY_REASON.DAMAGE,
      ACTIVITY_REASON.LOSS,
    ];

    const inactiveCandidates = await this.prisma.item.findMany({
      where: {
        isActive: false,
        stockModel: 'CONSUMPTION',
        ppeType: null,
        deactivatedAt: { lt: reactivationBufferDate },
      },
      select: {
        id: true,
        name: true,
        deactivatedAt: true,
      },
    });

    let reactivated = 0;
    for (const item of inactiveCandidates) {
      try {
        const recentConsumption = await this.prisma.activity.findFirst({
          where: {
            itemId: item.id,
            operation: ACTIVITY_OPERATION.OUTBOUND,
            reason: { in: REACTIVATION_REASONS },
            createdAt: { gte: cutoffDate },
          },
          select: { id: true, createdAt: true },
        });

        if (!recentConsumption) continue;

        await this.prisma.item.update({
          where: { id: item.id },
          data: {
            isActive: true,
            deactivatedAt: null,
            deactivationReason: null,
            lastUsedAt: recentConsumption.createdAt,
          },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ITEM,
          entityId: item.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'isActive',
          oldValue: false,
          newValue: true,
          reason: `Reativado automaticamente: consumo recente detectado (${recentConsumption.createdAt.toISOString().slice(0, 10)}) dentro da janela de ${DORMANT_ITEM_MONTHS_THRESHOLD} meses.`,
          triggeredBy: CHANGE_TRIGGERED_BY.AUTOMATIC_MIN_MAX_UPDATE,
          triggeredById: item.id,
          userId: null,
        });

        reactivated++;
        this.logger.log(
          `Reactivated item "${item.name}" (${item.id}) — recent consumption at ${recentConsumption.createdAt.toISOString()}`,
        );
      } catch (error) {
        errors++;
        this.logger.error(
          `Error processing reactivation for item ${item.id}: ${error instanceof Error ? error.message : 'Unknown'}`,
        );
      }
    }

    this.logger.log(
      `Dormant item detection complete: ${activeItems.length} scanned, ${dormantFound} dormant found, ${autoDisabled} auto-disabled, ${reactivated} reactivated, ${errors} errors`,
    );

    return {
      scanned: activeItems.length,
      dormantFound,
      autoDisabled,
      reactivated,
      errors,
    };
  }

  /**
   * Updates lastUsedAt for all active items based on their most recent
   * consumption activity. Public-callable; the nightly recompute invokes
   * this at the top of its run as well.
   */
  async refreshLastUsedDates(): Promise<void> {
    this.logger.log('Refreshing lastUsedAt for all items...');

    try {
      await this.prisma.$executeRaw`
        UPDATE "Item" i
        SET "lastUsedAt" = sub.max_date
        FROM (
          SELECT "itemId", MAX("createdAt") as max_date
          FROM "Activity"
          WHERE "operation" = 'OUTBOUND'
            AND "reason" IN ('PRODUCTION_USAGE', 'PPE_DELIVERY', 'MAINTENANCE', 'PAINT_PRODUCTION', 'EXTERNAL_OPERATION')
          GROUP BY "itemId"
        ) sub
        WHERE i.id = sub."itemId"
          AND (i."lastUsedAt" IS NULL OR i."lastUsedAt" < sub.max_date)
      `;

      this.logger.log('lastUsedAt update completed');
    } catch (error) {
      this.logger.error('Failed to update lastUsedAt dates:', error);
    }
  }

  // =====================
  // Internal — nightly recompute helpers
  // =====================

  /** Loads up to 13 most-recent snapshots per item, keyed by itemId. */
  private async loadSnapshotsByItem(
    itemIds: string[],
  ): Promise<Map<string, Array<{ year: number; month: number; normalizedConsumption: number; seasonalFactor: number }>>> {
    if (itemIds.length === 0) return new Map();
    const snapshots = await this.prisma.consumptionSnapshot.findMany({
      where: { itemId: { in: itemIds } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: {
        itemId: true,
        year: true,
        month: true,
        normalizedConsumption: true,
        seasonalFactor: true,
      },
    });

    const map = new Map<string, Array<{ year: number; month: number; normalizedConsumption: number; seasonalFactor: number }>>();
    for (const row of snapshots) {
      let bucket = map.get(row.itemId);
      if (!bucket) {
        bucket = [];
        map.set(row.itemId, bucket);
      }
      // Cap at 24 months per item (oldest dropped).
      if (bucket.length < 24) {
        bucket.push({
          year: row.year,
          month: row.month,
          normalizedConsumption: row.normalizedConsumption,
          seasonalFactor: row.seasonalFactor,
        });
      }
    }
    return map;
  }

  /** Latest known unit price per item — most recent OrderItem.price. */
  private async loadLatestPrices(itemIds: string[]): Promise<Map<string, number>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.prisma.orderItem.findMany({
      where: { itemId: { in: itemIds }, price: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      select: { itemId: true, price: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.itemId) continue;
      if (!map.has(r.itemId)) map.set(r.itemId, r.price);
    }
    return map;
  }

  /**
   * Builds the seasonal context for an item from its historical snapshots.
   * Reuses persisted per-month seasonal factors when present; the corpus
   * curve from `seasonality-config` is the last-resort fallback handled
   * inside `resolveSeasonalFactor`.
   */
  private buildSeasonalContext(
    history?: Array<{ year: number; month: number; normalizedConsumption: number; seasonalFactor: number }>,
  ): SeasonalContext | undefined {
    if (!history || history.length === 0) return undefined;

    // Aggregate per-calendar-month seasonalFactor as the per-item curve when
    // we have data; otherwise leave it null and let the corpus fallback fire.
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

  /** Returns trailing-12 monthly history from snapshots, oldest-first. */
  private buildMonthlyHistory(
    history: Array<{ year: number; month: number; normalizedConsumption: number; seasonalFactor: number }> | undefined,
    now: Date,
  ): Array<{ year: number; month: number; consumption: number }> {
    if (!history || history.length === 0) return [];
    const sorted = [...history].sort(
      (a, b) => (a.year - b.year) * 12 + (a.month - b.month),
    );
    // Keep at most the trailing 12 calendar months from `now`, EXCLUDING
    // vacation-shortened months whose ×20/workingDays normalization inflates
    // them (not representative demand — would corrupt σ and the XYZ CV).
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 12, 1);
    const kept = sorted.filter(
      r => new Date(r.year, r.month, 1) >= cutoff && !isVacationDistortedMonth(r.year, r.month),
    );
    // Winsorize the consumption values so a single contaminated/vacation-
    // inflated month can't dominate the XYZ coefficient-of-variation or the
    // safety-stock σ. Zeros are preserved; year/month alignment is unchanged.
    const winsorized = winsorizeConsumptionSeries(kept.map(r => r.normalizedConsumption));
    return kept.map((r, i) => ({ year: r.year, month: r.month, consumption: winsorized[i] }));
  }

  /**
   * Bundles per-item order metrics for the trailing 12 months:
   *   - distinct order count (`ordersLast12Months`)
   *   - sum of (ordered − received) on non-CANCELLED / non-RECEIVED orders
   *   - clean lead-time samples (spec §5.2 cleanliness filter)
   *   - most-recent unit price
   */
  private summarizeOrders(
    orderItems: ReadonlyArray<{
      itemId: string | null;
      orderId: string;
      orderedQuantity: number;
      receivedQuantity: number;
      receivedAt: Date | null;
      fulfilledAt: Date | null;
      price: number;
      createdAt: Date;
      order: {
        id: string;
        status: ORDER_STATUS | string;
        supplierId: string | null;
        createdAt: Date;
      };
    }>,
  ): Map<
    string,
    {
      distinctOrderCount: number;
      incomingOrderedQuantity: number;
      itemCleanLeadTimes: number[];
      latestPrice: number | null;
    }
  > {
    const result = new Map<
      string,
      {
        distinctOrderCount: number;
        incomingOrderedQuantity: number;
        itemCleanLeadTimes: number[];
        latestPrice: number | null;
        orderIds: Set<string>;
        latestPriceAt: Date | null;
      }
    >();

    for (const oi of orderItems) {
      if (!oi.itemId) continue;
      let entry = result.get(oi.itemId);
      if (!entry) {
        entry = {
          distinctOrderCount: 0,
          incomingOrderedQuantity: 0,
          itemCleanLeadTimes: [],
          latestPrice: null,
          orderIds: new Set<string>(),
          latestPriceAt: null,
        };
        result.set(oi.itemId, entry);
      }

      entry.orderIds.add(oi.orderId);

      const status = oi.order.status as ORDER_STATUS;
      const isPending =
        status !== ORDER_STATUS.CANCELLED && status !== ORDER_STATUS.RECEIVED;
      if (isPending) {
        const remaining = oi.orderedQuantity - oi.receivedQuantity;
        if (remaining > 0) entry.incomingOrderedQuantity += remaining;
      }

      if (oi.receivedAt) {
        if (!isLegacyBulkReceipt(oi.order.supplierId, oi.receivedAt)) {
          const startDate = leadTimeClockStart(
            oi.fulfilledAt,
            oi.receivedAt,
            oi.order.createdAt,
          );
          const days = Math.max(
            0,
            (oi.receivedAt.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
          );
          entry.itemCleanLeadTimes.push(days);
        }
      }

      if (oi.price > 0) {
        if (!entry.latestPriceAt || oi.createdAt > entry.latestPriceAt) {
          entry.latestPrice = oi.price;
          entry.latestPriceAt = oi.createdAt;
        }
      }
    }

    const out = new Map<
      string,
      {
        distinctOrderCount: number;
        incomingOrderedQuantity: number;
        itemCleanLeadTimes: number[];
        latestPrice: number | null;
      }
    >();
    for (const [itemId, v] of result) {
      out.set(itemId, {
        distinctOrderCount: v.orderIds.size,
        incomingOrderedQuantity: v.incomingOrderedQuantity,
        itemCleanLeadTimes: v.itemCleanLeadTimes,
        latestPrice: v.latestPrice,
      });
    }
    return out;
  }

  /** Supplier-level p90 sample pool for the lead-time tier-2 fallback. */
  private buildSupplierLeadTimeSamples(
    orderItems: ReadonlyArray<{
      itemId: string | null;
      orderId: string;
      receivedAt: Date | null;
      fulfilledAt: Date | null;
      order: { id: string; supplierId: string | null; createdAt: Date };
    }>,
    supplierIds: string[],
  ): Map<string, number[]> {
    const map = new Map<string, number[]>();
    for (const sid of supplierIds) map.set(sid, []);
    for (const oi of orderItems) {
      const supplierId = oi.order.supplierId;
      if (!supplierId) continue;
      if (!oi.receivedAt) continue;
      if (isLegacyBulkReceipt(supplierId, oi.receivedAt)) continue;
      const startDate = leadTimeClockStart(
        oi.fulfilledAt,
        oi.receivedAt,
        oi.order.createdAt,
      );
      const days =
        (oi.receivedAt.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      if (days < 0) continue;
      const bucket = map.get(supplierId) ?? [];
      bucket.push(days);
      map.set(supplierId, bucket);
    }
    return map;
  }

  /** Converts a Prisma `Item` row (with category include) to the engine's
   *  `ItemLike` shape required by the stock-health utils. */
  private toItemLike(item: ItemRecord): ItemLike {
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
      category: item.category
        ? { type: (item.category.type as ITEM_CATEGORY_TYPE | null) ?? null }
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

  // =====================
  // Similarity Detection
  // =====================

  private async findSimilarActiveItems(
    excludeItemId: string,
    itemName: string,
    categoryId: string | null,
    usedAfterDate: Date,
  ): Promise<Array<{ id: string; name: string; similarity: number }>> {
    const normalizedName = this.normalizeName(itemName);
    const nameWords = normalizedName.split(/\s+/).filter(w => w.length > 2);

    if (nameWords.length === 0) {
      return [];
    }

    const candidateWhere: Prisma.ItemWhereInput = {
      id: { not: excludeItemId },
      isActive: true,
    };

    if (categoryId) {
      candidateWhere.categoryId = categoryId;
    }

    const candidates = await this.prisma.item.findMany({
      where: candidateWhere,
      select: { id: true, name: true },
      take: 100,
    });

    const scored = candidates
      .map(candidate => ({
        id: candidate.id,
        name: candidate.name,
        similarity: this.calculateNameSimilarity(
          normalizedName,
          this.normalizeName(candidate.name),
        ),
      }))
      .filter(c => c.similarity >= ITEM_SIMILARITY_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, MAX_SIMILAR_ITEMS_TO_CHECK);

    const verifiedSimilar: Array<{ id: string; name: string; similarity: number }> = [];

    for (const candidate of scored) {
      const recentUsage = await this.prisma.activity.findFirst({
        where: {
          itemId: candidate.id,
          operation: ACTIVITY_OPERATION.OUTBOUND,
          reason: { in: REGULAR_CONSUMPTION_REASONS as ACTIVITY_REASON[] },
          createdAt: { gte: usedAfterDate },
        },
      });

      if (recentUsage) {
        verifiedSimilar.push(candidate);
      }
    }

    return verifiedSimilar;
  }

  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private calculateNameSimilarity(name1: string, name2: string): number {
    const words1 = new Set(name1.split(/\s+/).filter(w => w.length > 1));
    const words2 = new Set(name2.split(/\s+/).filter(w => w.length > 1));

    if (words1.size === 0 || words2.size === 0) return 0;

    let intersection = 0;
    for (const word of words1) {
      if (words2.has(word)) {
        intersection++;
      } else {
        for (const w2 of words2) {
          if (word.includes(w2) || w2.includes(word) || this.levenshteinDistance(word, w2) <= 1) {
            intersection += 0.7;
            break;
          }
        }
      }
    }

    const union = words1.size + words2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  private levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b[i - 1] === a[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
