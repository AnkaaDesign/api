import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { DashboardRepository } from './dashboard.repository';
import {
  DashboardChartData,
  DashboardListItem,
  PaintProductionOverview,
  PaintFormulaMetrics,
  PaintComponentInventory,
  PaintColorAnalysis,
  PaintEfficiencyMetrics,
  PaintTrends,
  DateFilter,
  DashboardActivityWhere,
  DashboardOrderWhere,
  DashboardUserWhere,
  DashboardTaskWhere,
  DashboardNotificationWhere,
  TimeSeriesDataPoint,
} from '../../../../../types';
import {
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
  ORDER_STATUS,
  STOCK_LEVEL,
  TASK_STATUS,
  USER_STATUS,
  VACATION_STATUS,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_TYPE,
  DASHBOARD_TIME_PERIOD,
  PAINT_FINISH,
  PAINT_BRAND,
  COLOR_PALETTE,
  TRUCK_MANUFACTURER,
  ACTIVE_USER_STATUSES,
} from '../../../../../constants/enums';
import {
  ACTIVITY_REASON_LABELS,
  ORDER_STATUS_LABELS,
  TASK_STATUS_LABELS,
  NOTIFICATION_IMPORTANCE_LABELS,
  NOTIFICATION_TYPE_LABELS,
  PAINT_FINISH_LABELS,
  PAINT_BRAND_LABELS,
  COLOR_PALETTE_LABELS,
  TRUCK_MANUFACTURER_LABELS,
} from '../../../../../constants/enum-labels';

@Injectable()
export class DashboardPrismaRepository implements DashboardRepository {
  protected readonly logger = new Logger(DashboardPrismaRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sanitizes where clause for groupBy operations by removing nested relation filters
   * that can cause circular reference issues
   */
  private sanitizeWhereForGroupBy(where: any): any {
    if (!where) return where;

    const sanitized: any = {};
    for (const key in where) {
      const value = where[key];
      // Only include scalar fields and simple comparisons, skip nested objects that represent relations
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !['in', 'not', 'equals', 'contains', 'startsWith', 'endsWith', 'lt', 'lte', 'gt', 'gte'].includes(
          Object.keys(value)[0] || '',
        )
      ) {
        // Skip nested relation objects
        continue;
      }
      sanitized[key] = value;
    }
    return sanitized;
  }

  // Inventory dashboard queries

  async countItems(where?: any): Promise<number> {
    return this.prisma.item.count({ where });
  }

  /**
   * Determines the stock level based on quantity, reorder point, and active order status
   * This logic matches the frontend determineStockLevel function in web/src/utils/stock-level.ts
   *
   * Thresholds:
   * - CRITICAL: quantity <= 90% of reorder point
   * - LOW: 90% < quantity <= 110% of reorder point
   * - OPTIMAL: 110% < quantity <= max quantity (or no max)
   * - OVERSTOCKED: quantity > max quantity
   *
   * When hasActiveOrder is true, thresholds are adjusted by 1.5x to reduce urgency
   */
  private determineStockLevel(
    quantity: number,
    reorderPoint: number | null,
    maxQuantity: number | null,
    hasActiveOrder: boolean,
  ): STOCK_LEVEL {
    // Validate input
    if (!Number.isFinite(quantity)) {
      return STOCK_LEVEL.OPTIMAL;
    }

    // Handle negative stock
    if (quantity < 0) {
      return STOCK_LEVEL.NEGATIVE_STOCK;
    }

    // Handle zero stock
    if (quantity === 0) {
      return STOCK_LEVEL.OUT_OF_STOCK;
    }

    // If no reorder point is configured, we can't calculate thresholds
    if (reorderPoint === null) {
      return STOCK_LEVEL.OPTIMAL;
    }

    // Adjust thresholds if there's an active order (less urgency)
    const adjustmentFactor = hasActiveOrder ? 1.5 : 1;
    const adjustedCriticalThreshold = reorderPoint * 0.9 * adjustmentFactor;
    const adjustedLowThreshold = reorderPoint * 1.1 * adjustmentFactor;

    // Check critical level (inclusive boundary)
    if (quantity <= adjustedCriticalThreshold) {
      return STOCK_LEVEL.CRITICAL;
    }

    // Check low level (inclusive boundary)
    if (quantity <= adjustedLowThreshold) {
      return STOCK_LEVEL.LOW;
    }

    // Check overstocked
    if (maxQuantity !== null && quantity > maxQuantity) {
      return STOCK_LEVEL.OVERSTOCKED;
    }

    // Otherwise, stock is optimal
    return STOCK_LEVEL.OPTIMAL;
  }

  async getItemStatistics(where?: any): Promise<{
    totalValue: number;
    negativeStockItems: number;
    outOfStockItems: number;
    criticalItems: number;
    lowStockItems: number;
    optimalItems: number;
    overstockedItems: number;
    itemsNeedingReorder: number;
  }> {
    const items = await this.prisma.item.findMany({
      where,
      select: {
        quantity: true,
        maxQuantity: true,
        reorderPoint: true,
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { value: true },
        },
        orderItems: {
          select: {
            order: {
              select: {
                status: true,
              },
            },
          },
        },
      },
    });

    let totalValue = 0;
    let negativeStockItems = 0;
    let outOfStockItems = 0;
    let criticalItems = 0;
    let lowStockItems = 0;
    let optimalItems = 0;
    let overstockedItems = 0;
    let itemsNeedingReorder = 0;

    const activeOrderStatuses = [
      ORDER_STATUS.CREATED,
      ORDER_STATUS.PARTIALLY_FULFILLED,
      ORDER_STATUS.FULFILLED,
      ORDER_STATUS.PARTIALLY_RECEIVED,
    ];

    for (const item of items) {
      const latestPrice = item.prices[0]?.value || 0;
      totalValue += item.quantity * latestPrice;

      // Check if item has an active order
      const hasActiveOrder =
        item.orderItems?.some(
          (orderItem) =>
            orderItem.order && activeOrderStatuses.includes(orderItem.order.status as ORDER_STATUS),
        ) || false;

      // Determine stock level using the unified algorithm
      const stockLevel = this.determineStockLevel(
        item.quantity,
        item.reorderPoint,
        item.maxQuantity,
        hasActiveOrder,
      );

      // Count items by stock level
      switch (stockLevel) {
        case STOCK_LEVEL.NEGATIVE_STOCK:
          negativeStockItems++;
          itemsNeedingReorder++;
          break;
        case STOCK_LEVEL.OUT_OF_STOCK:
          outOfStockItems++;
          itemsNeedingReorder++;
          break;
        case STOCK_LEVEL.CRITICAL:
          criticalItems++;
          itemsNeedingReorder++;
          break;
        case STOCK_LEVEL.LOW:
          lowStockItems++;
          itemsNeedingReorder++;
          break;
        case STOCK_LEVEL.OPTIMAL:
          optimalItems++;
          break;
        case STOCK_LEVEL.OVERSTOCKED:
          overstockedItems++;
          break;
      }
    }

