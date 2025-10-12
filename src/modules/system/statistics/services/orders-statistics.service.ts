import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  OrdersOverview,
  FulfillmentRates,
  SupplierComparison,
  SpendingAnalysis,
  DeliveryPerformance,
} from '../interfaces/statistics.interface';
import {
  OrdersOverviewQueryDto,
  FulfillmentRatesQueryDto,
  SupplierComparisonQueryDto,
  SpendingAnalysisQueryDto,
  DeliveryPerformanceQueryDto,
} from '../dto/query-statistics.dto';

@Injectable()
export class OrdersStatisticsService {
  private readonly logger = new Logger(OrdersStatisticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOrdersOverview(query: OrdersOverviewQueryDto): Promise<OrdersOverview> {
    const { startDate, endDate, supplierId, statuses } = query;

    const where: any = {
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
    };

    if (supplierId) where.supplierId = supplierId;
    if (statuses?.length) where.status = { in: statuses };

    const [orders, statusGroups] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: true,
          supplier: { select: { id: true, fantasyName: true } },
        },
      }),

      this.prisma.order.groupBy({
        by: ['status'],
        where,
        _count: { id: true },
      }),
    ]);

    const totalOrders = orders.length;
    const activeOrders = orders.filter((o) =>
      ['CREATED', 'PARTIALLY_FULFILLED', 'PARTIALLY_RECEIVED'].includes(o.status)
    ).length;
    const fulfilledOrders = orders.filter((o) =>
      ['FULFILLED', 'RECEIVED'].includes(o.status)
    ).length;
    const cancelledOrders = orders.filter((o) => o.status === 'CANCELLED').length;

    const totalSpent = orders.reduce((sum, order) => {
      return sum + order.items.reduce((itemSum, item) => {
        return itemSum + (item.price * item.orderedQuantity) + item.tax;
      }, 0);
    }, 0);

    const averageOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;

    const pendingOrders = orders.filter((o) =>
      ['CREATED', 'PARTIALLY_FULFILLED', 'PARTIALLY_RECEIVED'].includes(o.status)
    );
    const pendingValue = pendingOrders.reduce((sum, order) => {
      return sum + order.items.reduce((itemSum, item) => {
        return itemSum + (item.price * (item.orderedQuantity - item.receivedQuantity)) + item.tax;
      }, 0);
    }, 0);

    const byStatus = statusGroups.map((group) => {
      const statusOrders = orders.filter((o) => o.status === group.status);
      const value = statusOrders.reduce((sum, order) => {
        return sum + order.items.reduce((itemSum, item) => {
          return itemSum + (item.price * item.orderedQuantity) + item.tax;
        }, 0);
      }, 0);

      return {
        status: group.status,
        count: group._count.id,
        value: Math.round(value * 100) / 100,
        percentage: (group._count.id / totalOrders) * 100,
      };
    });

    const supplierMap = new Map<string, any>();
    orders.forEach((order) => {
      if (!order.supplier) return;
      const supplierId = order.supplier.id;
      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, {
          supplierId,
          supplierName: order.supplier.fantasyName,
          orderCount: 0,
          totalValue: 0,
        });
      }
      const supplier = supplierMap.get(supplierId);
      supplier.orderCount++;
      supplier.totalValue += order.items.reduce((sum, item) => {
        return sum + (item.price * item.orderedQuantity) + item.tax;
      }, 0);
    });

    const bySupplier = Array.from(supplierMap.values()).map((s) => ({
      ...s,
      totalValue: Math.round(s.totalValue * 100) / 100,
    }));

    return {
      totalOrders,
      activeOrders,
      fulfilledOrders,
      cancelledOrders,
      totalSpent: Math.round(totalSpent * 100) / 100,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
      pendingValue: Math.round(pendingValue * 100) / 100,
      byStatus,
      bySupplier,
    };
  }

  async getFulfillmentRates(query: FulfillmentRatesQueryDto): Promise<FulfillmentRates> {
    const { startDate, endDate, supplierId, period = 'month' } = query;

    const where: any = {
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
    };

    if (supplierId) where.supplierId = supplierId;

    const orders = await this.prisma.order.findMany({
      where,
      include: { items: true },
    });

    const totalOrders = orders.length;
    const fullyFulfilled = orders.filter((o) =>
      o.status === 'FULFILLED' || o.status === 'RECEIVED'
    ).length;
    const partiallyFulfilled = orders.filter((o) =>
      o.status === 'PARTIALLY_FULFILLED' || o.status === 'PARTIALLY_RECEIVED'
    ).length;
    const notFulfilled = orders.filter((o) => o.status === 'CREATED').length;

    const fulfillmentRate = totalOrders > 0 ? (fullyFulfilled / totalOrders) * 100 : 0;

    const totalItems = orders.reduce((sum, o) => sum + o.items.length, 0);
    const fulfilledItems = orders.reduce((sum, o) => {
      return sum + o.items.filter((i) => i.receivedQuantity >= i.orderedQuantity).length;
    }, 0);
    const itemsFulfillmentRate = totalItems > 0 ? (fulfilledItems / totalItems) * 100 : 0;

    const trendsMap = orders.reduce((acc, order) => {
      const periodKey = this.getPeriodKey(order.createdAt, period as any);
      if (!acc[periodKey]) {
        acc[periodKey] = { ordered: 0, fulfilled: 0 };
      }
      acc[periodKey].ordered++;
      if (order.status === 'FULFILLED' || order.status === 'RECEIVED') {
        acc[periodKey].fulfilled++;
      }
      return acc;
    }, {} as Record<string, any>);

    const trends = Object.entries(trendsMap).map(([date, data]: [string, any]) => ({
      date,
      ordered: data.ordered,
      fulfilled: data.fulfilled,
      rate: data.ordered > 0 ? (data.fulfilled / data.ordered) * 100 : 0,
    }));

    return {
      period: period as string,
      totalOrders,
      fullyFulfilled,
      partiallyFulfilled,
      notFulfilled,
      fulfillmentRate: Math.round(fulfillmentRate * 10) / 10,
      itemsFulfillmentRate: Math.round(itemsFulfillmentRate * 10) / 10,
      trends,
    };
  }

  async getSupplierComparison(query: SupplierComparisonQueryDto): Promise<SupplierComparison> {
    const { startDate, endDate, supplierIds, minOrders = 1 } = query;

    const where: any = {
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
    };

    if (supplierIds?.length) where.supplierId = { in: supplierIds };

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        items: true,
        supplier: { select: { id: true, fantasyName: true } },
      },
    });

    const supplierMap = new Map<string, any>();

    orders.forEach((order) => {
      if (!order.supplier) return;
      const supplierId = order.supplier.id;
      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, {
          supplierId,
          supplierName: order.supplier.fantasyName,
          orders: [],
          items: new Set<string>(),
        });
      }
      const supplier = supplierMap.get(supplierId);
      supplier.orders.push(order);
      order.items.forEach((item) => supplier.items.add(item.itemId));
    });

    const suppliers = Array.from(supplierMap.values())
      .filter((s) => s.orders.length >= minOrders)
      .map((s, index) => {
        const totalSpent = s.orders.reduce((sum: number, order: any) => {
          return sum + order.items.reduce((itemSum: number, item: any) => {
            return itemSum + (item.price * item.orderedQuantity) + item.tax;
          }, 0);
        }, 0);

        const fulfilledOrders = s.orders.filter((o: any) =>
          o.status === 'FULFILLED' || o.status === 'RECEIVED'
        ).length;
        const fulfillmentRate = (fulfilledOrders / s.orders.length) * 100;

        const deliveryTimes = s.orders
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
        const onTimeRate = deliveryTimes.length > 0
          ? (onTimeDeliveries / deliveryTimes.length) * 100
          : 0;

        return {
          supplierId: s.supplierId,
          supplierName: s.supplierName,
          orderCount: s.orders.length,
          totalSpent: Math.round(totalSpent * 100) / 100,
          averageOrderValue: Math.round(totalSpent / s.orders.length * 100) / 100,
          fulfillmentRate: Math.round(fulfillmentRate * 10) / 10,
          averageDeliveryTime: Math.round(averageDeliveryTime * 10) / 10,
          itemVariety: s.items.size,
          onTimeRate: Math.round(onTimeRate * 10) / 10,
          ranking: index + 1,
        };
      })
      .sort((a, b) => b.fulfillmentRate - a.fulfillmentRate);

    const metrics = {
      bestFulfillmentRate: suppliers[0]?.supplierName || 'N/A',
      bestDeliveryTime: suppliers.sort((a, b) => a.averageDeliveryTime - b.averageDeliveryTime)[0]?.supplierName || 'N/A',
      bestValue: suppliers.sort((a, b) => b.totalSpent - a.totalSpent)[0]?.supplierName || 'N/A',
      mostOrders: suppliers.sort((a, b) => b.orderCount - a.orderCount)[0]?.supplierName || 'N/A',
    };

    return { suppliers, metrics };
  }

  async getSpendingAnalysis(query: SpendingAnalysisQueryDto): Promise<SpendingAnalysis> {
    const { startDate, endDate, supplierId, categoryId, topN = 10 } = query;

    const where: any = {
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
    };

    if (supplierId) where.supplierId = supplierId;

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        items: {
          include: {
            item: {
              include: {
                category: true,
              },
            },
          },
        },
        supplier: { select: { id: true, fantasyName: true } },
      },
    });

    const totalSpent = orders.reduce((sum, order) => {
      return sum + order.items.reduce((itemSum, item) => {
        return itemSum + (item.price * item.orderedQuantity) + item.tax;
      }, 0);
    }, 0);

    // Category spending
    const categoryMap = new Map<string, any>();
    orders.forEach((order) => {
      order.items.forEach((item) => {
        const categoryId = item.item.category?.id || 'uncategorized';
        const categoryName = item.item.category?.name || 'Sem categoria';
        if (!categoryMap.has(categoryId)) {
          categoryMap.set(categoryId, {
            categoryId,
            categoryName,
            amount: 0,
            itemCount: 0,
          });
        }
        const category = categoryMap.get(categoryId);
        category.amount += (item.price * item.orderedQuantity) + item.tax;
        category.itemCount++;
      });
    });

    const byCategory = Array.from(categoryMap.values()).map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      amount: Math.round(c.amount * 100) / 100,
      percentage: (c.amount / totalSpent) * 100,
      itemCount: c.itemCount,
    }));

    // Supplier spending
    const supplierMap = new Map<string, any>();
    orders.forEach((order) => {
      if (!order.supplier) return;
      const supplierId = order.supplier.id;
      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, {
          supplierId,
          supplierName: order.supplier.fantasyName,
          amount: 0,
          orderCount: 0,
        });
      }
      const supplier = supplierMap.get(supplierId);
      supplier.amount += order.items.reduce((sum, item) => {
        return sum + (item.price * item.orderedQuantity) + item.tax;
      }, 0);
      supplier.orderCount++;
    });

    const bySupplier = Array.from(supplierMap.values()).map((s) => ({
      supplierId: s.supplierId,
      supplierName: s.supplierName,
      amount: Math.round(s.amount * 100) / 100,
      percentage: (s.amount / totalSpent) * 100,
      orderCount: s.orderCount,
    }));

    // Item spending
    const itemMap = new Map<string, any>();
    orders.forEach((order) => {
      order.items.forEach((item) => {
        const itemId = item.itemId;
        if (!itemMap.has(itemId)) {
          itemMap.set(itemId, {
            itemId,
            itemName: item.item.name,
            totalSpent: 0,
            quantity: 0,
            orderCount: 0,
          });
        }
        const itemData = itemMap.get(itemId);
        itemData.totalSpent += (item.price * item.orderedQuantity) + item.tax;
        itemData.quantity += item.orderedQuantity;
        itemData.orderCount++;
      });
    });

    const topItems = Array.from(itemMap.values())
      .sort((a: any, b: any) => b.totalSpent - a.totalSpent)
      .slice(0, topN)
      .map((i: any) => ({
        itemId: i.itemId,
        itemName: i.itemName,
        totalSpent: Math.round(i.totalSpent * 100) / 100,
        quantity: i.quantity,
        orderCount: i.orderCount,
      }));

    const trendsMap = orders.reduce((acc, order) => {
      const period = this.getPeriodKey(order.createdAt, 'month');
      if (!acc[period]) {
        acc[period] = { amount: 0, orderCount: 0 };
      }
      acc[period].amount += order.items.reduce((sum, item) => {
        return sum + (item.price * item.orderedQuantity) + item.tax;
      }, 0);
      acc[period].orderCount++;
      return acc;
    }, {} as Record<string, any>);

    const trends = Object.entries(trendsMap).map(([period, data]: [string, any]) => ({
      period,
      amount: Math.round(data.amount * 100) / 100,
      orderCount: data.orderCount,
      averageOrderValue: Math.round((data.amount / data.orderCount) * 100) / 100,
    }));

    return {
      totalSpent: Math.round(totalSpent * 100) / 100,
      periodSpent: Math.round(totalSpent * 100) / 100,
      byCategory,
      bySupplier,
      trends,
      topItems,
    };
  }

  async getDeliveryPerformance(query: DeliveryPerformanceQueryDto): Promise<DeliveryPerformance> {
    const { startDate, endDate, supplierId, minDeliveries = 1 } = query;

    const where: any = {
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
      forecast: { not: null },
    };

    if (supplierId) where.supplierId = supplierId;

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        items: true,
        supplier: { select: { id: true, fantasyName: true } },
      },
    });

    const deliveries = orders.filter((o) => o.items.some((i) => i.receivedAt));

    const deliveryTimes = deliveries.map((order) => {
      const forecastDate = new Date(order.forecast!);
      const receivedDate = new Date(order.items.find((i) => i.receivedAt)?.receivedAt || order.updatedAt);
      return (receivedDate.getTime() - forecastDate.getTime()) / (1000 * 60 * 60 * 24);
    });

    const averageDeliveryTime = deliveryTimes.length > 0
      ? deliveryTimes.reduce((sum, time) => sum + time, 0) / deliveryTimes.length
      : 0;

    const onTimeDeliveries = deliveryTimes.filter((time) => time <= 0).length;
    const lateDeliveries = deliveryTimes.length - onTimeDeliveries;
    const onTimeRate = deliveryTimes.length > 0
      ? (onTimeDeliveries / deliveryTimes.length) * 100
      : 0;

    // By supplier
    const supplierMap = new Map<string, any>();
    deliveries.forEach((order) => {
      if (!order.supplier) return;
      const supplierId = order.supplier.id;
      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, {
          supplierId,
          supplierName: order.supplier.fantasyName,
          times: [],
        });
      }
      const forecastDate = new Date(order.forecast!);
      const receivedDate = new Date(order.items.find((i) => i.receivedAt)?.receivedAt || order.updatedAt);
      const time = (receivedDate.getTime() - forecastDate.getTime()) / (1000 * 60 * 60 * 24);
      supplierMap.get(supplierId).times.push(time);
    });

    const bySupplier = Array.from(supplierMap.values())
      .filter((s) => s.times.length >= minDeliveries)
      .map((s) => ({
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        averageDeliveryTime: Math.round((s.times.reduce((a: number, b: number) => a + b, 0) / s.times.length) * 10) / 10,
        onTimeRate: Math.round((s.times.filter((t: number) => t <= 0).length / s.times.length) * 100 * 10) / 10,
        deliveryCount: s.times.length,
      }));

    const trendsMap = deliveries.reduce((acc, order) => {
      const period = this.getPeriodKey(order.createdAt, 'month');
      if (!acc[period]) {
        acc[period] = { times: [] };
      }
      const forecastDate = new Date(order.forecast!);
      const receivedDate = new Date(order.items.find((i) => i.receivedAt)?.receivedAt || order.updatedAt);
      const time = (receivedDate.getTime() - forecastDate.getTime()) / (1000 * 60 * 60 * 24);
      acc[period].times.push(time);
      return acc;
    }, {} as Record<string, any>);

    const trends = Object.entries(trendsMap).map(([period, data]: [string, any]) => ({
      period,
      averageTime: Math.round((data.times.reduce((a: number, b: number) => a + b, 0) / data.times.length) * 10) / 10,
      onTimeRate: Math.round((data.times.filter((t: number) => t <= 0).length / data.times.length) * 100 * 10) / 10,
    }));

    return {
      averageDeliveryTime: Math.round(averageDeliveryTime * 10) / 10,
      onTimeDeliveries,
      lateDeliveries,
      onTimeRate: Math.round(onTimeRate * 10) / 10,
      bySupplier,
      trends,
    };
  }

  private getPeriodKey(date: Date, period: string): string {
    const d = new Date(date);
    switch (period) {
      case 'day':
        return d.toISOString().split('T')[0];
      case 'week':
        const weekStart = new Date(d.setDate(d.getDate() - d.getDay()));
        return weekStart.toISOString().split('T')[0];
      case 'month':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      default:
        return d.toISOString().split('T')[0];
    }
  }
}
