// api/src/modules/inventory/order/order-analytics.service.ts

import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type {
  OrderAnalyticsResponse,
  OrderStatusCount,
  OrderSummary,
  TopSupplier,
  TopOrderedItem,
  OrderTrendPoint,
} from '../../../types/order-analytics';
import type { OrderAnalyticsFormData } from '../../../schemas/order-analytics';
import { ORDER_STATUS } from '../../../constants/enums';
import { Prisma } from '@prisma/client';

// Status labels in Portuguese
const STATUS_LABELS: Record<ORDER_STATUS, string> = {
  [ORDER_STATUS.CREATED]: 'Criado',
  [ORDER_STATUS.PARTIALLY_FULFILLED]: 'Parcialmente Atendido',
  [ORDER_STATUS.FULFILLED]: 'Atendido',
  [ORDER_STATUS.OVERDUE]: 'Atrasado',
  [ORDER_STATUS.PARTIALLY_RECEIVED]: 'Parcialmente Recebido',
  [ORDER_STATUS.RECEIVED]: 'Recebido',
  [ORDER_STATUS.CANCELLED]: 'Cancelado',
};

@Injectable()
export class OrderAnalyticsService {
  private readonly logger = new Logger(OrderAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get comprehensive order analytics
   */
  async getOrderAnalytics(query: OrderAnalyticsFormData): Promise<OrderAnalyticsResponse> {
    try {
      const { startDate, endDate, supplierIds, topSuppliersLimit, topItemsLimit, trendGroupBy } =
        query;

      // Build base where clause
      const baseWhere: Prisma.OrderWhereInput = {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        ...(supplierIds && supplierIds.length > 0 && { supplierId: { in: supplierIds } }),
      };

      // Get all data in parallel
      const [orders, statusCounts, topSuppliers, topItems, trends] = await Promise.all([
        this.getOrdersForSummary(baseWhere),
        this.getStatusBreakdown(baseWhere),
        this.getTopSuppliers(baseWhere, topSuppliersLimit || 10),
        this.getTopItems(startDate, endDate, supplierIds, topItemsLimit || 10),
        this.getTrends(startDate, endDate, supplierIds, trendGroupBy || 'month'),
      ]);

      // Calculate summary
      const summary = this.calculateSummary(orders);

      return {
        success: true,
        message: 'Análise de pedidos carregada com sucesso',
        data: {
          summary,
          statusBreakdown: statusCounts,
          topSuppliers,
          topItems,
          trends,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar análise de pedidos:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar análise de pedidos. Por favor, tente novamente',
      );
    }
  }

  /**
   * Get orders for summary calculation
   */
  private async getOrdersForSummary(where: Prisma.OrderWhereInput) {
    return this.prisma.order.findMany({
      where,
      include: {
        items: true,
      },
    });
  }

  /**
   * An order's total value for analytics. The manual grand-total override (Valor
   * Total) wins when set — rounded to centavos and floored at 0, same convention
   * as OrderService.computeOrderPayableTotal — otherwise the item-sum used by the
   * aggregations below. Routing every aggregation through this keeps them from
   * diverging on overridden orders.
   */
  private orderTotal(order: {
    totalOverride?: number | null;
    items: Array<{ price: number; icms?: number | null; ipi?: number | null }>;
  }): number {
    if (order.totalOverride != null) {
      return Math.max(0, Math.round(order.totalOverride * 100) / 100);
    }
    return order.items.reduce(
      (sum, item) => sum + Number(item.price) + Number(item.icms || 0) + Number(item.ipi || 0),
      0,
    );
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(orders: any[]): OrderSummary {
    let totalValue = 0;
    let totalItems = 0;
    let totalFulfillmentRate = 0;
    let overdueCount = 0;
    let completedCount = 0;
    let activeCount = 0;

    for (const order of orders) {
      // Order value honors the manual grand-total override when set.
      const orderValue = this.orderTotal(order);
      totalValue += orderValue;

      // Count items
      totalItems += order.items.length;

      // Calculate fulfillment rate for this order
      if (order.items.length > 0) {
        const orderFulfillment =
          order.items.reduce((sum: number, item: any) => {
            const ordered = Number(item.orderedQuantity) || 0;
            const received = Number(item.receivedQuantity) || 0;
            return sum + (ordered > 0 ? (received / ordered) * 100 : 0);
          }, 0) / order.items.length;
        totalFulfillmentRate += orderFulfillment;
      }

      // Count by status type
      if (order.status === ORDER_STATUS.OVERDUE) {
        overdueCount++;
      } else if (
        order.status === ORDER_STATUS.RECEIVED ||
        order.status === ORDER_STATUS.CANCELLED
      ) {
        completedCount++;
      } else {
        activeCount++;
      }
    }

    const totalOrders = orders.length;

    return {
      totalOrders,
      totalValue,
      totalItems,
      averageOrderValue: totalOrders > 0 ? totalValue / totalOrders : 0,
      averageFulfillmentRate: totalOrders > 0 ? totalFulfillmentRate / totalOrders : 0,
      overdueCount,
      completedCount,
      activeCount,
    };
  }

  /**
   * Get status breakdown
   */
  private async getStatusBreakdown(where: Prisma.OrderWhereInput): Promise<OrderStatusCount[]> {
    const statusGroups = await this.prisma.order.groupBy({
      by: ['status'],
      where,
      _count: true,
    });

    // Get total for percentage calculation
    const total = statusGroups.reduce((sum, group) => sum + group._count, 0);

    // Get value per status
    const statusCounts: OrderStatusCount[] = [];

    for (const group of statusGroups) {
      // Get orders for this status to calculate value
      const ordersWithItems = await this.prisma.order.findMany({
        where: { ...where, status: group.status },
        include: { items: true },
      });

      const totalValue = ordersWithItems.reduce((sum, order) => {
        return sum + this.orderTotal(order);
      }, 0);

      statusCounts.push({
        status: group.status as ORDER_STATUS,
        statusLabel: STATUS_LABELS[group.status as ORDER_STATUS] || group.status,
        count: group._count,
        totalValue,
        percentage: total > 0 ? (group._count / total) * 100 : 0,
      });
    }

    // Sort by count descending
    return statusCounts.sort((a, b) => b.count - a.count);
  }

  /**
   * Get top suppliers
   */
  private async getTopSuppliers(
    where: Prisma.OrderWhereInput,
    limit: number,
  ): Promise<TopSupplier[]> {
    const supplierGroups = await this.prisma.order.groupBy({
      by: ['supplierId'],
      where: { ...where, supplierId: { not: null } },
      _count: true,
    });

    // Get total for percentage
    const total = supplierGroups.reduce((sum, group) => sum + group._count, 0);

    // Get supplier details and calculate values
    const suppliers: TopSupplier[] = [];

    for (const group of supplierGroups) {
      if (!group.supplierId) continue;

      const [supplier, ordersWithItems] = await Promise.all([
        this.prisma.supplier.findUnique({ where: { id: group.supplierId } }),
        this.prisma.order.findMany({
          where: { ...where, supplierId: group.supplierId },
          include: { items: true },
        }),
      ]);

      if (!supplier) continue;

      const totalValue = ordersWithItems.reduce((sum, order) => {
        return sum + this.orderTotal(order);
      }, 0);

      suppliers.push({
        supplierId: supplier.id,
        supplierName: supplier.fantasyName || supplier.corporateName || 'N/A',
        orderCount: group._count,
        totalValue,
        averageOrderValue: group._count > 0 ? totalValue / group._count : 0,
        percentage: total > 0 ? (group._count / total) * 100 : 0,
      });
    }

    // Sort by order count and limit
    return suppliers.sort((a, b) => b.orderCount - a.orderCount).slice(0, limit);
  }

  /**
   * Get top ordered items
   */
  private async getTopItems(
    startDate: Date,
    endDate: Date,
    supplierIds: string[] | undefined,
    limit: number,
  ): Promise<TopOrderedItem[]> {
    // Query order items with their orders
    const orderItems = await this.prisma.orderItem.findMany({
      where: {
        order: {
          createdAt: { gte: startDate, lte: endDate },
          ...(supplierIds && supplierIds.length > 0 && { supplierId: { in: supplierIds } }),
        },
        itemId: { not: null },
      },
      include: {
        item: {
          include: {
            brands: true,
            category: true,
          },
        },
        order: {
          select: {
            totalOverride: true,
            items: { select: { orderedQuantity: true, price: true, icms: true, ipi: true } },
          },
        },
      },
    });

    // Group by item
    const itemMap = new Map<
      string,
      {
        item: any;
        totalOrdered: number;
        totalReceived: number;
        totalValue: number;
        orderIds: Set<string>;
      }
    >();

    for (const orderItem of orderItems) {
      if (!orderItem.itemId || !orderItem.item) continue;

      const existing = itemMap.get(orderItem.itemId);
      const orderedQty = Number(orderItem.orderedQuantity);
      const unitPrice =
        Number(orderItem.price) + Number(orderItem.icms || 0) + Number(orderItem.ipi || 0);
      let itemValue = unitPrice * orderedQty;
      // Honor the order's manual grand-total override (Valor Total): it is an
      // order-level total, so distribute it across the order's items in
      // proportion to each item's value — keeping per-item analytics consistent
      // with the order total used by the other aggregations.
      const parentOrder = orderItem.order;
      if (parentOrder?.totalOverride != null) {
        const orderRaw = parentOrder.items.reduce(
          (sum, it) =>
            sum +
            (Number(it.price) + Number(it.icms || 0) + Number(it.ipi || 0)) *
              Number(it.orderedQuantity),
          0,
        );
        const override = Math.max(0, Math.round(parentOrder.totalOverride * 100) / 100);
        itemValue = orderRaw > 0 ? override * (itemValue / orderRaw) : 0;
      }

      if (existing) {
        existing.totalOrdered += orderedQty;
        existing.totalReceived += Number(orderItem.receivedQuantity);
        existing.totalValue += itemValue;
        existing.orderIds.add(orderItem.orderId);
      } else {
        itemMap.set(orderItem.itemId, {
          item: orderItem.item,
          totalOrdered: orderedQty,
          totalReceived: Number(orderItem.receivedQuantity),
          totalValue: itemValue,
          orderIds: new Set([orderItem.orderId]),
        });
      }
    }

    // Convert to array and sort
    const items: TopOrderedItem[] = Array.from(itemMap.values())
      .map(data => ({
        itemId: data.item.id,
        itemName: data.item.name,
        itemUniCode: data.item.uniCode,
        categoryName: data.item.category?.name || null,
        // Multi-brand: join all of the item's brand names for display.
        brandName: data.item.brands?.length
          ? data.item.brands.map((b: { name: string }) => b.name).join(', ')
          : null,
        totalOrdered: data.totalOrdered,
        totalReceived: data.totalReceived,
        fulfillmentRate: data.totalOrdered > 0 ? (data.totalReceived / data.totalOrdered) * 100 : 0,
        totalValue: data.totalValue,
        orderCount: data.orderIds.size,
      }))
      .sort((a, b) => b.totalOrdered - a.totalOrdered)
      .slice(0, limit);

    return items;
  }

  /**
   * Get order trends over time
   */
  private async getTrends(
    startDate: Date,
    endDate: Date,
    supplierIds: string[] | undefined,
    groupBy: 'day' | 'week' | 'month',
  ): Promise<OrderTrendPoint[]> {
    // Get all orders in the period
    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        ...(supplierIds && supplierIds.length > 0 && { supplierId: { in: supplierIds } }),
      },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    });

    // Group by period
    const trendMap = new Map<
      string,
      { orderCount: number; totalValue: number; itemCount: number }
    >();

    for (const order of orders) {
      const date = order.createdAt;
      let key: string;
      let label: string;

      if (groupBy === 'day') {
        key = date.toISOString().split('T')[0];
        label = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(date);
      } else if (groupBy === 'week') {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split('T')[0];
        label = `Sem. ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(weekStart)}`;
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        label = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' }).format(date);
      }

      const orderValue = this.orderTotal(order);

      const existing = trendMap.get(key);
      if (existing) {
        existing.orderCount++;
        existing.totalValue += orderValue;
        existing.itemCount += order.items.length;
      } else {
        trendMap.set(key, {
          orderCount: 1,
          totalValue: orderValue,
          itemCount: order.items.length,
        });
      }
    }

    // Convert to array
    return Array.from(trendMap.entries())
      .map(([date, data]) => {
        let label: string;
        if (groupBy === 'day') {
          const d = new Date(date);
          label = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(d);
        } else if (groupBy === 'week') {
          const d = new Date(date);
          label = `Sem. ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(d)}`;
        } else {
          const [year, month] = date.split('-');
          const d = new Date(parseInt(year), parseInt(month) - 1, 1);
          label = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' }).format(d);
        }

        return {
          date,
          label,
          ...data,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