    return {
      totalValue,
      negativeStockItems,
      outOfStockItems,
      criticalItems,
      lowStockItems,
      optimalItems,
      overstockedItems,
      itemsNeedingReorder,
    };
  }

  async getActivityStatistics(where?: DashboardActivityWhere): Promise<{
    totalInbound: number;
    totalOutbound: number;
    movementsByReason: DashboardChartData;
    movementsByOperation: DashboardChartData;
    recentActivities: Array<any>;
  }> {
    const last30DaysRange = this.getLast30DaysRange();

    // Build separate where clauses for different query types
    const baseWhere = {
      createdAt: last30DaysRange,
    };

    // For groupBy queries, don't include nested objects that cause joins
    let groupByWhere: any = { ...baseWhere };

    // If we need to filter by item properties, get itemIds first
    if (where?.item) {
      const filteredItems = await this.prisma.item.findMany({
        where: where.item,
        select: { id: true },
      });
      const itemIds = filteredItems.map(item => item.id);
      if (itemIds.length > 0) {
        groupByWhere.itemId = { in: itemIds };
      } else {
        // No items match the filter, so return empty results
        groupByWhere.itemId = { in: [] };
      }
    }

    // For findMany queries, include all where conditions
    const findManyWhere = {
      ...where,
      createdAt: last30DaysRange,
    };

    const [byOperation, byReason, recentActivities] = await Promise.all([
      this.prisma.activity.groupBy({
        by: ['operation'],
        where: groupByWhere,
        _count: { id: true },
        _sum: { quantity: true },
      }),
      this.prisma.activity.groupBy({
        by: ['reason'],
        where: groupByWhere,
        _count: { id: true },
      }),
      this.prisma.activity.findMany({
        where: findManyWhere,
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          item: { select: { name: true } },
          user: { select: { name: true } },
        },
      }),
    ]);

    const inbound = byOperation.find((op: any) => op.operation === ACTIVITY_OPERATION.INBOUND);
    const outbound = byOperation.find((op: any) => op.operation === ACTIVITY_OPERATION.OUTBOUND);

    return {
      totalInbound: inbound?._sum?.quantity ?? 0,
      totalOutbound: outbound?._sum?.quantity ?? 0,
      movementsByReason: {
        labels: byReason.map(
          (r: any) => ACTIVITY_REASON_LABELS[r.reason as ACTIVITY_REASON] || r.reason,
        ),
        datasets: [
          {
            label: 'Movimentações',
            data: byReason.map((r: any) => r._count.id),
          },
        ],
      },
      movementsByOperation: {
        labels: ['Entrada', 'Saída'],
        datasets: [
          {
            label: 'Quantidade',
            data: [inbound?._sum?.quantity ?? 0, outbound?._sum?.quantity ?? 0],
          },
        ],
      },
      recentActivities: recentActivities.map(a => ({
        id: a.id,
        itemName: a.item.name,
        quantity: a.quantity,
        operation: a.operation,
        reason: a.reason,
        userName: a.user?.name,
        createdAt: a.createdAt,
      })),
    };
  }

  async getTopItemsByValue(where?: any, limit: number = 10): Promise<DashboardListItem[]> {
    const items = await this.prisma.item.findMany({
      where,
      include: {
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const itemsWithValue = items.map(item => ({
      id: item.id,
      name: item.name,
      value: item.quantity * (item.prices[0]?.value || 0),
    }));

    return itemsWithValue.sort((a, b) => b.value - a.value).slice(0, limit);
  }

  async getTopItemsByActivityCount(where?: any, limit: number = 10): Promise<DashboardListItem[]> {
    // Don't use nested item relations in groupBy - it causes ambiguous id references
    // Instead, we'll filter at the database level if needed
    let activityWhere: any = undefined;

    // If we need to filter by item properties, we'll need to get itemIds first
    if (where?.item) {
      const filteredItems = await this.prisma.item.findMany({
        where: where.item,
        select: { id: true },
      });
      const itemIds = filteredItems.map(item => item.id);
      activityWhere = { itemId: { in: itemIds } };
    }

    const activities = await this.prisma.activity.groupBy({
      by: ['itemId'],
      where: activityWhere,
      _count: { id: true },
    });

    const itemIds = activities.map(a => a.itemId);
    const items = await this.prisma.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true },
    });

    const itemMap = new Map(items.map(i => [i.id, i.name]));

    return activities
      .map(a => ({
        id: a.itemId,
        name: itemMap.get(a.itemId) || 'Item desconhecido',
        value: a._count.id,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
  }

  async getItemsByLowStockPercentage(
    where?: any,
    limit: number = 10,
  ): Promise<DashboardListItem[]> {
    const items = await this.prisma.item.findMany({
      where: {
        ...where,
        reorderPoint: { not: null },
      },
      select: {
        id: true,
        name: true,
        quantity: true,
        reorderPoint: true,
      },
    });

    return items
      .map(item => ({
        id: item.id,
        name: item.name,
        value: ((item.reorderPoint! - item.quantity) / item.reorderPoint!) * 100,
        percentage: ((item.reorderPoint! - item.quantity) / item.reorderPoint!) * 100,
      }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
  }

  async getItemsByCategory(where?: any): Promise<{
    items: DashboardChartData;
    value: DashboardChartData;
  }> {
    const byCategory = await this.prisma.item.groupBy({
      by: ['categoryId'],
      where,
      _count: { id: true },
    });

    const categoryIds = byCategory.map(c => c.categoryId).filter(id => id !== null);
    const categories = await this.prisma.itemCategory.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    });

    const categoryMap = new Map(categories.map(c => [c.id, c.name]));

    // Get value by category
    const itemsWithPrices = await this.prisma.item.findMany({
      where,
      select: {
        categoryId: true,
        quantity: true,
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const valueByCategory = new Map<string, number>();
    for (const item of itemsWithPrices) {
      if (item.categoryId) {
        const currentValue = valueByCategory.get(item.categoryId) || 0;
        const itemValue = item.quantity * (item.prices[0]?.value || 0);
        valueByCategory.set(item.categoryId, currentValue + itemValue);
      }
    }

    const labels = byCategory.map(c => categoryMap.get(c.categoryId || '') || 'Sem categoria');

    return {
      items: {
        labels,
        datasets: [
          {
            label: 'Quantidade de Itens',
            data: byCategory.map(c => c._count.id),
          },
        ],
      },
      value: {
        labels,
        datasets: [
          {
            label: 'Valor Total',
            data: byCategory.map(c => valueByCategory.get(c.categoryId || '') || 0),
          },
        ],
      },
    };
  }

  async getItemsByBrand(where?: any): Promise<DashboardChartData> {
    const byBrand = await this.prisma.item.groupBy({
      by: ['brandId'],
      where,
      _count: { id: true },
    });

    const brandIds = byBrand.map(b => b.brandId).filter(id => id !== null);
    const brands = await this.prisma.itemBrand.findMany({
      where: { id: { in: brandIds } },
      select: { id: true, name: true },
    });

    const brandMap = new Map(brands.map(b => [b.id, b.name]));

    return {
      labels: byBrand.map(b => brandMap.get(b.brandId || '') || 'Sem marca'),
      datasets: [
        {
          label: 'Quantidade de Itens',
          data: byBrand.map(b => b._count.id),
        },
      ],
    };
  }

  async getItemsPerSupplier(where?: any): Promise<DashboardListItem[]> {
    const bySupplier = await this.prisma.item.groupBy({
      by: ['supplierId'],
      where: {
        ...where,
        supplierId: { not: null },
      },
      _count: { id: true },
    });

    const supplierIds = bySupplier.map(s => s.supplierId).filter(id => id !== null) as string[];
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, fantasyName: true },
    });

    const supplierMap = new Map(suppliers.map(s => [s.id, s.fantasyName]));

    return bySupplier
      .map(s => ({
        id: s.supplierId || '',
        name: supplierMap.get(s.supplierId || '') || 'Fornecedor desconhecido',
        value: s._count.id,
      }))
      .sort((a, b) => b.value - a.value);
  }

  async getOrderCounts(where?: DashboardOrderWhere): Promise<{
    pending: number;
    overdue: number;
  }> {
    const now = new Date();

    // Remove createdAt filter if present to show ALL pending orders
    const { createdAt, ...whereWithoutDate } = where || {};

    const [pending, overdue] = await Promise.all([
      this.prisma.order.count({
        where: {
          ...whereWithoutDate,
          status: { not: ORDER_STATUS.RECEIVED as any },
        },
      }),
      this.prisma.order.count({
        where: {
          ...whereWithoutDate,
          status: { not: ORDER_STATUS.RECEIVED as any },
          forecast: { lt: now },
        },
      }),
    ]);

    return { pending, overdue };
  }

  async getInventoryAlerts(limit: number): Promise<
    Array<{
      itemId: string;
      itemName: string;
      alertType: 'critical' | 'low_stock' | 'overstock';
      currentQuantity: number;
      threshold: number;
    }>
  > {
    const items = await this.prisma.item.findMany({
      where: {
        isActive: true,
        OR: [
          {
            reorderPoint: { not: null },
          },
          {
            maxQuantity: { not: null },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        quantity: true,
        reorderPoint: true,
        maxQuantity: true,
      },
      take: limit,
    });

    return items
      .filter(item => {
        // Check if item has an alert condition
        if (item.reorderPoint && item.quantity < item.reorderPoint) return true;
        if (item.maxQuantity && item.quantity > item.maxQuantity) return true;
        return false;
      })
      .map(item => {
        let alertType: 'critical' | 'low_stock' | 'overstock';
        let threshold: number;

        if (item.reorderPoint && item.quantity < item.reorderPoint * 0.2) {
          alertType = 'critical';
          threshold = item.reorderPoint * 0.2;
        } else if (item.reorderPoint && item.quantity < item.reorderPoint) {
          alertType = 'low_stock';
          threshold = item.reorderPoint;
        } else {
          alertType = 'overstock';
          threshold = item.maxQuantity!;
        }

        return {
          itemId: item.id,
          itemName: item.name,
          alertType,
          currentQuantity: item.quantity,
          threshold,
        };
      })
      .slice(0, limit);
  }

  // HR dashboard queries

  async getEmployeeStatistics(
    where?: DashboardUserWhere,
    dateFilter?: DateFilter,
  ): Promise<{
    total: number;
    active: number;
    inactive: number;
    newHires: number;
  }> {
    const last30DaysRange = this.getLast30DaysRange();

    const [total, active, inactive, newHires] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.count({
        where: {
          ...where,
          status: { in: [...ACTIVE_USER_STATUSES] },
        },
      }),
      this.prisma.user.count({
        where: {
          ...where,
          status: USER_STATUS.DISMISSED,
        },
      }),
      this.prisma.user.count({
        where: {
          ...where,
          exp1StartAt: dateFilter || last30DaysRange,
        },
      }),
    ]);

    return { total, active, inactive, newHires };
  }

  async getEmployeesByPerformanceLevel(where?: DashboardUserWhere): Promise<DashboardChartData> {
    const byLevel = await this.prisma.user.groupBy({
      by: ['performanceLevel'],
      where: this.sanitizeWhereForGroupBy(where),
      _count: { id: true },
    });

    return {
      labels: byLevel.map(l => `Nível ${l.performanceLevel}`),
      datasets: [
        {
          label: 'Funcionários',
          data: byLevel.map(l => l._count.id),
        },
      ],
    };
  }

  async getEmployeesBySector(where?: DashboardUserWhere): Promise<DashboardChartData> {
    const sanitizedWhere = this.sanitizeWhereForGroupBy(where);
    const bySector = await this.prisma.user.groupBy({
      by: ['sectorId'],
      where: {
        ...sanitizedWhere,
        sectorId: { not: null },
      },
      _count: { id: true },
    });

    const sectorIds = bySector.map(s => s.sectorId).filter(id => id !== null) as string[];
    const sectors = await this.prisma.sector.findMany({
      where: { id: { in: sectorIds } },
      select: { id: true, name: true },
    });

    const sectorMap = new Map(sectors.map(s => [s.id, s.name]));

    return {
      labels: bySector.map(s => sectorMap.get(s.sectorId!) || 'Sem setor'),
      datasets: [
        {
          label: 'Funcionários',
          data: bySector.map(s => s._count.id),
        },
      ],
    };
  }

  async getEmployeesByPosition(where?: DashboardUserWhere): Promise<DashboardChartData> {
    const sanitizedWhere = this.sanitizeWhereForGroupBy(where);
    const byPosition = await this.prisma.user.groupBy({
      by: ['positionId'],
      where: {
        ...sanitizedWhere,
        positionId: { not: null },
      },
      _count: { id: true },
    });

    const positionIds = byPosition.map(p => p.positionId).filter(id => id !== null) as string[];
    const positions = await this.prisma.position.findMany({
      where: { id: { in: positionIds } },
      select: { id: true, name: true },
    });

    const positionMap = new Map(positions.map(p => [p.id, p.name]));

    return {
      labels: byPosition.map(p => positionMap.get(p.positionId!) || 'Sem cargo'),
      datasets: [
        {
          label: 'Funcionários',
          data: byPosition.map(p => p._count.id),
        },
      ],
    };
  }

  async getAveragePerformanceLevel(where?: DashboardUserWhere): Promise<number> {
    const result = await this.prisma.user.aggregate({
      where,
      _avg: { performanceLevel: true },
    });

    return result._avg?.performanceLevel ?? 0;
  }

  async getVacationStatistics(dateFilter?: DateFilter): Promise<{
    onVacationNow: number;
    upcoming: number;
    approved: number;
    schedule: Array<any>;
  }> {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [onVacationNow, upcoming, approved, schedule] = await Promise.all([
      this.prisma.vacation.count({
        where: {
          startAt: { lte: now },
          endAt: { gte: now },
          status: VACATION_STATUS.IN_PROGRESS as any,
        },
      }),
      this.prisma.vacation.count({
        where: {
          startAt: {
            gte: now,
            lte: thirtyDaysFromNow,
          },
          status: { in: [VACATION_STATUS.APPROVED as any, VACATION_STATUS.IN_PROGRESS as any] },
        },
      }),
      this.prisma.vacation.count({
        where: {
          status: VACATION_STATUS.APPROVED as any,
          ...(dateFilter && { createdAt: dateFilter }),
        },
      }),
      this.prisma.vacation.findMany({
        where: {
          startAt: { gte: now },
          status: { in: [VACATION_STATUS.APPROVED as any, VACATION_STATUS.IN_PROGRESS as any] },
        },
        orderBy: { startAt: 'asc' },
        take: 10,
        include: {
          user: { select: { name: true } },
        },
      }),
    ]);

    return {
      onVacationNow,
      upcoming,
      approved,
      schedule: schedule.map(v => ({
        id: v.id,
        userName: v.user?.name || 'Desconhecido',
        startAt: v.startAt,
        endAt: v.endAt,
        status: v.status,
        isCollective: v.isCollective,
      })),
    };
  }

  async getVacationsByMonth(
    dateFilter?: DateFilter,
  ): Promise<Array<{ month: string; count: number }>> {
    // Always show all 12 months of the current year, regardless of dateFilter
    const now = new Date();
    const currentYear = now.getFullYear();
    const startDate = new Date(currentYear, 0, 1); // January 1st of current year
    const endDate = new Date(currentYear, 11, 31); // December 31st of current year

    const vacations = await this.prisma.vacation.findMany({
      where: {
        startAt: {
          gte: startDate,
          lte: endDate,
        },
        status: {
          in: [
            VACATION_STATUS.APPROVED as any,
            VACATION_STATUS.IN_PROGRESS as any,
            VACATION_STATUS.COMPLETED as any,
          ],
        },
      },
      select: {
        startAt: true,
      },
    });

    // Group vacations by month
    const vacationsByMonth = new Map<string, number>();

    for (const vacation of vacations) {
      const monthKey = `${vacation.startAt.getFullYear()}-${String(vacation.startAt.getMonth() + 1).padStart(2, '0')}`;
      vacationsByMonth.set(monthKey, (vacationsByMonth.get(monthKey) || 0) + 1);
    }

    // Generate all 12 months of the current year
    const result: Array<{ month: string; count: number }> = [];

    for (let month = 0; month < 12; month++) {
      const monthKey = `${currentYear}-${String(month + 1).padStart(2, '0')}`;
      result.push({
        month: monthKey,
        count: vacationsByMonth.get(monthKey) || 0,
      });
    }

    return result;
  }


  async getTaskStatistics(
    where?: DashboardUserWhere,
    dateFilter?: DateFilter,
  ): Promise<{
    created: number;
    byStatus: DashboardChartData;
    completed: number;
    averagePerUser: number;
  }> {
    // Build proper task where clause without nested objects that cause ambiguous id issues
    const taskWhere: any = {
      ...(dateFilter && { createdAt: dateFilter }),
    };

    // Only add createdBy filter if we have user constraints
    if (where?.sectorId || where?.positionId) {
      taskWhere.createdBy = {
        ...(where.sectorId && { sectorId: where.sectorId }),
        ...(where.positionId && { positionId: where.positionId }),
      };
    }

    const [created, byStatus, completed, userCount] = await Promise.all([
      this.prisma.task.count({ where: taskWhere }),
      this.prisma.task.groupBy({
        by: ['status'],
        where: {
          // Don't include createdBy join in groupBy to avoid ambiguous id
          ...(dateFilter && { createdAt: dateFilter }),
        },
        _count: { id: true },
      }),
      this.prisma.task.count({
        where: {
          ...taskWhere,
          status: TASK_STATUS.COMPLETED as any,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      created,
      byStatus: {
        labels: byStatus.map(s => TASK_STATUS_LABELS[s.status as TASK_STATUS] || s.status),
        datasets: [
          {
            label: 'Tarefas',
            data: byStatus.map(s => s._count.id),
          },
        ],
      },
      completed,
      averagePerUser: userCount > 0 ? created / userCount : 0,
    };
  }

  async countVacationsOnDate(date: Date): Promise<number> {
    return this.prisma.vacation.count({
      where: {
        startAt: { lte: date },
        endAt: { gte: date },
        status: VACATION_STATUS.IN_PROGRESS,
      },
    });
  }

  async countTasksInProgress(): Promise<number> {
    return this.prisma.task.count({
      where: {
        status: TASK_STATUS.IN_PRODUCTION as any,
      },
    });
  }

  // Administration dashboard queries

  async getOrderStatistics(where?: any): Promise<{
    total: number;
    byStatus: DashboardChartData;
    pending: number;
    overdue: number;
    withSchedule: number;
  }> {
    const now = new Date();

    const [total, byStatus, pending, overdue, withSchedule] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.groupBy({
        by: ['status'],
        where,
        _count: { id: true },
      }),
      this.prisma.order.count({
        where: {
          ...where,
          status: { not: ORDER_STATUS.RECEIVED as any },
        },
      }),
      this.prisma.order.count({
        where: {
          ...where,
          status: { not: ORDER_STATUS.RECEIVED as any },
          forecast: { lt: now },
        },
      }),
      this.prisma.order.count({
        where: {
          ...where,
          orderScheduleId: { not: null },
        },
      }),
    ]);

    return {
      total,
      byStatus: {
        labels: byStatus.map(s => ORDER_STATUS_LABELS[s.status as ORDER_STATUS] || s.status),
        datasets: [
          {
            label: 'Pedidos',
            data: byStatus.map(s => s._count.id),
          },
        ],
      },
      pending,
      overdue,
      withSchedule,
    };
  }

  async getOrdersWithoutNfe(limit: number): Promise<DashboardListItem[]> {
    const orders = await this.prisma.order.findMany({
      where: {
        invoices: { none: {} },
        status: { not: ORDER_STATUS.CANCELLED as any },
      },
      include: {
        supplier: { select: { fantasyName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return orders.map(o => ({
      id: o.id,
      name: `Pedido ${o.id.slice(-6)} - ${o.supplier?.fantasyName || 'Sem fornecedor'}`,
      value: 0, // Orders don't have a total value field
    }));
  }

  async getTasksWithoutNfe(limit: number): Promise<DashboardListItem[]> {
    const tasks = await this.prisma.task.findMany({
      where: {
        invoices: { none: {} },
        status: TASK_STATUS.COMPLETED as any,
      },
      include: {
        customer: { select: { fantasyName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return tasks.map(t => ({
      id: t.id,
      name: `${t.name} - ${t.customer?.fantasyName || 'Sem cliente'}`,
      value: 0,
    }));
  }

  async getNfeCounts(): Promise<{
    ordersWithNfe: number;
    tasksWithNfe: number;
  }> {
    const [ordersWithNfe, tasksWithNfe] = await Promise.all([
      this.prisma.order.count({
        where: { invoices: { some: {} } },
      }),
      this.prisma.task.count({
        where: { invoices: { some: {} } },
      }),
    ]);

    return { ordersWithNfe, tasksWithNfe };
  }

  async getCustomerStatistics(customerId?: string): Promise<{
    total: number;
    byType: DashboardChartData;
    topByTasks: DashboardListItem[];
    byCity: DashboardChartData;
    withTags: number;
  }> {
    const where = customerId ? { id: customerId } : undefined;

    const [total, withCnpj, withCpf, byCity, withTags, topByTasks] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.count({
        where: {
          ...where,
          cnpj: { not: null },
        },
      }),
      this.prisma.customer.count({
        where: {
          ...where,
          cpf: { not: null },
        },
      }),
      this.prisma.customer.groupBy({
        by: ['city'],
        where: {
          ...where,
          city: { not: null },
        },
        _count: { id: true },
      }),
      this.prisma.customer.count({
        where: {
          ...where,
          tags: { isEmpty: false },
        },
      }),
      this.prisma.customer.findMany({
        where,
        select: {
          id: true,
          fantasyName: true,
          _count: {
            select: { tasks: true },
          },
        },
        orderBy: {
          tasks: { _count: 'desc' },
        },
        take: 10,
      }),
    ]);

    return {
      total,
      byType: {
        labels: ['Pessoa Jurídica', 'Pessoa Física'],
        datasets: [
          {
            label: 'Clientes',
            data: [withCnpj, withCpf],
          },
        ],
      },
      topByTasks: topByTasks.map(c => ({
        id: c.id,
        name: c.fantasyName,
        value: c._count.tasks,
      })),
      byCity: {
        labels: byCity.map(c => c.city || 'Sem cidade'),
        datasets: [
          {
            label: 'Clientes',
            data: byCity.map(c => c._count.id),
          },
        ],
      },
      withTags,
    };
  }

  async getSupplierStatistics(supplierId?: string): Promise<{
    total: number;
    withOrders: number;
    topByOrders: DashboardListItem[];
    byState: DashboardChartData;
  }> {
    const where = supplierId ? { id: supplierId } : undefined;

    const [total, withOrders, byState, topByOrders] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.count({
        where: {
          ...where,
          orders: { some: {} },
        },
      }),
      this.prisma.supplier.groupBy({
        by: ['state'],
        where: {
          ...where,
          state: { not: null },
        },
        _count: { id: true },
      }),
      this.prisma.supplier.findMany({
        where,
        select: {
          id: true,
          fantasyName: true,
          _count: {
            select: { orders: true },
          },
        },
        orderBy: {
          orders: { _count: 'desc' },
        },
        take: 10,
      }),
    ]);

    return {
      total,
      withOrders,
      topByOrders: topByOrders.map(s => ({
        id: s.id,
        name: s.fantasyName,
        value: s._count.orders,
      })),
      byState: {
        labels: byState.map(s => s.state || 'Sem estado'),
        datasets: [
          {
            label: 'Fornecedores',
            data: byState.map(s => s._count.id),
          },
        ],
      },
    };
  }

  async getTaskOverviewStatistics(where?: any): Promise<{
    total: number;
    byStatus: DashboardChartData;
    withPrice: number;
    totalRevenue: number;
    bySector: DashboardChartData;
  }> {
    const [total, byStatus, bySector] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.groupBy({
        by: ['status'],
        where,
        _count: { id: true },
      }),
      this.prisma.task.groupBy({
        by: ['sectorId'],
        where: {
          ...where,
          sectorId: { not: null },
        },
        _count: { id: true },
      }),
    ]);

    const sectorIds = bySector.map(s => s.sectorId).filter(id => id !== null) as string[];
    const sectors = await this.prisma.sector.findMany({
      where: { id: { in: sectorIds } },
      select: { id: true, name: true },
    });

    const sectorMap = new Map(sectors.map(s => [s.id, s.name]));

    return {
      total,
      byStatus: {
        labels: byStatus.map(s => TASK_STATUS_LABELS[s.status as TASK_STATUS] || s.status),
        datasets: [
          {
            label: 'Tarefas',
            data: byStatus.map(s => s._count.id),
          },
        ],
      },
      withPrice: 0,
      totalRevenue: 0,
      bySector: {
        labels: bySector.map(s => sectorMap.get(s.sectorId!) || 'Sem setor'),
        datasets: [
          {
            label: 'Tarefas',
            data: bySector.map(s => s._count.id),
          },
        ],
      },
    };
  }

  async getNotificationStatistics(dateFilter?: DateFilter): Promise<{
    total: number;
    byImportance: DashboardChartData;
    sent: number;
    byType: DashboardChartData;
  }> {
    const currentMonthRange = this.getCurrentMonthRange();
    const where = dateFilter ? { createdAt: dateFilter } : { createdAt: currentMonthRange };

    const [total, byImportance, sent, byType] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.groupBy({
        by: ['importance'],
        where,
        _count: { id: true },
      }),
      this.prisma.notification.count({
        where: {
          ...where,
          sentAt: { not: null },
        },
      }),
      this.prisma.notification.groupBy({
        by: ['type'],
        where,
        _count: { id: true },
      }),
    ]);

    return {
      total,
      byImportance: {
        labels: byImportance.map(
          i =>
            NOTIFICATION_IMPORTANCE_LABELS[i.importance as NOTIFICATION_IMPORTANCE] || i.importance,
        ),
        datasets: [
          {
            label: 'Notificações',
            data: byImportance.map(i => i._count.id),
          },
        ],
      },
      sent,
      byType: {
        labels: byType.map(t => NOTIFICATION_TYPE_LABELS[t.type as NOTIFICATION_TYPE] || t.type),
        datasets: [
          {
            label: 'Notificações',
            data: byType.map(t => t._count.id),
          },
        ],
      },
    };
  }

  async getTotalRevenue(): Promise<number> {
    return 0;
  }

  async countMissingNfe(): Promise<number> {
    const [ordersWithoutNfe, tasksWithoutNfe] = await Promise.all([
      this.prisma.order.count({
        where: {
          invoices: { none: {} },
          status: { not: ORDER_STATUS.CANCELLED as any },
        },
      }),
      this.prisma.task.count({
        where: {
          invoices: { none: {} },
          status: TASK_STATUS.COMPLETED as any,
        },
      }),
    ]);

    return ordersWithoutNfe + tasksWithoutNfe;
  }

  // Paint dashboard queries

  async getPaintStatistics(where?: any): Promise<{
    total: number;
    totalFormulas: number;
    byFinish: DashboardChartData;
    byBrand: DashboardChartData;
    byPalette: DashboardChartData;
  }> {
    const sanitizedWhere = this.sanitizeWhereForGroupBy(where);
    const [total, totalFormulas, byFinish, byBrandId, byPalette] = await Promise.all([
      this.prisma.paint.count({ where }),
      this.prisma.paintFormula.count({
        where: where?.id ? { paintId: where.id } : undefined,
      }),
      this.prisma.paint.groupBy({
        by: ['finish'],
        where: sanitizedWhere,
        _count: { id: true },
      }),
      this.prisma.paint.groupBy({
        by: ['paintBrandId'],
        where: sanitizedWhere,
        _count: { id: true },
      }),
      this.prisma.paint.groupBy({
        by: ['palette'],
        where: sanitizedWhere,
        _count: { id: true },
      }),
    ]);

    // Fetch brand names for non-null brand IDs
    const brandIds = byBrandId
      .map(b => (b as any).paintBrandId as string | null)
      .filter((id): id is string => id !== null);

    const brands = brandIds.length > 0
      ? await this.prisma.paintBrand.findMany({
          where: { id: { in: brandIds } },
          select: { id: true, name: true },
        })
      : [];

    const brandMap = new Map(brands.map(b => [b.id, b.name]));

    return {
      total,
      totalFormulas,
      byFinish: {
        labels: byFinish.map(
          f => PAINT_FINISH_LABELS[(f as any).finish as PAINT_FINISH] || (f as any).finish,
        ),
        datasets: [
          {
            label: 'Tintas',
            data: byFinish.map(f => (f as any)._count?.id ?? 0),
          },
        ],
      },
      byBrand: {
        labels: byBrandId.map(b => {
          const brandId = (b as any).paintBrandId as string | null;
          return brandId ? (brandMap.get(brandId) || 'Desconhecido') : 'Sem marca';
        }),
        datasets: [
          {
            label: 'Tintas',
            data: byBrandId.map(b => (b as any)._count?.id ?? 0),
          },
        ],
      },
      byPalette: {
        labels: byPalette.map(
          p => COLOR_PALETTE_LABELS[(p as any).palette as COLOR_PALETTE] || (p as any).palette,
        ),
        datasets: [
          {
            label: 'Tintas',
            data: byPalette.map(p => (p as any)._count?.id ?? 0),
          },
        ],
      },
    };
  }

  async getProductionStatistics(where?: any): Promise<{
    total: number;
    totalWeight: number;
    totalVolume: number;
    byFormula: DashboardListItem[];
    recent: Array<any>;
  }> {
    const currentMonthRange = this.getCurrentMonthRange();
    const productionWhere = {
      ...where,
      createdAt: currentMonthRange,
    };

    const [total, aggregates, byFormula, recent] = await Promise.all([
      this.prisma.paintProduction.count({ where: productionWhere }),
      this.prisma.paintProduction.aggregate({
        where: productionWhere,
        _sum: {
          volumeLiters: true,
        },
      }),
      this.prisma.paintProduction.groupBy({
        by: ['formulaId'],
        where: productionWhere,
        _count: { id: true },
      }),
      this.prisma.paintProduction.findMany({
        where: productionWhere,
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          formulaId: true,
          volumeLiters: true,
          createdAt: true,
        },
      }),
    ]);

    const formulaIds = byFormula.map(f => f.formulaId);
    const formulas = await this.prisma.paintFormula.findMany({
      where: { id: { in: formulaIds } },
      select: { id: true, description: true },
    });

    const formulaMap = new Map(formulas.map(f => [f.id, f.description]));

    return {
      total,
      totalWeight: 0, // PaintProduction doesn't have weight field
      totalVolume: aggregates._sum?.volumeLiters ?? 0,
      byFormula: byFormula.map(f => ({
        id: f.formulaId,
        name: formulaMap.get(f.formulaId) || 'Fórmula desconhecida',
        value: (f as any)._count?.id ?? 0,
      })),
      recent,
    };
  }

  async getFormulaStatistics(paintId?: string): Promise<{
    perPaint: DashboardChartData;
    avgDensity: number;
    avgPrice: number;
    byPaintType: DashboardListItem[];
  }> {
    const where = paintId ? { paintId } : undefined;

    const [perPaint, aggregates, formulas] = await Promise.all([
      this.prisma.paintFormula.groupBy({
        by: ['paintId'],
        where,
        _count: { id: true },
      }),
      this.prisma.paintFormula.aggregate({
        where,
        _avg: {
          density: true,
          pricePerLiter: true,
        },
      }),
      this.prisma.paintFormula.findMany({
        where,
        include: {
          paint: {
            include: {
              paintType: true,
            },
          },
        },
      }),
    ]);

    const paintIds = perPaint.map(p => p.paintId);
    const paints = await this.prisma.paint.findMany({
      where: { id: { in: paintIds } },
      select: { id: true, name: true },
    });

    const paintMap = new Map(paints.map(p => [p.id, p.name]));

    // Group by paint type
    const byPaintType = new Map<string, { count: number; name: string }>();
    for (const formula of formulas) {
      if ((formula as any).paint?.paintType) {
        const typeId = (formula as any).paint.paintTypeId;
        const typeName = (formula as any).paint.paintType.name;
        const current = byPaintType.get(typeId) || { count: 0, name: typeName };
        byPaintType.set(typeId, { count: current.count + 1, name: typeName });
      }
    }

    return {
      perPaint: {
        labels: perPaint.map(p => paintMap.get((p as any).paintId) || 'Tinta desconhecida'),
        datasets: [
          {
            label: 'Fórmulas',
            data: perPaint.map(p => (p as any)._count?.id ?? 0),
          },
        ],
      },
      avgDensity: Number((aggregates as any)._avg?.density) ?? 0,
      avgPrice: Number((aggregates as any)._avg?.pricePerLiter) ?? 0,
      byPaintType: Array.from(byPaintType.entries()).map(([id, data]) => ({
        id,
        name: data.name,
        value: data.count,
      })),
    };
  }

  async getComponentStatistics(): Promise<{
    total: number;
    byFormula: DashboardChartData;
    mostUsed: DashboardListItem[];
  }> {
    const [components, byFormula] = await Promise.all([
      this.prisma.paintFormulaComponent.findMany({
        distinct: ['itemId'],
      }),
      this.prisma.paintFormulaComponent.groupBy({
        by: ['formulaPaintId'],
        _count: { id: true },
      }),
    ]);

    const componentUsage = await this.prisma.paintFormulaComponent.groupBy({
      by: ['itemId'],
      _count: { id: true },
    });

    const itemIds = componentUsage.map(c => c.itemId);
    const items = await this.prisma.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true },
    });

    const itemMap = new Map(items.map(i => [i.id, i.name]));

    const formulaIds = byFormula.map(f => (f as any).formulaPaintId);
    const formulas = await this.prisma.paintFormula.findMany({
      where: { id: { in: formulaIds } },
      select: { id: true, description: true },
    });

    const formulaMap = new Map(formulas.map(f => [f.id, f.description]));

    return {
      total: components.length,
      byFormula: {
        labels: byFormula.map(
          f => formulaMap.get((f as any).formulaPaintId) || 'Fórmula desconhecida',
        ),
        datasets: [
          {
            label: 'Componentes',
            data: byFormula.map(f => (f as any)._count?.id ?? 0),
          },
        ],
      },
      mostUsed: componentUsage
        .map(c => ({
          id: (c as any).itemId,
          name: itemMap.get((c as any).itemId) || 'Componente desconhecido',
          value: (c as any)._count?.id ?? 0,
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    };
  }

  async getProductionOverview(
    baseWhere: any,
    paintIds?: string[],
  ): Promise<PaintProductionOverview> {
    const currentMonthRange = this.getCurrentMonthRange();
    const productionWhere: any = {
      ...baseWhere,
      createdAt: currentMonthRange,
    };
    if (paintIds?.length) {
      productionWhere.formula = {
        paintId: { in: paintIds },
      };
    }

    const [totalProductions, aggregations, currentMonthProductions] = await Promise.all([
      this.prisma.paintProduction.count({ where: productionWhere }),
      this.prisma.paintProduction.aggregate({
        where: productionWhere,
        _sum: {
          volumeLiters: true,
        },
        _avg: {
          volumeLiters: true,
        },
      }),
      this.prisma.paintProduction.findMany({
        where: productionWhere,
        select: {
          createdAt: true,
          volumeLiters: true,
        },
      }),
    ]);

    // For current month only
    const currentMonth = new Date().toISOString().substring(0, 7);
    const productionsByMonth = [
      {
        month: currentMonth,
        count: currentMonthProductions.length,
        volumeLiters: currentMonthProductions.reduce((sum, item) => sum + item.volumeLiters, 0),
        weightKg: 0, // PaintProduction doesn't have weight field
      },
    ];

    return {
      totalProductions,
      totalVolumeLiters: aggregations._sum?.volumeLiters ?? 0,
      totalWeightKg: 0, // PaintProduction doesn't have weight field
      averageVolumePerProduction: aggregations._avg?.volumeLiters ?? 0,
      productionsByMonth,
    };
  }

  async getFormulaMetrics(
    baseWhere: any,
    paintTypeIds?: string[],
    paintIds?: string[],
  ): Promise<PaintFormulaMetrics> {
    const formulaWhere: any = { ...baseWhere };
    if (paintIds?.length) {
      formulaWhere.paintId = { in: paintIds };
    }
    if (paintTypeIds?.length) {
      formulaWhere.paint = {
        paintTypeId: { in: paintTypeIds },
      };
    }

    const [totalFormulas, aggregations, formulas] = await Promise.all([
      this.prisma.paintFormula.count({ where: formulaWhere }),
      this.prisma.paintFormula.aggregate({
        where: formulaWhere,
        _avg: {
          density: true,
          pricePerLiter: true,
        },
      }),
      this.prisma.paintFormula.findMany({
        where: formulaWhere,
        include: {
          paint: {
            include: {
              paintType: true,
            },
          },
          paintProduction: true,
        },
      }),
    ]);

    const formulasWithProduction = formulas
      .map(formula => ({
        id: formula.id,
        paintName: formula.paint.name,
        paintCode: '', // Code field doesn't exist in paint table
        paintTypeName: formula.paint.paintType.name,
        productionCount: formula.paintProduction.length,
        totalVolumeLiters: formula.paintProduction.reduce(
          (sum, prod) => sum + prod.volumeLiters,
          0,
        ),
      }))
      .filter(f => f.productionCount > 0)
      .sort((a, b) => b.productionCount - a.productionCount)
      .slice(0, 10);

    const formulasWithoutProduction = formulas
      .filter(f => f.paintProduction.length === 0)
      .map(formula => ({
        id: formula.id,
        paintName: formula.paint.name,
        paintCode: '', // Code field doesn't exist in paint table
      }));

    return {
      totalFormulas,
      averageDensity: Number(aggregations._avg?.density) ?? 0,
      averagePricePerLiter: Number(aggregations._avg?.pricePerLiter) ?? 0,
      mostUsedFormulas: formulasWithProduction,
      formulasWithoutProduction,
    };
  }

  async getComponentInventory(paintTypeIds?: string[]): Promise<PaintComponentInventory> {
    const paintTypeWhere = paintTypeIds?.length ? { id: { in: paintTypeIds } } : undefined;

    const componentItems = await this.prisma.item.findMany({
      where: {
        formulaComponents: {
          some: {
            formula: {
              paint: {
                paintType: paintTypeWhere,
              },
            },
          },
        },
      },
      include: {
        formulaComponents: {
          include: {
            formula: {
              include: {
                paint: {
                  include: {
                    paintType: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const lowStockComponents = componentItems
      .map(item => {
        const totalRequired = item.formulaComponents.reduce((sum, comp) => sum + comp.ratio, 0);
        return {
          id: item.id,
          name: item.name,
          code: item.uniCode,
          currentQuantity: item.quantity,
          requiredQuantity: totalRequired,
          shortageQuantity: Math.max(0, totalRequired - item.quantity),
        };
      })
      .filter(comp => comp.shortageQuantity > 0)
      .sort((a, b) => b.shortageQuantity - a.shortageQuantity)
      .slice(0, 10);

    // Group components by paint type
    const componentsByType = new Map<string, Map<string, number>>();
    for (const item of componentItems) {
      for (const comp of item.formulaComponents) {
        const paintTypeName = comp.formula.paint.paintType.name;
        if (!componentsByType.has(paintTypeName)) {
          componentsByType.set(paintTypeName, new Map());
        }
        const typeComponents = componentsByType.get(paintTypeName)!;
        typeComponents.set(item.name, (typeComponents.get(item.name) || 0) + 1);
      }
    }

    const componentUsageByType = Array.from(componentsByType.entries()).map(
      ([paintTypeName, components]) => ({
        paintTypeName,
        componentCount: components.size,
        components: Array.from(components.entries())
          .map(([itemName, usageCount]) => ({ itemName, usageCount }))
          .sort((a, b) => b.usageCount - a.usageCount),
      }),
    );

    return {
      totalComponents: componentItems.length,
      lowStockComponents,
      componentUsageByType,
    };
  }

  async getColorAnalysis(
    paintTypeIds?: string[],
    manufacturers?: string[],
    includeInactive?: boolean,
  ): Promise<PaintColorAnalysis> {
    const paintWhere: any = {};
    if (paintTypeIds?.length) {
      paintWhere.paintTypeId = { in: paintTypeIds };
    }
    if (manufacturers?.length) {
      paintWhere.manufacturer = { in: manufacturers };
    }

    const paints = await this.prisma.paint.findMany({
      where: paintWhere,
    });

    const totalColors = paints.length;

    // Group by palette
    const paletteGroups = paints.reduce(
      (acc, paint) => {
        const palette = paint.palette || 'UNKNOWN';
        acc[palette] = (acc[palette] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const colorsByPalette = Object.entries(paletteGroups).map(([palette, count]) => ({
      palette: COLOR_PALETTE_LABELS[palette as COLOR_PALETTE] || palette,
      count,
      percentage: totalColors > 0 ? (count / totalColors) * 100 : 0,
    }));

    // Group by finish
    const finishGroups = paints.reduce(
      (acc, paint) => {
        const finish = paint.finish || 'UNKNOWN';
        acc[finish] = (acc[finish] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const colorsByFinish = Object.entries(finishGroups).map(([finish, count]) => ({
      finish: PAINT_FINISH_LABELS[finish as PAINT_FINISH] || finish,
      count,
      percentage: totalColors > 0 ? (count / totalColors) * 100 : 0,
    }));

    // Group by manufacturer
    const manufacturerGroups = paints.reduce(
      (acc, paint) => {
        const manufacturer = paint.manufacturer || 'UNKNOWN';
        acc[manufacturer] = (acc[manufacturer] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const colorsByManufacturer = Object.entries(manufacturerGroups).map(
      ([manufacturer, count]) => ({
        manufacturer: TRUCK_MANUFACTURER_LABELS[manufacturer as TRUCK_MANUFACTURER] || manufacturer,
        count,
        percentage: totalColors > 0 ? (count / totalColors) * 100 : 0,
      }),
    );

    return {
      totalColors,
      colorsByPalette,
      colorsByFinish,
      colorsByManufacturer,
    };
  }

  async getEfficiencyMetrics(baseWhere: any): Promise<PaintEfficiencyMetrics> {
    const [totalFormulas, usedFormulas, productions] = await Promise.all([
      this.prisma.paintFormula.count(),
      this.prisma.paintProduction.findMany({
        distinct: ['formulaId'],
        select: { formulaId: true },
      }),
      this.prisma.paintProduction.count({ where: baseWhere }),
    ]);

    const formulaUtilizationRate =
      totalFormulas > 0 ? (usedFormulas.length / totalFormulas) * 100 : 0;

    // For now, return placeholder values for metrics we can't calculate
    return {
      averageProductionTime: null,
      productionEfficiency: 100,
      wastePercentage: 0,
      formulaUtilizationRate,
    };
  }

  async getTrends(baseWhere: any, paintTypeIds?: string[]): Promise<PaintTrends> {
    // Use the baseWhere filter which already contains the date range from the selected time period
    const trendWhere = { ...baseWhere };

    // Monthly production for selected period
    const productions = await this.prisma.paintProduction.findMany({
      where: trendWhere,
      include: {
        formula: {
          include: {
            paint: {
              include: {
                paintType: true,
              },
            },
          },
        },
      },
    });

    // Get ALL tasks that use paints in the selected period to properly count usage
    const tasks = await this.prisma.task.findMany({
      where: {
        ...trendWhere,
        OR: [{ generalPainting: { isNot: null } }, { logoPaints: { some: {} } }],
      },
      select: {
        id: true,
        name: true,
        serialNumber: true,
        createdAt: true,
        generalPainting: true,
        logoPaints: true,
        truck: {
          select: {
            plate: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group productions by month for the selected period
    const productionsByMonth = new Map<string, { count: number; volume: number }>();
    productions.forEach(prod => {
      const month = prod.createdAt.toISOString().substring(0, 7);
      const existing = productionsByMonth.get(month) || { count: 0, volume: 0 };
      existing.count++;
      existing.volume += prod.volumeLiters;
      productionsByMonth.set(month, existing);
    });

    const monthlyProduction = Array.from(productionsByMonth.entries())
      .map(([month, data]) => ({
        month,
        productions: data.count,
        volumeLiters: data.volume,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Popular colors - count usage frequency in tasks (not productions)
    // A paint used multiple times in different tasks is more popular
    const colorUsage = new Map<string, { name: string; count: number }>();

    // Count each paint usage in tasks
    tasks.forEach(task => {
      if (task.generalPainting) {
        const key = task.generalPainting.id;
        const existing = colorUsage.get(key) || { name: task.generalPainting.name, count: 0 };
        existing.count++; // Each task counts as one usage
        colorUsage.set(key, existing);
      }

      // Count from tasks (logo paints)
      task.logoPaints.forEach(paint => {
        const key = paint.id;
        const existing = colorUsage.get(key) || { name: paint.name, count: 0 };
        existing.count++; // Each task counts as one usage
        colorUsage.set(key, existing);
      });
    });

    // Also count from productions (paint formulas used in production)
    productions.forEach(prod => {
      const paint = prod.formula.paint;
      const key = paint.id;
      const existing = colorUsage.get(key) || { name: paint.name, count: 0 };
      existing.count++; // Each production also counts
      colorUsage.set(key, existing);
    });

    const popularColors = Array.from(colorUsage.values())
      .map(({ name, count }) => ({
        paintName: name,
        paintCode: '', // Paint model doesn't have a code field
        productionCount: count, // This represents usage frequency, not production count
      }))
      .sort((a, b) => b.productionCount - a.productionCount)
      .slice(0, 10);

    // Seasonal patterns for selected period
    const paintTypeProductions = productions.reduce(
      (acc, prod) => {
        const paintTypeName = prod.formula.paint.paintType.name;
        const month = prod.createdAt.toISOString().substring(0, 7);
        if (!acc[paintTypeName]) {
          acc[paintTypeName] = {};
        }
        acc[paintTypeName][month] = (acc[paintTypeName][month] || 0) + 1;
        return acc;
      },
      {} as Record<string, Record<string, number>>,
    );

    const seasonalPatterns = Object.entries(paintTypeProductions).map(
      ([paintTypeName, monthData]) => ({
        paintTypeName,
        monthlyData: Object.entries(monthData)
          .map(([month, count]) => ({ month, count }))
          .sort((a, b) => a.month.localeCompare(b.month)),
      }),
    );

    // Extract recent paint usage in tasks
    const recentPaintUsageInTasks: Array<{
      paintId: string;
      paintName: string;
      taskId: string;
      taskName: string;
      taskPlate?: string;
      taskSerialNumber?: string;
      createdAt: Date;
    }> = [];

    tasks.forEach(task => {
      // Add general painting
      if (task.generalPainting) {
        recentPaintUsageInTasks.push({
          paintId: task.generalPainting.id,
          paintName: task.generalPainting.name,
          taskId: task.id,
          taskName: task.name,
          taskPlate: task.truck?.plate || undefined,
          taskSerialNumber: task.serialNumber || undefined,
          createdAt: task.createdAt,
        });
      }

      // Add logo paints
      task.logoPaints.forEach(paint => {
        recentPaintUsageInTasks.push({
          paintId: paint.id,
          paintName: paint.name,
          taskId: task.id,
          taskName: task.name,
          taskPlate: task.truck?.plate || undefined,
          taskSerialNumber: task.serialNumber || undefined,
          createdAt: task.createdAt,
        });
      });
    });

    // Sort by creation date, newest first
    recentPaintUsageInTasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      monthlyProduction,
      popularColors,
      recentPaintUsageInTasks: recentPaintUsageInTasks.slice(0, 20), // Return top 20 most recent for better visibility
      seasonalPatterns,
    };
  }

  async countActiveFormulas(): Promise<number> {
    const usedFormulas = await this.prisma.paintProduction.findMany({
      distinct: ['formulaId'],
    });
    return usedFormulas.length;
  }

  // Helper methods
  private getCurrentMonthRange() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { gte: startOfMonth, lte: endOfMonth };
  }

  private getLast30DaysRange() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { gte: thirtyDaysAgo, lte: now };
  }

  private groupByMonth<T extends { createdAt: Date; finishedAt?: Date | null }>(
    items: T[],
    aggregator: (items: T[]) => any,
    dateField: 'createdAt' | 'finishedAt' = 'createdAt',
  ): Array<{ month: string } & ReturnType<typeof aggregator>> {
    const grouped = items.reduce(
      (acc, item) => {
        let dateToUse: Date;
        if (dateField === 'finishedAt') {
          // For finishedAt grouping, use finishedAt if available, otherwise fallback to createdAt
          dateToUse = item.finishedAt || item.createdAt;
        } else {
          dateToUse = item.createdAt;
        }

        const month = dateToUse.toISOString().substring(0, 7);
        if (!acc[month]) acc[month] = [];
        acc[month].push(item);
        return acc;
      },
      {} as Record<string, T[]>,
    );

    return Object.entries(grouped)
      .map(([month, items]) => ({
        month,
        ...aggregator(items),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  // Production dashboard implementations
  async getProductionTaskOverview(where?: any): Promise<{
    total: number;
    inProduction: number;
    completed: number;
    cancelled: number;
    onHold: number;
    averageCompletionHours: number;
  }> {
    const [total, inProduction, completed, cancelled, onHold, completedTasks] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.count({
        where: { ...where, status: TASK_STATUS.IN_PRODUCTION },
      }),
      this.prisma.task.count({
        where: { ...where, status: TASK_STATUS.COMPLETED },
      }),
      this.prisma.task.count({
        where: { ...where, status: TASK_STATUS.CANCELLED },
      }),
      this.prisma.task.count({
        where: { ...where, status: TASK_STATUS.ON_HOLD },
      }),
      this.prisma.task.findMany({
        where: { ...where, status: TASK_STATUS.COMPLETED, finishedAt: { not: null } },
        select: {
          createdAt: true,
          finishedAt: true,
        },
      }),
    ]);

    const averageCompletionHours =
      completedTasks.length > 0
        ? completedTasks.reduce((sum, task) => {
            if (task.finishedAt) {
              const diffMs = task.finishedAt.getTime() - task.createdAt.getTime();
              return sum + diffMs / (1000 * 60 * 60);
            }
            return sum;
          }, 0) / completedTasks.length
        : 0;

    return { total, inProduction, completed, cancelled, onHold, averageCompletionHours };
  }

  async getServiceOrderStatistics(where?: any): Promise<{
    total: number;
    pending: number;
    completed: number;
    byType: DashboardChartData;
    byService: Array<{
      serviceName: string;
      count: number;
      percentage: number;
    }>;
    averageServicesPerOrder: number;
  }> {
    // Convert the where clause to filter by task creation date instead of service order creation date
    let serviceOrderWhere: any = {};

    if (where && where.createdAt) {
      // Filter by task creation date instead of service order creation date
      serviceOrderWhere = {
        task: {
          createdAt: where.createdAt,
          ...(where.sectorId && { sectorId: where.sectorId }),
          ...(where.customerId && { customerId: where.customerId }),
        },
      };
    } else {
      // If no date filter, apply other filters directly
      serviceOrderWhere = {
        ...(where?.sectorId && { task: { sectorId: where.sectorId } }),
        ...(where?.customerId && { task: { customerId: where.customerId } }),
      };
    }

    const [orders, totalOrders] = await Promise.all([
      this.prisma.serviceOrder.findMany({
        where: serviceOrderWhere,
      }),
      this.prisma.serviceOrder.count({ where: serviceOrderWhere }),
    ]);

    const total = orders.length;
    const pending = orders.filter(order => order.status !== 'COMPLETED').length;
    const completed = orders.filter(order => order.status === 'COMPLETED').length;

    // Group service orders by their description (service name)
    const serviceGroups = orders.reduce(
      (acc, order) => {
        const serviceName = order.description || 'Sem descrição';
        acc[serviceName] = (acc[serviceName] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Sort services by count and get top 5
    const sortedServices = Object.entries(serviceGroups)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    // Calculate the count for "Outros" (everything not in top 5)
    const topServicesCount = sortedServices.reduce((sum, [, count]) => sum + count, 0);
    const othersCount = total - topServicesCount;

    // Create byService array with top 5 + "Outros" if needed
    const byService = sortedServices.map(([serviceName, count]) => ({
      serviceName,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }));

    // Add "Outros" if there are services not in top 5
    if (othersCount > 0) {
      byService.push({
        serviceName: 'Outros',
        count: othersCount,
        percentage: total > 0 ? Math.round((othersCount / total) * 100) : 0,
      });
    }

    // Group by service type (placeholder implementation)
    const byType: DashboardChartData = {
      labels: ['Manutenção', 'Instalação', 'Reparo', 'Outros'],
      datasets: [
        {
          label: 'Ordens por Tipo',
          data: [25, 30, 20, 25], // Mock data - implement actual grouping
        },
      ],
    };

    const averageServicesPerOrder = 1; // Each service order is one service

    return { total, pending, completed, byType, byService, averageServicesPerOrder };
  }

  async getProductionCustomerMetrics(where?: any): Promise<{
    activeCustomers: number;
    topByTasks: DashboardListItem[];
    topByRevenue: DashboardListItem[];
    byType: DashboardChartData;
    byCity: DashboardChartData;
  }> {
    const [customersWithTasks, customersByTasks, customers] = await Promise.all(
      [
        this.prisma.customer.count({
          where: {
            ...(where?.customerId && { id: where.customerId }),
            tasks: { some: {} },
          },
        }),
        this.prisma.customer.findMany({
          take: 10,
          include: {
            _count: { select: { tasks: true } },
            tasks: { select: { id: true } },
          },
          orderBy: { tasks: { _count: 'desc' } },
        }),
        this.prisma.customer.findMany({
          select: {
            cnpj: true,
            cpf: true,
            city: true,
          },
        }),
      ],
    );

    const topByTasks = customersByTasks.map(customer => ({
      id: customer.id,
      name: customer.fantasyName || customer.corporateName,
      value: customer._count.tasks,
    }));

    const topByRevenue = customersByTasks.map(customer => ({
      id: customer.id,
      name: customer.fantasyName || customer.corporateName,
      value: 0,
    }));

    const physicalPersons = customers.filter(c => c.cpf).length;
    const legalEntities = customers.filter(c => c.cnpj).length;

    const byType: DashboardChartData = {
      labels: ['Pessoa Física', 'Pessoa Jurídica'],
      datasets: [
        {
          label: 'Clientes por Tipo',
          data: [physicalPersons, legalEntities],
        },
      ],
    };

    const cityGroups = customers.reduce(
      (acc, customer) => {
        const city = customer.city || 'Não informado';
        acc[city] = (acc[city] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const byCity: DashboardChartData = {
      labels: Object.keys(cityGroups),
      datasets: [
        {
          label: 'Clientes por Cidade',
          data: Object.values(cityGroups),
        },
      ],
    };

    return {
      activeCustomers: customersWithTasks,
      topByTasks,
      topByRevenue,
      byType,
      byCity,
    };
  }

  async getGarageUtilizationMetrics(garageId?: string): Promise<{
    totalGarages: number;
    totalParkingSpots: number;
    occupiedSpots: number;
    spotsByGarage: DashboardChartData;
  }> {
    const where = garageId ? { id: garageId } : {};

    const garages = await this.prisma.garage.findMany({
      where,
      include: {
        _count: { select: { trucks: true } },
      },
    });

    const totalGarages = garages.length;
    const totalParkingSpots = garages.reduce((sum, garage) => sum + garage._count.trucks, 0);

    const spotsByGarage: DashboardChartData = {
      labels: garages.map(g => g.name),
      datasets: [
        {
          label: 'Caminhões por Garagem',
          data: garages.map(g => g._count.trucks),
        },
      ],
    };

    // Calculate occupied spots based on actual truck count
    const occupiedSpots = totalParkingSpots;

    return {
      totalGarages,
      totalParkingSpots,
      occupiedSpots,
      spotsByGarage,
    };
  }

  async getTruckMetrics(): Promise<{
    total: number;
    inProduction: number;
    byManufacturer: DashboardChartData;
    byPosition: DashboardListItem[];
  }> {
    const [trucks, trucksInProduction] = await Promise.all([
      this.prisma.truck.findMany({
        select: {
          id: true,
          plate: true,
          garage: { select: { name: true } },
          task: { select: { status: true, name: true } },
        },
      }),
      this.prisma.truck.count({
        where: {
          task: { status: { in: [TASK_STATUS.IN_PRODUCTION, TASK_STATUS.PENDING] } },
        },
      }),
    ]);

    const total = trucks.length;

    // Mock manufacturer data since it's not in the schema
    const manufacturerGroups = {
      Mercedes: Math.floor(total * 0.4),
      Scania: Math.floor(total * 0.3),
      Volvo: Math.floor(total * 0.2),
      Outros: Math.floor(total * 0.1),
    };

    const byManufacturer: DashboardChartData = {
      labels: Object.keys(manufacturerGroups),
      datasets: [
        {
          label: 'Caminhões por Fabricante',
          data: Object.values(manufacturerGroups),
        },
      ],
    };

    const byPosition = trucks.map(truck => ({
      id: truck.id,
      name: `${truck.plate || 'Sem placa'} - ${truck.task.name}`,
      value: 1,
      metadata: {
        position: truck.garage?.name || 'Sem posição',
        inProduction: truck.task.status === TASK_STATUS.IN_PRODUCTION,
      },
    }));

    return {
      total,
      inProduction: trucksInProduction,
      byManufacturer,
      byPosition,
    };
  }

  async getCuttingOperationMetrics(where?: any): Promise<{
    totalCuts: number;
    pendingCuts: number;
    completedCuts: number;
    byType: DashboardChartData;
    averageCutTimeHours: number;
  }> {
    const [cuts, completedCuts] = await Promise.all([
      this.prisma.cut.findMany({
        where,
      }),
      this.prisma.cut.findMany({
        where: { ...where, completedAt: { not: null } },
        select: {
          createdAt: true,
          completedAt: true,
          type: true,
        },
      }),
    ]);

    const totalCuts = cuts.length;
    const pendingCuts = cuts.filter(cut => !cut.completedAt).length;
    const completedCutsCount = cuts.filter(cut => cut.completedAt).length;

    const typeGroups = cuts.reduce(
      (acc, cut) => {
        const type = cut.type === 'VINYL' ? 'Vinil' : cut.type === 'STENCIL' ? 'Stencil' : 'Outros';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const byType: DashboardChartData = {
      labels: Object.keys(typeGroups),
      datasets: [
        {
          label: 'Cortes por Tipo',
          data: Object.values(typeGroups),
        },
      ],
    };

    const averageCutTimeHours =
      completedCuts.length > 0
        ? completedCuts.reduce((sum, cut) => {
            if (cut.completedAt) {
              const diffMs = cut.completedAt.getTime() - cut.createdAt.getTime();
              return sum + diffMs / (1000 * 60 * 60);
            }
            return sum;
          }, 0) / completedCuts.length
        : 0;

    return {
      totalCuts,
      pendingCuts,
      completedCuts: completedCutsCount,
      byType,
      averageCutTimeHours,
    };
  }

  async getAirbrushingMetrics(where?: any): Promise<{
    totalJobs: number;
    pendingJobs: number;
    completedJobs: number;
    byType: DashboardChartData;
    averageTimeHours: number;
  }> {
    const [jobs, completedJobs] = await Promise.all([
      this.prisma.airbrushing.findMany({
        where,
      }),
      this.prisma.airbrushing.findMany({
        where: { ...where, finishDate: { not: null } },
        select: {
          createdAt: true,
          finishDate: true,
        },
      }),
    ]);

    const totalJobs = jobs.length;
    const pendingJobs = jobs.filter(job => !job.finishDate).length;
    const completedJobsCount = jobs.filter(job => job.finishDate).length;

    // Mock type data since there's no type field in the schema
    const typeGroups = {
      Padrão: Math.floor(totalJobs * 0.6),
      Especial: Math.floor(totalJobs * 0.4),
    };

    const byType: DashboardChartData = {
      labels: Object.keys(typeGroups),
      datasets: [
        {
          label: 'Aerógrafo por Tipo',
          data: Object.values(typeGroups),
        },
      ],
    };

    const averageTimeHours =
      completedJobs.length > 0
        ? completedJobs.reduce((sum, job) => {
            if (job.finishDate) {
              const diffMs = job.finishDate.getTime() - job.createdAt.getTime();
              return sum + diffMs / (1000 * 60 * 60);
            }
            return sum;
          }, 0) / completedJobs.length
        : 0;

    return {
      totalJobs,
      pendingJobs,
      completedJobs: completedJobsCount,
      byType,
      averageTimeHours,
    };
  }

  async getProductionRevenueAnalysis(where?: any): Promise<{
    totalRevenue: number;
    averageTaskValue: number;
    byMonth: TimeSeriesDataPoint[];
    bySector: DashboardChartData;
    byCustomerType: DashboardChartData;
  }> {
    const totalRevenue = 0;
    const averageTaskValue = 0;

    const byMonth: TimeSeriesDataPoint[] = [];

    const bySector: DashboardChartData = {
      labels: [],
      datasets: [
        {
          label: 'Receita por Setor',
          data: [],
        },
      ],
    };

    const physicalPersonRevenue = 0;

    const legalEntityRevenue = 0;

    const byCustomerType: DashboardChartData = {
      labels: ['Pessoa Física', 'Pessoa Jurídica'],
      datasets: [
        {
          label: 'Receita por Tipo de Cliente',
          data: [physicalPersonRevenue, legalEntityRevenue],
        },
      ],
    };

    return {
      totalRevenue,
      averageTaskValue,
      byMonth,
      bySector,
      byCustomerType,
    };
  }

  async getProductionProductivityMetrics(
    where?: any,
    timePeriod?: string,
  ): Promise<{
    tasksPerDay: number;
    averageTasksPerUser: number;
    tasksBySector: DashboardChartData;
    tasksByShift: DashboardChartData;
    efficiency: number;
  }> {
    // Note: For productivity metrics, we're filtering by finishedAt, not createdAt
    const [tasks, totalUsers, tasksBySector] = await Promise.all([
      this.prisma.task.findMany({
        where,
        select: {
          createdAt: true,
          finishedAt: true,
          status: true,
          createdBy: true,
        },
      }),
      this.prisma.user.count({ where: { status: { in: [...ACTIVE_USER_STATUSES] } } }),
      this.prisma.task.findMany({
        where,
        include: {
          sector: { select: { name: true } },
        },
      }),
    ]);

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(task => task.status === TASK_STATUS.COMPLETED).length;
    const efficiency = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    // Calculate tasks per day based on date range (using finishedAt from where clause)
    const dateRange = where?.finishedAt || where?.createdAt;
    let daysDiff = 30; // Default to 30 days if no range specified

    if (dateRange?.gte && dateRange?.lte) {
      const start = new Date(dateRange.gte);
      const end = new Date(dateRange.lte);
      daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) || 1;
    }

    const tasksPerDay = daysDiff > 0 ? totalTasks / daysDiff : 0;
    const averageTasksPerUser = totalUsers > 0 ? totalTasks / totalUsers : 0;

    const sectorGroups = tasksBySector.reduce(
      (acc, task) => {
        const sectorName = task.sector?.name || 'Sem setor';
        acc[sectorName] = (acc[sectorName] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const tasksBySectorChart: DashboardChartData = {
      labels: Object.keys(sectorGroups),
      datasets: [
        {
          label: 'Tarefas por Setor',
          data: Object.values(sectorGroups),
        },
      ],
    };

    // Calculate average tasks by day of week based on completion date
    // Since we're already filtering by finishedAt and status=COMPLETED in WHERE clause,
    // all tasks here are completed within the date range
    const tasksByWeekday: Record<number, number> = {
      0: 0, // Monday
      1: 0, // Tuesday
      2: 0, // Wednesday
      3: 0, // Thursday
      4: 0, // Friday
    };

    // Group tasks by weekday (they're already filtered by finishedAt in WHERE)
    tasks.forEach(task => {
      // Use finishedAt if available, otherwise skip
      if (!task.finishedAt) return;

      const date = new Date(task.finishedAt);
      const dayOfWeek = date.getDay();

      // Skip weekends (0 = Sunday, 6 = Saturday)
      if (dayOfWeek === 0 || dayOfWeek === 6) return;

      const adjustedDay = dayOfWeek - 1; // Convert to 0-4 (Mon-Fri)
      tasksByWeekday[adjustedDay]++;
    });

    // Calculate the actual date range for counting weekday occurrences
    const startDate = dateRange?.gte ? new Date(dateRange.gte) : new Date(new Date().setDate(1));
    const endDate = dateRange?.lte ? new Date(dateRange.lte) : new Date();

    // Special handling for different time periods
    // timePeriod is now passed as a separate parameter
    let weekdayData: number[];

    if (timePeriod === DASHBOARD_TIME_PERIOD.THIS_WEEK || daysDiff <= 7) {
      // For "This Week": Show actual counts, not averages
      weekdayData = [0, 1, 2, 3, 4].map(index => tasksByWeekday[index] || 0);
    } else if (timePeriod === DASHBOARD_TIME_PERIOD.ALL_TIME) {
      // For ALL_TIME: We need to count unique dates where tasks were completed
      // to get the correct number of occurrences for each weekday
      const uniqueDatesPerWeekday: Record<number, Set<string>> = {
        0: new Set(), // Monday dates
        1: new Set(), // Tuesday dates
        2: new Set(), // Wednesday dates
        3: new Set(), // Thursday dates
        4: new Set(), // Friday dates
      };

      // Track unique dates for each weekday from completed tasks
      tasks.forEach(task => {
        if (!task.finishedAt) return;
        const date = new Date(task.finishedAt);
        const dayOfWeek = date.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) return; // Skip weekends

        const adjustedDay = dayOfWeek - 1;
        const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        uniqueDatesPerWeekday[adjustedDay].add(dateKey);
      });

      // Calculate averages based on unique dates
      weekdayData = [0, 1, 2, 3, 4].map(index => {
        const totalTasks = tasksByWeekday[index] || 0;
        const uniqueDays = uniqueDatesPerWeekday[index].size || 1; // Number of unique days with tasks

        // True average: total tasks / number of days that had tasks
        const average = totalTasks / uniqueDays;
        return Math.round(average * 10) / 10; // Round to 1 decimal
      });
    } else {
      // For month/year: Calculate based on all occurrences of each weekday in the period
      const weekdayOccurrences: Record<number, number> = {
        0: 0, // Monday
        1: 0, // Tuesday
        2: 0, // Wednesday
        3: 0, // Thursday
        4: 0, // Friday
      };

      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getDay();
        // Count weekdays only (Monday = 1, Friday = 5)
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          weekdayOccurrences[dayOfWeek - 1]++;
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Calculate averages for each weekday
      weekdayData = [0, 1, 2, 3, 4].map(index => {
        const totalTasks = tasksByWeekday[index] || 0;
        const occurrences = weekdayOccurrences[index] || 1; // Avoid division by zero

        // For month/year: show average per day
        const average = totalTasks / occurrences;
        return Math.round(average * 10) / 10; // Round to 1 decimal
      });
    }

    const weekdayLabels = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];

    const tasksByShift: DashboardChartData = {
      labels: weekdayLabels,
      datasets: [
        {
          label: 'Média de Tarefas Concluídas por Dia',
          data: weekdayData,
        },
      ],
    };

    return {
      tasksPerDay,
      averageTasksPerUser,
      tasksBySector: tasksBySectorChart,
      tasksByShift,
      efficiency,
    };
  }

  // New methods for administration dashboard
  async getUserStatistics(
    where?: DashboardUserWhere,
    dateFilter?: DateFilter,
  ): Promise<{
    total: number;
    active: number;
    inactive: number;
    experiencePeriod1: number;
    experiencePeriod2: number;
    effected: number;
    dismissed: number;
    newUsersThisMonth: number;
    newUsersThisWeek: number;
    newUsersToday: number;
    monthlyGrowth: Array<{ month: string; count: number }>;
  }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const [
      total,
      active,
      inactive,
      experiencePeriod1,
      experiencePeriod2,
      effected,
      dismissed,
      newUsersThisMonth,
      newUsersThisWeek,
      newUsersToday,
    ] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.count({ where: { ...where, status: { in: [...ACTIVE_USER_STATUSES] } } }),
      this.prisma.user.count({ where: { ...where, status: USER_STATUS.DISMISSED } }),
      this.prisma.user.count({ where: { ...where, status: USER_STATUS.EXPERIENCE_PERIOD_1 } }),
      this.prisma.user.count({ where: { ...where, status: USER_STATUS.EXPERIENCE_PERIOD_2 } }),
      this.prisma.user.count({ where: { ...where, status: USER_STATUS.EFFECTED } }),
      this.prisma.user.count({ where: { ...where, status: USER_STATUS.DISMISSED } }),
      this.prisma.user.count({ where: { ...where, createdAt: { gte: startOfMonth } } }),
      this.prisma.user.count({ where: { ...where, createdAt: { gte: startOfWeek } } }),
      this.prisma.user.count({ where: { ...where, createdAt: { gte: startOfDay } } }),
    ]);

    // Get monthly growth for the last 6 months
    const monthlyGrowth: Array<{ month: string; count: number }> = [];
    const monthNames = [
      'Jan',
      'Fev',
      'Mar',
      'Abr',
      'Mai',
      'Jun',
      'Jul',
      'Ago',
      'Set',
      'Out',
      'Nov',
      'Dez',
    ];

    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);

      const count = await this.prisma.user.count({
        where: {
          ...where,
          createdAt: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
      });

      monthlyGrowth.push({
        month: monthNames[monthStart.getMonth()],
        count,
      });
    }

    return {
      total,
      active,
      inactive,
      experiencePeriod1,
      experiencePeriod2,
      effected,
      dismissed,
      newUsersThisMonth,
      newUsersThisWeek,
      newUsersToday,
      monthlyGrowth,
    };
  }

  async getSectorStatistics(): Promise<{
    total: number;
    usersBySector: DashboardChartData;
  }> {
    const [total, sectors] = await Promise.all([
      this.prisma.sector.count(),
      this.prisma.sector.findMany({
        select: {
          name: true,
          _count: {
            select: {
              users: true,
            },
          },
        },
      }),
    ]);

    const usersBySector: DashboardChartData = {
      labels: sectors.map(s => s.name),
      datasets: [
        {
          label: 'Usuários por Setor',
          data: sectors.map(s => s._count.users),
        },
      ],
    };

    return {
      total,
      usersBySector,
    };
  }

  async getBudgetStatistics(dateFilter?: DateFilter): Promise<{
    total: number;
  }> {
    const where: any = {};
    if (dateFilter?.gte || dateFilter?.lte) {
      where.createdAt = dateFilter;
    }

    const total = await this.prisma.file.count({
      where: {
        ...where,
        OR: [
          { taskBudgets: { some: {} } },
          { taskInvoices: { some: {} } },
          { taskReceipts: { some: {} } },
          { orderBudgets: { some: {} } },
          { orderInvoices: { some: {} } },
          { orderReceipts: { some: {} } },
        ],
      },
    });

    return { total };
  }

  async getFileStatistics(): Promise<{
    total: number;
    typeDistribution?: Array<{ type: string; count: number }>;
  }> {
    const total = await this.prisma.file.count();

    // Get file type distribution
    const files = await this.prisma.file.findMany({
      select: {
        mimetype: true,
      },
    });

    // Initialize all file types with 0
    const typeMap = new Map<string, number>([
      ['PDF', 0],
      ['IMG', 0],
      ['DOC', 0],
      ['XLS', 0],
      ['VIDEO', 0],
      ['OUTROS', 0],
    ]);

    files.forEach(file => {
      // Extract main type from mimetype (e.g., "application/pdf" -> "PDF")
      let fileType = 'OUTROS';

      if (file.mimetype.includes('pdf')) {
        fileType = 'PDF';
      } else if (
        file.mimetype.includes('image') ||
        file.mimetype.includes('png') ||
        file.mimetype.includes('jpg') ||
        file.mimetype.includes('jpeg') ||
        file.mimetype.includes('gif')
      ) {
        fileType = 'IMG';
      } else if (
        file.mimetype.includes('word') ||
        file.mimetype.includes('document') ||
        file.mimetype.includes('msword') ||
        file.mimetype.includes('vnd.openxmlformats-officedocument.wordprocessingml')
      ) {
        fileType = 'DOC';
      } else if (
        file.mimetype.includes('sheet') ||
        file.mimetype.includes('excel') ||
        file.mimetype.includes('spreadsheet') ||
        file.mimetype.includes('vnd.ms-excel') ||
        file.mimetype.includes('vnd.openxmlformats-officedocument.spreadsheetml')
      ) {
        fileType = 'XLS';
      } else if (
        file.mimetype.includes('video') ||
        file.mimetype.includes('mp4') ||
        file.mimetype.includes('avi') ||
        file.mimetype.includes('mov')
      ) {
        fileType = 'VIDEO';
      }

      typeMap.set(fileType, (typeMap.get(fileType) || 0) + 1);
    });

    // Return in the order: PDF, IMG, DOC, XLS, VIDEO, OUTROS
    const typeDistribution = [
      { type: 'PDF', count: typeMap.get('PDF') || 0 },
      { type: 'IMG', count: typeMap.get('IMG') || 0 },
      { type: 'DOC', count: typeMap.get('DOC') || 0 },
      { type: 'XLS', count: typeMap.get('XLS') || 0 },
      { type: 'VIDEO', count: typeMap.get('VIDEO') || 0 },
      { type: 'OUTROS', count: typeMap.get('OUTROS') || 0 },
    ];

    return { total, typeDistribution };
  }


  async getUserActivityByRole(): Promise<{
    byRole: DashboardChartData;
  }> {
    const positionGroups = await this.prisma.user.groupBy({
      by: ['positionId'],
      where: this.sanitizeWhereForGroupBy({ status: { in: [...ACTIVE_USER_STATUSES] } }),
      _count: { id: true },
    });

    const positions = await this.prisma.position.findMany({
      where: {
        id: { in: positionGroups.map(g => g.positionId).filter(Boolean) },
      },
    });

    const positionMap = Object.fromEntries(positions.map(p => [p.id, p.name]));
    const labels: string[] = [];
    const data: number[] = [];

    for (const group of positionGroups) {
      if (group.positionId) {
        labels.push(positionMap[group.positionId] || 'Sem cargo');
        data.push(group._count.id);
      }
    }

    // Add users without position
    const withoutPosition = positionGroups.find(g => !g.positionId);
    if (withoutPosition) {
      labels.push('Sem cargo');
      data.push(withoutPosition._count.id);
    }

    return {
      byRole: {
        labels,
        datasets: [
          {
            label: 'Usuários por Cargo',
            data,
          },
        ],
      },
    };
  }

  async getRecentChangeLogs(
    dateFilter?: DateFilter,
    limit?: number,
  ): Promise<
    Array<{
      id: string;
      entityType: string;
      action: string;
      field?: string;
      reason?: string;
      createdAt: Date;
    }>
  > {
    const where: any = {};
    if (dateFilter?.gte || dateFilter?.lte) {
      where.createdAt = dateFilter;
    }

    const logs = await this.prisma.changeLog.findMany({
      where,
      select: {
        id: true,
        entityType: true,
        action: true,
        field: true,
        reason: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });

    return logs;
  }

  // Additional HR dashboard implementations
  async countPositions(): Promise<number> {
    return this.prisma.position.count();
  }

  async countHolidays(): Promise<number> {
    // Holiday model doesn't exist yet, return 0
    return Promise.resolve(0);
  }

  async countUpcomingHolidays(): Promise<number> {
    // Holiday model doesn't exist yet, return 0
    return Promise.resolve(0);
  }

  async countWarnings(dateFilter?: DateFilter): Promise<number> {
    const where: any = {};
    if (dateFilter) {
      where.createdAt = dateFilter;
    }

    return this.prisma.warning.count({ where });
  }

  async countActiveWarnings(): Promise<number> {
    return this.prisma.warning.count({
      where: {
        isActive: true,
      },
    });
  }

  async countNewWarnings(dateFilter: DateFilter): Promise<number> {
    return this.prisma.warning.count({
      where: {
        ...(dateFilter && Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
      },
    });
  }

  async countPPETypes(): Promise<number> {
    return this.prisma.item.count({
      where: {
        ppeType: { not: null },
      },
    });
  }

  async countPPEDeliveriesToday(): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    return this.prisma.ppeDelivery.count({
      where: {
        actualDeliveryDate: {
          gte: todayStart,
          lte: todayEnd,
        },
        status: 'DELIVERED',
      },
    });
  }

  async countPendingPPEDeliveries(): Promise<number> {
    return this.prisma.ppeDelivery.count({
      where: {
        status: 'PENDING',
      },
    });
  }

  async countPPEDeliveriesThisMonth(dateFilter: DateFilter): Promise<number> {
    return this.prisma.ppeDelivery.count({
      where: {
        actualDeliveryDate: dateFilter,
        status: 'DELIVERED',
      },
    });
  }

  async countSectors(): Promise<number> {
    return this.prisma.sector.count();
  }

  async getEmployeeCountBySector(): Promise<DashboardListItem[]> {
    const sectors = await this.prisma.sector.findMany({
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            users: {
              where: { status: { in: [...ACTIVE_USER_STATUSES] } },
            },
          },
        },
      },
    });

    // Filter users by active status after fetching
    const sectorsWithUsers = await this.prisma.sector.findMany({
      select: {
        id: true,
        name: true,
        users: {
          where: { status: { in: [...ACTIVE_USER_STATUSES] } },
          select: { id: true },
        },
      },
    });

    return sectorsWithUsers.map(sector => ({
      id: sector.id,
      name: sector.name,
      value: sector.users.length,
    }));
  }

  async getRecentHRActivities(dateFilter: DateFilter, limit: number): Promise<any[]> {
    return this.prisma.changeLog.findMany({
      where: {
        ...(dateFilter && Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        entityType: {
          in: ['USER', 'POSITION', 'VACATION', 'WARNING', 'PPE_DELIVERY'],
        },
      },
      include: {
        user: {
          select: { name: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });
  }

  async countTotalVacations(): Promise<number> {
    return this.prisma.vacation.count();
  }

  async countPendingVacations(): Promise<number> {
    return this.prisma.vacation.count({
      where: {
        status: VACATION_STATUS.PENDING as any,
      },
    });
  }

  async countNewVacationsToday(): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    return this.prisma.vacation.count({
      where: {
        createdAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
    });
  }

  async countApprovedVacationsThisMonth(dateFilter: DateFilter): Promise<number> {
    return this.prisma.vacation.count({
      where: {
        status: VACATION_STATUS.APPROVED as any,
        ...(dateFilter && Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
      },
    });
  }
}
