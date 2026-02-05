import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ENTITY_TYPE,
  CHANGE_TRIGGERED_BY,
  ORDER_STATUS,
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
} from '@/constants/enums';
import { subDays, subMonths, differenceInDays } from 'date-fns';
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
  isEmergencyOverride: boolean; // True if auto-ordering despite being in schedule
}

interface AutoOrderRecommendation {
  supplierId: string | null;
  supplierName: string;
  items: DemandAnalysis[];
  totalValue: number;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  consolidatedReasons: string[];
}

interface WeightedConsumption {
  month: string;
  quantity: number;
  weight: number;
  weightedQuantity: number;
}

@Injectable()
export class AutoOrderService {
  private readonly logger = new Logger(AutoOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Analyze all items and generate smart auto-order recommendations
   * Coordinates with scheduled orders to prevent conflicts
   */
  async analyzeItemsForAutoOrder(userId?: string): Promise<AutoOrderRecommendation[]> {
    this.logger.log('Starting intelligent auto-order analysis with schedule coordination...');

    // Get all active order schedules
    const activeSchedules = await this.prisma.orderSchedule.findMany({
      where: {
        isActive: true,
        finishedAt: null,
      },
      select: {
        id: true,
        items: true,
        nextRun: true,
        frequency: true,
      },
    });

    // Build set of items in active schedules with their next order dates
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

    // Get all active items with stock configuration
    const items = await this.prisma.item.findMany({
      where: {
        isActive: true,
        reorderPoint: { not: null },
      },
      include: {
        supplier: true,
        category: true,
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1, // Latest price only
        },
        activities: {
          where: {
            createdAt: { gte: subMonths(new Date(), 12) }, // Last 12 months
            operation: ACTIVITY_OPERATION.OUTBOUND,
          },
          orderBy: { createdAt: 'desc' },
        },
        orderItems: {
          include: {
            order: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1, // Latest order only
        },
      },
    });

    this.logger.log(`Analyzing ${items.length} items...`);

    const analyses: DemandAnalysis[] = [];

    for (const item of items) {
      const scheduleInfo = scheduledItems.get(item.id);
      const analysis = await this.analyzeSingleItem(item, scheduleInfo);

      // Only include items that actually need ordering
      if (analysis && analysis.recommendedOrderQuantity > 0) {
        analyses.push(analysis);
      }
    }

    // Group by supplier for consolidated ordering
    const groupedBySupplier = this.groupBySupplier(analyses);

    // Add synchronization items - items from same supplier that should be ordered together
    // to align reorder cycles
    const enhancedRecommendations = await this.addSynchronizationItems(
      groupedBySupplier,
      items,
      scheduledItems,
    );

    this.logger.log(
      `Generated ${enhancedRecommendations.length} auto-order recommendations (with sync items)`,
    );

    return enhancedRecommendations;
  }

  /**
   * Enhanced monthly consumption with exponential weighting
   * Recent months get higher weight for better trend responsiveness
   */
  private calculateWeightedMonthlyConsumption(
    activities: any[],
    lookbackMonths: number = 12,
  ): {
    weightedMonthly: number;
    trend: 'increasing' | 'stable' | 'decreasing';
    trendPercentage: number;
    monthlyData: WeightedConsumption[];
  } {
    const now = new Date();
    const monthlyConsumption = new Map<string, number>();

    // Group activities by month
    activities.forEach(activity => {
      const monthKey = `${activity.createdAt.getFullYear()}-${String(activity.createdAt.getMonth() + 1).padStart(2, '0')}`;
      const current = monthlyConsumption.get(monthKey) || 0;
      monthlyConsumption.set(monthKey, current + activity.quantity);
    });

    if (monthlyConsumption.size === 0) {
      return {
        weightedMonthly: 0,
        trend: 'stable',
        trendPercentage: 0,
        monthlyData: [],
      };
    }

    // Calculate weighted average with exponential decay
    // More recent months have higher weight: weight = e^(-age/3)
    let weightedSum = 0;
    let totalWeight = 0;
    const monthlyData: WeightedConsumption[] = [];

    const sortedMonths = Array.from(monthlyConsumption.entries()).sort((a, b) =>
      b[0].localeCompare(a[0]),
    ); // Newest first

    sortedMonths.forEach(([month, quantity], index) => {
      // Exponential decay: recent months weighted more heavily
      // weight = e^(-monthsAgo / 3)
      // 0 months ago = weight 1.0
      // 3 months ago = weight ~0.37
      // 6 months ago = weight ~0.14
      const monthsAgo = index;
      const weight = Math.exp(-monthsAgo / 3);

      weightedSum += quantity * weight;
      totalWeight += weight;

      monthlyData.push({
        month,
        quantity,
        weight,
        weightedQuantity: quantity * weight,
      });
    });

    const weightedMonthly = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Analyze trend: compare recent 3 months vs previous 3 months
    const recentMonths = sortedMonths.slice(0, 3);
    const olderMonths = sortedMonths.slice(3, 6);

    const recentAvg =
      recentMonths.length > 0
        ? recentMonths.reduce((sum, [, qty]) => sum + qty, 0) / recentMonths.length
        : 0;

    const olderAvg =
      olderMonths.length > 0
        ? olderMonths.reduce((sum, [, qty]) => sum + qty, 0) / olderMonths.length
        : recentAvg;

    let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
    let trendPercentage = 0;

    if (olderAvg > 0) {
      const change = ((recentAvg - olderAvg) / olderAvg) * 100;
      trendPercentage = Math.round(change * 10) / 10;

      if (change > 20) {
        trend = 'increasing';
      } else if (change < -20) {
        trend = 'decreasing';
      }
    }

    return {
      weightedMonthly,
      trend,
      trendPercentage,
      monthlyData,
    };
  }

  /**
   * Analyze a single item for auto-order needs
   * Coordinates with scheduled orders using intelligent priority logic
   */
  private async analyzeSingleItem(
    item: any,
    scheduleInfo?: { nextRun: Date | null; scheduleId: string },
  ): Promise<DemandAnalysis | null> {
    const {
      weightedMonthly: monthlyConsumption,
      trend,
      trendPercentage,
    } = this.calculateWeightedMonthlyConsumption(item.activities);

    // If no consumption data, skip
    if (monthlyConsumption === 0) {
      return null;
    }

    const dailyConsumption = monthlyConsumption / 30;
    const currentStock = item.quantity;
    const reorderPoint = item.reorderPoint || 0;
    const maxQuantity = item.maxQuantity;
    const estimatedLeadTime = item.estimatedLeadTime || 30;

    // Calculate days until stockout
    // Cap at 999 days max to avoid meaningless large numbers when consumption is very low
    const MAX_DAYS_DISPLAY = 999;
    const rawDaysUntilStockout =
      dailyConsumption > 0 ? Math.floor(currentStock / dailyConsumption) : MAX_DAYS_DISPLAY;
    const daysUntilStockout = Math.min(rawDaysUntilStockout, MAX_DAYS_DISPLAY);

    // Check for active pending orders
    const hasActivePendingOrder = await this.hasActivePendingOrder(item.id);

    // If there's already a pending order and stock is not critical, skip
    if (hasActivePendingOrder && currentStock > reorderPoint * 0.5) {
      return null;
    }

    // Get last order date
    const lastOrderDate = item.orderItems[0]?.order?.createdAt || null;
    const daysSinceLastOrder = lastOrderDate ? differenceInDays(new Date(), lastOrderDate) : null;

    // Smart duplicate prevention: never order same item within 30 days
    // UNLESS it's critical (stock below 50% of reorder point)
    const isCritical = currentStock <= reorderPoint * 0.5;
    if (daysSinceLastOrder !== null && daysSinceLastOrder < 30 && !isCritical) {
      this.logger.debug(`Skipping ${item.name}: ordered ${daysSinceLastOrder} days ago`);
      return null;
    }

    // SCHEDULE COORDINATION LOGIC
    // If item is in an active schedule, check if we should defer to the schedule
    if (scheduleInfo && scheduleInfo.nextRun) {
      const daysUntilScheduledOrder = differenceInDays(scheduleInfo.nextRun, new Date());
      const daysUntilScheduledDelivery = daysUntilScheduledOrder + estimatedLeadTime;

      // Check if item will run out BEFORE the scheduled order arrives
      const willStockoutBeforeSchedule = daysUntilStockout < daysUntilScheduledDelivery;

      if (!willStockoutBeforeSchedule && daysUntilScheduledOrder <= estimatedLeadTime * 1.5) {
        // Scheduled order is soon enough and stock will last - defer to schedule
        this.logger.debug(
          `Skipping ${item.name}: covered by schedule (next order in ${daysUntilScheduledOrder} days)`,
        );
        return null;
      }

      if (willStockoutBeforeSchedule && currentStock > 0) {
        // Emergency: will stockout before scheduled order arrives
        // Create auto-order with warning
        this.logger.warn(
          `EMERGENCY: ${item.name} will stockout in ${daysUntilStockout} days, ` +
            `but scheduled order not until ${daysUntilScheduledOrder} days. Creating auto-order.`,
        );
        // Continue to create auto-order with special reason
      }
    }

    // Determine if item needs ordering
    const needsOrdering = this.determineOrderNeed(
      currentStock,
      reorderPoint,
      maxQuantity,
      daysUntilStockout,
      estimatedLeadTime,
      hasActivePendingOrder,
    );

    if (!needsOrdering.shouldOrder) {
      return null;
    }

    // Calculate recommended order quantity with trend adjustment
    const recommendedOrderQuantity = this.calculateSmartOrderQuantity(
      currentStock,
      monthlyConsumption,
      trend,
      trendPercentage,
      reorderPoint,
      maxQuantity,
      item.reorderQuantity,
      estimatedLeadTime,
      item.isManualMaxQuantity,
    );

    // Determine urgency
    const urgency = this.determineUrgency(
      currentStock,
      reorderPoint,
      daysUntilStockout,
      estimatedLeadTime,
    );

    // Check if this is an emergency override of schedule
    const isInSchedule = !!scheduleInfo;
    const isEmergencyOverride =
      isInSchedule &&
      scheduleInfo!.nextRun !== null &&
      daysUntilStockout < differenceInDays(scheduleInfo!.nextRun, new Date()) + estimatedLeadTime;

    // Update reason if emergency override
    let finalReason = needsOrdering.reason;
    if (isEmergencyOverride) {
      const daysUntilScheduled = differenceInDays(scheduleInfo!.nextRun!, new Date());
      finalReason = `⚠️ EMERGÊNCIA: ${needsOrdering.reason} | Próximo pedido agendado em ${daysUntilScheduled} dias (muito tarde)`;
    }

    // Calculate estimated cost
    const currentPrice = item.prices && item.prices[0] ? item.prices[0].value : 0;
    const estimatedCost = currentPrice * recommendedOrderQuantity;

    return {
      itemId: item.id,
      itemName: item.name,
      currentStock,
      monthlyConsumption,
      trend,
      trendPercentage,
      daysUntilStockout,
      recommendedOrderQuantity,
      urgency: isEmergencyOverride ? 'critical' : urgency,
      reason: finalReason,
      supplierId: item.supplierId,
      supplierName: item.supplier?.fantasyName || null,
      categoryId: item.categoryId,
      categoryName: item.category?.name || null,
      lastOrderDate,
      daysSinceLastOrder,
      hasActivePendingOrder,
      estimatedLeadTime,
      estimatedCost,
      reorderPoint,
      maxQuantity,
      isInSchedule,
      scheduleNextRun: scheduleInfo?.nextRun || null,
      isEmergencyOverride,
    };
  }

  /**
   * Smart order quantity calculation with trend awareness
   */
  private calculateSmartOrderQuantity(
    currentStock: number,
    monthlyConsumption: number,
    trend: 'increasing' | 'stable' | 'decreasing',
    trendPercentage: number,
    reorderPoint: number,
    maxQuantity: number | null,
    reorderQuantity: number | null,
    estimatedLeadTime: number,
    isManualMaxQuantity: boolean,
  ): number {
    // If there's a manual reorder quantity and it's reasonable, use it
    if (reorderQuantity && reorderQuantity > 0 && reorderQuantity < (maxQuantity || Infinity)) {
      return reorderQuantity;
    }

    // Apply trend multiplier to adjust for demand changes
    let trendMultiplier = 1.0;

    if (trend === 'increasing') {
      // For increasing demand, order more (scale with trend strength)
      trendMultiplier = 1.0 + Math.min(trendPercentage / 100, 0.5); // Cap at 50% increase
    } else if (trend === 'decreasing') {
      // For decreasing demand, order less (but not too little)
      trendMultiplier = Math.max(0.7, 1.0 + trendPercentage / 100); // Min 70% of normal
    }

    // Calculate quantity needed to cover lead time + 1 month buffer
    const dailyConsumption = monthlyConsumption / 30;
    const leadTimeConsumption = dailyConsumption * estimatedLeadTime;
    const bufferConsumption = monthlyConsumption; // 1 month buffer

    let targetQuantity = Math.ceil(
      (leadTimeConsumption + bufferConsumption - currentStock) * trendMultiplier,
    );

    // Ensure we don't exceed max quantity (if set and not manual)
    if (maxQuantity && !isManualMaxQuantity) {
      const availableSpace = maxQuantity - currentStock;
      targetQuantity = Math.min(targetQuantity, availableSpace);
    }

    // If manually set max quantity, respect it but warn if insufficient
    if (maxQuantity && isManualMaxQuantity) {
      const availableSpace = maxQuantity - currentStock;
      if (targetQuantity > availableSpace) {
        this.logger.warn(
          `Item has manual maxQuantity (${maxQuantity}) that may be insufficient for demand trend`,
        );
        targetQuantity = availableSpace;
      }
    }

    // Minimum order quantity: at least enough to reach reorder point
    const minimumOrder = Math.max(1, reorderPoint - currentStock);

    return Math.max(targetQuantity, minimumOrder);
  }

  /**
   * Determine if item needs ordering
   */
  private determineOrderNeed(
    currentStock: number,
    reorderPoint: number,
    maxQuantity: number | null,
    daysUntilStockout: number,
    estimatedLeadTime: number,
    hasActivePendingOrder: boolean,
  ): { shouldOrder: boolean; reason: string } {
    // Critical: out of stock or will stockout before lead time
    if (currentStock === 0) {
      return { shouldOrder: true, reason: 'Item fora de estoque' };
    }

    if (daysUntilStockout < estimatedLeadTime) {
      return {
        shouldOrder: true,
        reason: `Estoque esgotará em ${daysUntilStockout} dias (prazo de entrega: ${estimatedLeadTime} dias)`,
      };
    }

    // Below reorder point
    if (currentStock <= reorderPoint) {
      return {
        shouldOrder: true,
        reason: `Estoque abaixo do ponto de reposição (${currentStock} ≤ ${reorderPoint})`,
      };
    }

    // Preventive: approaching reorder point within lead time
    if (currentStock <= reorderPoint * 1.2 && daysUntilStockout < estimatedLeadTime * 1.5) {
      return {
        shouldOrder: true,
        reason: 'Reposição preventiva - aproximando do ponto de reposição',
      };
    }

    return { shouldOrder: false, reason: '' };
  }

  /**
   * Determine order urgency
   */
  private determineUrgency(
    currentStock: number,
    reorderPoint: number,
    daysUntilStockout: number,
    estimatedLeadTime: number,
  ): 'critical' | 'high' | 'medium' | 'low' {
    if (currentStock === 0 || daysUntilStockout < estimatedLeadTime / 2) {
      return 'critical';
    }

    if (currentStock <= reorderPoint * 0.5 || daysUntilStockout < estimatedLeadTime) {
      return 'high';
    }

    if (currentStock <= reorderPoint * 0.8) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Check if item has active pending orders
   */
  private async hasActivePendingOrder(itemId: string): Promise<boolean> {
    const count = await this.prisma.orderItem.count({
      where: {
        itemId,
        order: {
          status: {
            in: [ORDER_STATUS.CREATED, ORDER_STATUS.PARTIALLY_FULFILLED, ORDER_STATUS.FULFILLED],
          },
        },
      },
    });

    return count > 0;
  }

  /**
   * Group analyses by supplier for consolidated ordering
   */
  private groupBySupplier(analyses: DemandAnalysis[]): AutoOrderRecommendation[] {
    const grouped = new Map<string, DemandAnalysis[]>();

    analyses.forEach(analysis => {
      const key = analysis.supplierId || 'NO_SUPPLIER';
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(analysis);
    });

    return Array.from(grouped.entries()).map(([supplierId, items]) => {
      // Calculate total estimated value (simplified - would need prices)
      const totalValue = 0; // Would calculate from item prices

      // Determine overall urgency (highest urgency item)
      const urgency = items.reduce(
        (max, item) => {
          const urgencyOrder = { critical: 4, high: 3, medium: 2, low: 1 };
          return urgencyOrder[item.urgency] > urgencyOrder[max] ? item.urgency : max;
        },
        'low' as 'critical' | 'high' | 'medium' | 'low',
      );

      // Consolidate reasons
      const consolidatedReasons = Array.from(new Set(items.map(item => item.reason)));

      return {
        supplierId: supplierId === 'NO_SUPPLIER' ? null : supplierId,
        supplierName: items[0].supplierName || 'Sem fornecedor',
        items,
        totalValue,
        urgency,
        consolidatedReasons,
      };
    });
  }

  /**
   * Add synchronization items to align reorder cycles across supplier items.
   *
   * The goal is to align future orders so all items from the same supplier
   * will need their next order at the same time.
   *
   * Algorithm:
   * 1. For critical items being ordered, calculate when they will need their NEXT order
   *    (current stock + order quantity) / daily consumption = days until next reorder point
   * 2. For other items from same supplier, calculate how much to order so they also
   *    reach their reorder point at the same target date
   * 3. This ensures all items are synchronized and will be ordered together in the future
   */
  private async addSynchronizationItems(
    recommendations: AutoOrderRecommendation[],
    allAnalyzedItems: any[],
    scheduledItems: Map<string, { nextRun: Date | null; scheduleId: string }>,
  ): Promise<AutoOrderRecommendation[]> {
    const enhancedRecommendations: AutoOrderRecommendation[] = [];

    for (const recommendation of recommendations) {
      // Skip if no supplier (can't sync items without a supplier)
      if (!recommendation.supplierId) {
        enhancedRecommendations.push(recommendation);
        continue;
      }

      // Get all active items from this supplier
      const allSupplierItems = await this.prisma.item.findMany({
        where: {
          supplierId: recommendation.supplierId,
          isActive: true,
          reorderPoint: { not: null },
        },
        include: {
          supplier: true,
          category: true,
          prices: {
            orderBy: { createdAt: 'desc' },
            take: 1, // Latest price only
          },
          activities: {
            where: {
              createdAt: { gte: subMonths(new Date(), 12) },
              operation: ACTIVITY_OPERATION.OUTBOUND,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      // Calculate the TARGET DATE for next order based on critical items
      // After ordering, when will the critical items reach their reorder point again?
      const criticalItems = recommendation.items.filter(
        item => item.urgency === 'critical' || item.urgency === 'high',
      );

      // Calculate days until each critical item reaches reorder point AFTER receiving the order
      const daysUntilNextReorderPoints = criticalItems
        .filter(item => item.monthlyConsumption > 0)
        .map(item => {
          const dailyConsumption = item.monthlyConsumption / 30;
          const stockAfterOrder = item.currentStock + item.recommendedOrderQuantity;
          const reorderPoint = item.reorderPoint || 0;
          // Days until stock drops to reorder point
          return Math.floor((stockAfterOrder - reorderPoint) / dailyConsumption);
        });

      // Use the MINIMUM days as our target - we want all items to need ordering at the same time
      // Use at least 30 days as minimum cycle
      const targetDaysUntilNextOrder =
        daysUntilNextReorderPoints.length > 0
          ? Math.max(Math.min(...daysUntilNextReorderPoints), 30)
          : 60; // Default 60 days if no critical items with consumption

      this.logger.debug(
        `Supplier ${recommendation.supplierName}: Target next order in ${targetDaysUntilNextOrder} days`,
      );

      // IDs of items already in the recommendation
      const existingItemIds = new Set(recommendation.items.map(i => i.itemId));

      // Analyze potential sync items
      const syncItems: DemandAnalysis[] = [];

      for (const item of allSupplierItems) {
        // Skip if already in recommendations
        if (existingItemIds.has(item.id)) continue;

        // Skip if in active schedule
        if (scheduledItems.has(item.id)) continue;

        // Calculate consumption and stock data
        const {
          weightedMonthly: monthlyConsumption,
          trend,
          trendPercentage,
        } = this.calculateWeightedMonthlyConsumption(item.activities);

        // Skip if no meaningful consumption
        if (monthlyConsumption < 0.1) continue;

        const dailyConsumption = monthlyConsumption / 30;
        const currentStock = item.quantity;
        const reorderPoint = item.reorderPoint || 0;

        // Calculate current days until this item reaches its reorder point
        const currentDaysUntilReorder =
          dailyConsumption > 0 ? Math.floor((currentStock - reorderPoint) / dailyConsumption) : 999;

        // If this item will already need ordering BEFORE the target date,
        // it should already be in recommendations (skip to avoid duplicates)
        if (currentDaysUntilReorder <= 0) continue;

        // Calculate how much stock this item needs to also reach reorder point at targetDaysUntilNextOrder
        // We want: (currentStock + syncQuantity - reorderPoint) / dailyConsumption = targetDaysUntilNextOrder
        // So: syncQuantity = (targetDaysUntilNextOrder * dailyConsumption) + reorderPoint - currentStock
        const stockNeededAtTargetDate = targetDaysUntilNextOrder * dailyConsumption + reorderPoint;
        const syncQuantity = Math.ceil(stockNeededAtTargetDate - currentStock);

        // Only sync if we need to ADD stock (positive quantity)
        // If syncQuantity <= 0, the item already has enough stock to last beyond target date
        if (syncQuantity <= 0) continue;

        // Cap at maxQuantity if defined
        const recommendedQuantity = item.maxQuantity
          ? Math.min(syncQuantity, item.maxQuantity - currentStock)
          : syncQuantity;

        // Skip if final quantity is not meaningful
        if (recommendedQuantity < 1) continue;

        // Calculate actual days until stockout for display
        const daysUntilStockout =
          dailyConsumption > 0 ? Math.min(Math.floor(currentStock / dailyConsumption), 999) : 999;

        // Get latest price for cost calculation
        const currentPrice = item.prices && item.prices[0] ? item.prices[0].value : 0;

        const syncItem: DemandAnalysis = {
          itemId: item.id,
          itemName: item.name,
          currentStock,
          monthlyConsumption,
          trend,
          trendPercentage,
          daysUntilStockout,
          recommendedOrderQuantity: Math.ceil(recommendedQuantity),
          urgency: 'low',
          reason: `Sincronização de ciclo: ordenar junto com outros ${recommendation.items.length} item(ns) para alinhar próximo pedido em ~${targetDaysUntilNextOrder} dias`,
          supplierId: item.supplierId,
          supplierName: item.supplier?.fantasyName || null,
          categoryId: item.categoryId,
          categoryName: item.category?.name || null,
          lastOrderDate: null,
          daysSinceLastOrder: null,
          hasActivePendingOrder: false,
          estimatedLeadTime: item.estimatedLeadTime || 30,
          estimatedCost: currentPrice * Math.ceil(recommendedQuantity),
          reorderPoint,
          maxQuantity: item.maxQuantity || null,
          isInSchedule: false,
          scheduleNextRun: null,
          isEmergencyOverride: false,
        };

        syncItems.push(syncItem);
      }

      this.logger.debug(
        `Supplier ${recommendation.supplierName}: Added ${syncItems.length} sync items to ${recommendation.items.length} required items`,
      );

      // Combine original items with sync items
      const allItems = [...recommendation.items, ...syncItems];

      // Recalculate total estimated cost
      const totalEstimatedCost = allItems.reduce((sum, item) => sum + (item.estimatedCost || 0), 0);

      // Recalculate urgency and consolidated reasons
      const urgency = allItems.reduce(
        (max, item) => {
          const urgencyOrder = { critical: 4, high: 3, medium: 2, low: 1 };
          return urgencyOrder[item.urgency] > urgencyOrder[max] ? item.urgency : max;
        },
        'low' as 'critical' | 'high' | 'medium' | 'low',
      );

      const consolidatedReasons = Array.from(new Set(allItems.map(item => item.reason)));

      enhancedRecommendations.push({
        ...recommendation,
        items: allItems,
        totalValue: totalEstimatedCost,
        urgency,
        consolidatedReasons,
      });
    }

    return enhancedRecommendations;
  }

  /**
   * Create auto-orders from recommendations
   */
  async createAutoOrders(
    recommendations: AutoOrderRecommendation[],
    userId: string,
  ): Promise<any[]> {
    const createdOrders = [];

    for (const recommendation of recommendations) {
      try {
        const order = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
          // Create order
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
                  price: 0, // Would get from item's last price
                  icms: 0,
                  ipi: 0,
                })),
              },
            },
            include: {
              items: true,
            },
          });

          // Update lastAutoOrderDate for all items
          await tx.item.updateMany({
            where: {
              id: { in: recommendation.items.map(i => i.itemId) },
            },
            data: {
              lastAutoOrderDate: new Date(),
            },
          });

          // Log to changelog
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
      where: {
        isActive: true,
        finishedAt: null,
      },
      select: {
        id: true,
        items: true,
        nextRun: true,
        frequency: true,
      },
    });

    const scheduledItems: Array<{
      itemId: string;
      itemName: string;
      scheduleId: string;
      scheduleName: string;
      nextRun: Date | null;
    }> = [];

    for (const schedule of activeSchedules) {
      // Get item names
      const items = await this.prisma.item.findMany({
        where: {
          id: { in: schedule.items },
        },
        select: {
          id: true,
          name: true,
        },
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
