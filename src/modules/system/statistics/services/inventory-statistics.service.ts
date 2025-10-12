import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  InventoryOverview,
  StockLevelData,
  ConsumptionTrend,
  AbcXyzAnalysis,
  ReorderPointAnalysis,
  SupplierPerformance,
} from '../interfaces/statistics.interface';
import {
  InventoryOverviewQueryDto,
  StockLevelsQueryDto,
  ConsumptionTrendsQueryDto,
  AbcXyzAnalysisQueryDto,
  ReorderPointsQueryDto,
  SupplierPerformanceQueryDto,
} from '../dto/query-statistics.dto';

@Injectable()
export class InventoryStatisticsService {
  private readonly logger = new Logger(InventoryStatisticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getInventoryOverview(query: InventoryOverviewQueryDto): Promise<InventoryOverview> {
    this.logger.log('Getting inventory overview statistics');

    const { startDate, endDate, categoryId, brandId, supplierId } = query;

    const where: any = { isActive: true };
    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;
    if (supplierId) where.supplierId = supplierId;

    const [
      totalItems,
      totalValueData,
      lowStockItems,
      criticalItems,
      outOfStockItems,
      categoriesData,
      brandsData,
      activitiesCount,
    ] = await Promise.all([
      // Total items count
      this.prisma.item.count({ where }),

      // Total value and quantity
      this.prisma.item.aggregate({
        where,
        _sum: { quantity: true, totalPrice: true },
      }),

      // Low stock items (quantity <= reorderPoint and > 0)
      this.prisma.item.count({
        where: {
          ...where,
          quantity: { gt: 0 },
          AND: [
            { reorderPoint: { not: null } },
            { quantity: { lte: this.prisma.item.fields.reorderPoint } },
          ],
        },
      }),

      // Critical items (quantity <= 25% of reorderPoint)
      this.prisma.item.count({
        where: {
          ...where,
          quantity: { gt: 0 },
          AND: [
            { reorderPoint: { not: null } },
            this.prisma.$queryRaw`quantity <= (COALESCE("reorderPoint", 0) * 0.25)`,
          ],
        },
      }),

      // Out of stock items
      this.prisma.item.count({
        where: { ...where, quantity: 0 },
      }),

      // Categories count
      this.prisma.itemCategory.findMany({
        where: categoryId ? { id: categoryId } : undefined,
        select: { id: true },
      }),

      // Brands count
      this.prisma.itemBrand.findMany({
        where: brandId ? { id: brandId } : undefined,
        select: { id: true },
      }),

      // Activities in date range
      this.prisma.activity.count({
        where: {
          createdAt: startDate && endDate ? {
            gte: new Date(startDate),
            lte: new Date(endDate),
          } : undefined,
        },
      }),
    ]);

    // Calculate average stock level
    const avgQuantity = await this.prisma.item.aggregate({
      where,
      _avg: { quantity: true },
    });

    // Calculate stock turnover rate (activities / total quantity)
    const stockTurnoverRate = totalValueData._sum.quantity
      ? (activitiesCount / totalValueData._sum.quantity) * 100
      : 0;

    return {
      totalItems,
      totalValue: totalValueData._sum.totalPrice || 0,
      totalQuantity: totalValueData._sum.quantity || 0,
      lowStockItems,
      criticalItems,
      outOfStockItems,
      averageStockLevel: avgQuantity._avg.quantity || 0,
      stockTurnoverRate: Math.round(stockTurnoverRate * 100) / 100,
      categories: {
        total: categoriesData.length,
        withItems: categoriesData.length,
      },
      brands: {
        total: brandsData.length,
        withItems: brandsData.length,
      },
    };
  }

  async getStockLevels(query: StockLevelsQueryDto): Promise<StockLevelData[]> {
    this.logger.log('Getting stock levels data');

    const { status, categoryId, limit = 100, offset = 0 } = query;

    const where: any = { isActive: true };
    if (categoryId) where.categoryId = categoryId;

    // Apply status filter
    if (status && status !== 'all') {
      if (status === 'critical') {
        where.AND = [
          { reorderPoint: { not: null } },
          this.prisma.$queryRaw`quantity <= (COALESCE("reorderPoint", 0) * 0.25)`,
        ];
      } else if (status === 'low') {
        where.AND = [
          { reorderPoint: { not: null } },
          this.prisma.$queryRaw`quantity > (COALESCE("reorderPoint", 0) * 0.25) AND quantity <= "reorderPoint"`,
        ];
      } else if (status === 'adequate') {
        where.AND = [
          this.prisma.$queryRaw`quantity > COALESCE("reorderPoint", 0)`,
        ];
      } else if (status === 'overstocked') {
        where.AND = [
          { maxQuantity: { not: null } },
          this.prisma.$queryRaw`quantity > "maxQuantity"`,
        ];
      }
    }

    const items = await this.prisma.item.findMany({
      where,
      select: {
        id: true,
        name: true,
        quantity: true,
        maxQuantity: true,
        reorderPoint: true,
        monthlyConsumption: true,
        category: {
          select: { name: true },
        },
        supplier: {
          select: { fantasyName: true },
        },
      },
      take: limit,
      skip: offset,
      orderBy: { quantity: 'asc' },
    });

    return items.map((item) => {
      const monthlyConsumption = Number(item.monthlyConsumption) || 0;
      const dailyConsumption = monthlyConsumption / 30;
      const daysUntilStockout = dailyConsumption > 0 ? item.quantity / dailyConsumption : null;

      let itemStatus: 'critical' | 'low' | 'adequate' | 'overstocked' = 'adequate';
      if (item.maxQuantity && item.quantity > item.maxQuantity) {
        itemStatus = 'overstocked';
      } else if (item.reorderPoint) {
        if (item.quantity <= item.reorderPoint * 0.25) {
          itemStatus = 'critical';
        } else if (item.quantity <= item.reorderPoint) {
          itemStatus = 'low';
        }
      }

      return {
        itemId: item.id,
        itemName: item.name,
        category: item.category?.name || 'Sem categoria',
        quantity: item.quantity,
        maxQuantity: item.maxQuantity,
        reorderPoint: item.reorderPoint,
        status: itemStatus,
        daysUntilStockout: daysUntilStockout ? Math.round(daysUntilStockout) : null,
        supplier: item.supplier?.fantasyName || null,
      };
    });
  }

  async getConsumptionTrends(query: ConsumptionTrendsQueryDto): Promise<ConsumptionTrend[]> {
    this.logger.log('Getting consumption trends');

    const { startDate, endDate, itemIds, categoryIds, reasons, groupBy = 'date', topN = 10 } = query;

    const where: any = {
      operation: 'OUTBOUND',
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
    };

    if (itemIds?.length) where.itemId = { in: itemIds };
    if (reasons?.length) where.reason = { in: reasons };
    if (categoryIds?.length) {
      where.item = { categoryId: { in: categoryIds } };
    }

    const activities = await this.prisma.activity.findMany({
      where,
      select: {
        id: true,
        quantity: true,
        reason: true,
        createdAt: true,
        item: {
          select: {
            id: true,
            name: true,
            category: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group by period
    const grouped = activities.reduce((acc, activity) => {
      const period = this.getPeriodKey(activity.createdAt, groupBy as any);
      if (!acc[period]) {
        acc[period] = {
          period,
          totalConsumption: 0,
          items: new Map<string, { itemId: string; itemName: string; consumption: number }>(),
          reasons: new Map<string, number>(),
        };
      }

      acc[period].totalConsumption += activity.quantity;

      // Track item consumption
      const itemKey = activity.item.id;
      const existing = acc[period].items.get(itemKey);
      if (existing) {
        existing.consumption += activity.quantity;
      } else {
        acc[period].items.set(itemKey, {
          itemId: activity.item.id,
          itemName: activity.item.name,
          consumption: activity.quantity,
        });
      }

      // Track reasons
      const reasonCount = acc[period].reasons.get(activity.reason) || 0;
      acc[period].reasons.set(activity.reason, reasonCount + 1);

      return acc;
    }, {} as Record<string, any>);

    // Convert to array and format
    return Object.values(grouped).map((group: any) => {
      const itemsArray = (Array.from(group.items.values()) as Array<{ itemId: string; itemName: string; consumption: number }>)
        .sort((a, b) => b.consumption - a.consumption)
        .slice(0, topN);

      const totalItems = itemsArray.reduce((sum, item) => sum + item.consumption, 0);

      const reasonsArray = Array.from(group.reasons.entries()).map(([reason, count]) => ({
        reason,
        count: count as number,
        percentage: Math.round(((count as number) / group.reasons.size) * 10000) / 100,
      }));

      return {
        period: group.period,
        totalConsumption: group.totalConsumption,
        itemCount: group.items.size,
        topItems: itemsArray.map((item) => ({
          ...item,
          percentage: Math.round((item.consumption / totalItems) * 10000) / 100,
        })),
        byReason: reasonsArray,
      };
    });
  }

  async getAbcXyzAnalysis(query: AbcXyzAnalysisQueryDto): Promise<AbcXyzAnalysis> {
    this.logger.log('Getting ABC/XYZ analysis');

    const { lookbackDays = 90 } = query;

    const items = await this.prisma.item.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        quantity: true,
        totalPrice: true,
        monthlyConsumption: true,
        abcCategory: true,
        xyzCategory: true,
      },
    });

    // Calculate ABC categories (based on value)
    const sortedByValue = items
      .filter((item) => item.totalPrice)
      .sort((a, b) => (b.totalPrice || 0) - (a.totalPrice || 0));

    const totalValue = sortedByValue.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    let cumulativeValue = 0;
    const abcCategories = { A: [], B: [], C: [] } as any;

    sortedByValue.forEach((item) => {
      cumulativeValue += item.totalPrice || 0;
      const percentage = (cumulativeValue / totalValue) * 100;

      if (percentage <= 80) {
        abcCategories.A.push(item);
      } else if (percentage <= 95) {
        abcCategories.B.push(item);
      } else {
        abcCategories.C.push(item);
      }
    });

    // Calculate XYZ categories (based on consumption variability)
    const xyzCategories = { X: [], Y: [], Z: [] } as any;

    items.forEach((item) => {
      const consumption = Number(item.monthlyConsumption) || 0;
      // Simplified variability calculation - in production, calculate coefficient of variation
      const variability = consumption > 0 ? Math.random() * 100 : 0; // TODO: Calculate actual variability

      if (variability < 30) {
        xyzCategories.X.push({ ...item, variability });
      } else if (variability < 60) {
        xyzCategories.Y.push({ ...item, variability });
      } else {
        xyzCategories.Z.push({ ...item, variability });
      }
    });

    // Create matrix
    const matrix = [
      { combination: 'AX', itemCount: 0, strategy: 'Gestão rigorosa de estoque' },
      { combination: 'AY', itemCount: 0, strategy: 'Monitoramento frequente' },
      { combination: 'AZ', itemCount: 0, strategy: 'Estoque de segurança alto' },
      { combination: 'BX', itemCount: 0, strategy: 'Revisão periódica' },
      { combination: 'BY', itemCount: 0, strategy: 'Gestão padrão' },
      { combination: 'BZ', itemCount: 0, strategy: 'Flexibilidade moderada' },
      { combination: 'CX', itemCount: 0, strategy: 'Revisão ocasional' },
      { combination: 'CY', itemCount: 0, strategy: 'Gestão simplificada' },
      { combination: 'CZ', itemCount: 0, strategy: 'Mínimo controle necessário' },
    ];

    items.forEach((item) => {
      const abc = item.abcCategory || 'C';
      const xyz = item.xyzCategory || 'Z';
      const combo = `${abc}${xyz}`;
      const matrixItem = matrix.find((m) => m.combination === combo);
      if (matrixItem) matrixItem.itemCount++;
    });

    return {
      abcCategories: [
        {
          category: 'A',
          itemCount: abcCategories.A.length,
          totalValue: abcCategories.A.reduce((sum: number, i: any) => sum + (i.totalPrice || 0), 0),
          percentage: Math.round((abcCategories.A.length / items.length) * 10000) / 100,
          items: abcCategories.A.slice(0, 10).map((i: any) => ({
            itemId: i.id,
            itemName: i.name,
            value: i.totalPrice || 0,
            consumption: Number(i.monthlyConsumption) || 0,
          })),
        },
        {
          category: 'B',
          itemCount: abcCategories.B.length,
          totalValue: abcCategories.B.reduce((sum: number, i: any) => sum + (i.totalPrice || 0), 0),
          percentage: Math.round((abcCategories.B.length / items.length) * 10000) / 100,
          items: abcCategories.B.slice(0, 10).map((i: any) => ({
            itemId: i.id,
            itemName: i.name,
            value: i.totalPrice || 0,
            consumption: Number(i.monthlyConsumption) || 0,
          })),
        },
        {
          category: 'C',
          itemCount: abcCategories.C.length,
          totalValue: abcCategories.C.reduce((sum: number, i: any) => sum + (i.totalPrice || 0), 0),
          percentage: Math.round((abcCategories.C.length / items.length) * 10000) / 100,
          items: abcCategories.C.slice(0, 10).map((i: any) => ({
            itemId: i.id,
            itemName: i.name,
            value: i.totalPrice || 0,
            consumption: Number(i.monthlyConsumption) || 0,
          })),
        },
      ],
      xyzCategories: [
        {
          category: 'X',
          itemCount: xyzCategories.X.length,
          variability: 20,
          items: xyzCategories.X.slice(0, 10).map((i: any) => ({
            itemId: i.id,
            itemName: i.name,
            variability: i.variability,
            avgConsumption: Number(i.monthlyConsumption) || 0,
          })),
        },
        {
          category: 'Y',
          itemCount: xyzCategories.Y.length,
          variability: 45,
          items: xyzCategories.Y.slice(0, 10).map((i: any) => ({
            itemId: i.id,
            itemName: i.name,
            variability: i.variability,
            avgConsumption: Number(i.monthlyConsumption) || 0,
          })),
        },
        {
          category: 'Z',
          itemCount: xyzCategories.Z.length,
          variability: 75,
          items: xyzCategories.Z.slice(0, 10).map((i: any) => ({
            itemId: i.id,
            itemName: i.name,
            variability: i.variability,
            avgConsumption: Number(i.monthlyConsumption) || 0,
          })),
        },
      ],
      matrix,
    };
  }

  async getReorderPoints(query: ReorderPointsQueryDto): Promise<ReorderPointAnalysis> {
    this.logger.log('Getting reorder point analysis');

    const { categoryId, supplierId, filter = 'all' } = query;

    const where: any = { isActive: true };
    if (categoryId) where.categoryId = categoryId;
    if (supplierId) where.supplierId = supplierId;

    if (filter === 'needs-reorder') {
      where.AND = [
        { reorderPoint: { not: null } },
        this.prisma.$queryRaw`quantity <= "reorderPoint"`,
      ];
    }

    const items = await this.prisma.item.findMany({
      where,
      select: {
        id: true,
        name: true,
        quantity: true,
        reorderPoint: true,
        reorderQuantity: true,
        estimatedLeadTime: true,
        monthlyConsumption: true,
        supplier: {
          select: { fantasyName: true },
        },
      },
    });

    const needsReorder = items.filter(
      (item) => item.reorderPoint && item.quantity <= item.reorderPoint,
    ).length;

    const itemsData = items.map((item) => {
      const dailyConsumption = Number(item.monthlyConsumption) / 30 || 0;
      const daysOfStock = dailyConsumption > 0 ? item.quantity / dailyConsumption : 999;
      const leadTimeDemand = dailyConsumption * (item.estimatedLeadTime || 30);
      const suggestedOrderQuantity = Math.max(
        item.reorderQuantity || 0,
        leadTimeDemand * 1.5, // 1.5x lead time demand for safety stock
      );

      return {
        itemId: item.id,
        itemName: item.name,
        currentQuantity: item.quantity,
        reorderPoint: item.reorderPoint || 0,
        reorderQuantity: item.reorderQuantity || 0,
        estimatedLeadTime: item.estimatedLeadTime || 30,
        dailyConsumption: Math.round(dailyConsumption * 100) / 100,
        daysOfStock: Math.round(daysOfStock),
        suggestedOrderQuantity: Math.round(suggestedOrderQuantity),
        supplier: item.supplier?.fantasyName || null,
      };
    });

    return {
      needsReorder,
      adequateStock: items.length - needsReorder,
      items: itemsData,
    };
  }

  async getSupplierPerformance(query: SupplierPerformanceQueryDto): Promise<SupplierPerformance[]> {
    this.logger.log('Getting supplier performance');

    const { startDate, endDate, supplierId, minOrders = 1 } = query;

    const where: any = {
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
    };

    if (supplierId) where.supplierId = supplierId;

    const orders = await this.prisma.order.findMany({
      where,
      select: {
        id: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        forecast: true,
        supplier: {
          select: { id: true, fantasyName: true },
        },
        items: {
          select: {
            price: true,
            tax: true,
            orderedQuantity: true,
            receivedQuantity: true,
            receivedAt: true,
          },
        },
      },
    });

    // Group by supplier
    const supplierMap = new Map<string, any>();

    orders.forEach((order) => {
      if (!order.supplier) return;

      const supplierId = order.supplier.id;
      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, {
          supplierId,
          supplierName: order.supplier.fantasyName,
          orders: [],
        });
      }

      supplierMap.get(supplierId).orders.push(order);
    });

    // Calculate metrics for each supplier
    const suppliers: SupplierPerformance[] = [];

    supplierMap.forEach((data) => {
      if (data.orders.length < minOrders) return;

      const totalOrders = data.orders.length;
      const fulfilledOrders = data.orders.filter((o: any) => o.status === 'FULFILLED' || o.status === 'RECEIVED').length;
      const partiallyFulfilledOrders = data.orders.filter((o: any) => o.status === 'PARTIALLY_FULFILLED' || o.status === 'PARTIALLY_RECEIVED').length;
      const cancelledOrders = data.orders.filter((o: any) => o.status === 'CANCELLED').length;

      const totalSpent = data.orders.reduce((sum: number, order: any) => {
        return sum + order.items.reduce((itemSum: number, item: any) => {
          return itemSum + (item.price * item.orderedQuantity) + item.tax;
        }, 0);
      }, 0);

      const itemsSupplied = data.orders.reduce((sum: number, order: any) => {
        return sum + order.items.length;
      }, 0);

      // Calculate delivery times
      const deliveryTimes = data.orders
        .filter((o: any) => o.forecast && o.items.some((i: any) => i.receivedAt))
        .map((o: any) => {
          const forecastDate = new Date(o.forecast);
          const receivedDate = new Date(o.items.find((i: any) => i.receivedAt)?.receivedAt || o.updatedAt);
          return (receivedDate.getTime() - forecastDate.getTime()) / (1000 * 60 * 60 * 24);
        });

      const averageDeliveryTime = deliveryTimes.length > 0
        ? deliveryTimes.reduce((sum, time) => sum + time, 0) / deliveryTimes.length
        : 0;

      const onTimeDeliveries = deliveryTimes.filter((time) => time <= 0).length;
      const onTimeDeliveryRate = deliveryTimes.length > 0
        ? (onTimeDeliveries / deliveryTimes.length) * 100
        : 0;

      suppliers.push({
        supplierId: data.supplierId,
        supplierName: data.supplierName,
        totalOrders,
        fulfilledOrders,
        partiallyFulfilledOrders,
        cancelledOrders,
        fulfillmentRate: (fulfilledOrders / totalOrders) * 100,
        averageDeliveryTime: Math.round(averageDeliveryTime * 10) / 10,
        totalSpent: Math.round(totalSpent * 100) / 100,
        itemsSupplied,
        onTimeDeliveryRate: Math.round(onTimeDeliveryRate * 10) / 10,
        qualityScore: null, // TODO: Implement quality scoring
      });
    });

    return suppliers.sort((a, b) => b.totalOrders - a.totalOrders);
  }

  private getPeriodKey(date: Date, groupBy: string): string {
    const d = new Date(date);

    switch (groupBy) {
      case 'date':
        return d.toISOString().split('T')[0];
      case 'week':
        const weekStart = new Date(d.setDate(d.getDate() - d.getDay()));
        return weekStart.toISOString().split('T')[0];
      case 'month':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      case 'quarter':
        const quarter = Math.floor(d.getMonth() / 3) + 1;
        return `${d.getFullYear()}-Q${quarter}`;
      case 'year':
        return String(d.getFullYear());
      default:
        return d.toISOString().split('T')[0];
    }
  }
}
