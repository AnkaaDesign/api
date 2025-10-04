// apps/api/src/modules/inventory/statistics/repositories/inventory-statistics-prisma.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { InventoryStatisticsRepository, ConsumptionStatsResult } from './inventory-statistics.repository';
import type { InventoryConsumptionStatsFormData, ConsumptionDataPoint } from '../../../../schemas/inventory-statistics';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import { ACTIVITY_OPERATION } from '../../../../constants';

@Injectable()
export class InventoryStatisticsPrismaRepository extends InventoryStatisticsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async getConsumptionStatistics(
    params: InventoryConsumptionStatsFormData,
    tx?: PrismaTransaction
  ): Promise<ConsumptionStatsResult> {
    const prismaClient = tx || this.prisma;

    // Build base where clause
    const whereClause: any = {
      createdAt: {
        gte: params.period.startDate,
        lte: params.period.endDate,
      },
      operation: {
        in: params.operations,
      },
    };

    // Add item filters
    if (params.itemIds && params.itemIds.length > 0) {
      whereClause.itemId = { in: params.itemIds };
    }

    // Add user filters
    if (params.userIds && params.userIds.length > 0) {
      whereClause.userId = { in: params.userIds };
    }

    // Add sector filters (through user relationship)
    if (params.sectorIds && params.sectorIds.length > 0) {
      whereClause.user = {
        position: {
          sectorId: { in: params.sectorIds },
        },
      };
    }

    // Add category filters (through item relationship)
    if (params.categoryIds && params.categoryIds.length > 0) {
      whereClause.item = {
        ...whereClause.item,
        categoryId: { in: params.categoryIds },
      };
    }

    // Add brand filters (through item relationship)
    if (params.brandIds && params.brandIds.length > 0) {
      whereClause.item = {
        ...whereClause.item,
        brandId: { in: params.brandIds },
      };
    }

    // Determine grouping and aggregation based on groupBy parameter
    const points = await this.getAggregatedData(prismaClient, whereClause, params);

    // Calculate summary statistics
    const summary = this.calculateSummary(points, params);

    return {
      points,
      summary,
    };
  }

  private async getAggregatedData(
    prismaClient: PrismaService | PrismaTransaction,
    whereClause: any,
    params: InventoryConsumptionStatsFormData
  ): Promise<ConsumptionDataPoint[]> {
    switch (params.groupBy) {
      case 'sector':
        return this.getConsumptionBySector(prismaClient, whereClause, params);
      case 'user':
        return this.getConsumptionByUser(prismaClient, whereClause, params);
      case 'item':
        return this.getConsumptionByItem(prismaClient, whereClause, params);
      case 'category':
        return this.getConsumptionByCategory(prismaClient, whereClause, params);
      default:
        throw new Error(`Agrupamento não suportado: ${params.groupBy}`);
    }
  }

  private async getConsumptionBySector(
    prismaClient: PrismaService | PrismaTransaction,
    whereClause: any,
    params: InventoryConsumptionStatsFormData
  ): Promise<ConsumptionDataPoint[]> {
    const results = await prismaClient.activity.groupBy({
      by: ['userId'],
      where: {
        ...whereClause,
        userId: { not: null }, // Only activities with users
      },
      _sum: {
        quantity: true,
      },
      _count: {
        id: true,
      },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
      take: params.limit,
    });

    // Get user and sector information
    const userIds = results.map(r => r.userId).filter(Boolean) as string[];
    const users = await prismaClient.user.findMany({
      where: { id: { in: userIds } },
      include: {
        position: true,
        sector: true,
      },
    });

    // Group by sector
    const sectorMap = new Map<string, {
      sectorId: string;
      sectorName: string;
      totalQuantity: number;
      activityCount: number;
      userCount: number;
    }>();

    results.forEach(result => {
      const user = users.find(u => u.id === result.userId);
      if (user?.sector) {
        const sectorId = user.sector.id;
        const sectorName = user.sector.name;
        const existing = sectorMap.get(sectorId) || {
          sectorId,
          sectorName,
          totalQuantity: 0,
          activityCount: 0,
          userCount: 0,
        };

        existing.totalQuantity += result._sum.quantity || 0;
        existing.activityCount += result._count.id;
        existing.userCount += 1;
        sectorMap.set(sectorId, existing);
      }
    });

    // Calculate pricing if requested
    let totalPrices: Map<string, number> | undefined;
    if (params.includePricing) {
      totalPrices = await this.calculatePricingBySector(prismaClient, whereClause, Array.from(sectorMap.keys()));
    }

    return Array.from(sectorMap.values())
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .map(sector => ({
        x: sector.sectorName,
        y: sector.totalQuantity,
        totalPrice: totalPrices?.get(sector.sectorId),
        entityId: sector.sectorId,
        entityType: 'sector',
        metadata: {
          activityCount: sector.activityCount,
          averagePerDay: this.calculateAveragePerDay(sector.totalQuantity, params),
        },
      }));
  }

  private async getConsumptionByUser(
    prismaClient: PrismaService | PrismaTransaction,
    whereClause: any,
    params: InventoryConsumptionStatsFormData
  ): Promise<ConsumptionDataPoint[]> {
    const results = await prismaClient.activity.groupBy({
      by: ['userId'],
      where: {
        ...whereClause,
        userId: { not: null }, // Only activities with users
      },
      _sum: {
        quantity: true,
      },
      _count: {
        id: true,
      },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
      take: params.limit,
    });

    // Get user information
    const userIds = results.map(r => r.userId).filter(Boolean) as string[];
    const users = await prismaClient.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
      },
    });

    // Calculate pricing if requested
    let totalPrices: Map<string, number> | undefined;
    if (params.includePricing) {
      totalPrices = await this.calculatePricingByUser(prismaClient, whereClause, userIds);
    }

    return results.map(result => {
      const user = users.find(u => u.id === result.userId);
      return {
        x: user?.name || 'Usuário Desconhecido',
        y: result._sum.quantity || 0,
        totalPrice: totalPrices?.get(result.userId || ''),
        entityId: result.userId || '',
        entityType: 'user',
        metadata: {
          activityCount: result._count.id,
          averagePerDay: this.calculateAveragePerDay(result._sum.quantity || 0, params),
        },
      };
    });
  }

  private async getConsumptionByItem(
    prismaClient: PrismaService | PrismaTransaction,
    whereClause: any,
    params: InventoryConsumptionStatsFormData
  ): Promise<ConsumptionDataPoint[]> {
    const results = await prismaClient.activity.groupBy({
      by: ['itemId'],
      where: whereClause,
      _sum: {
        quantity: true,
      },
      _count: {
        id: true,
      },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
      take: params.limit,
    });

    // Get item information
    const itemIds = results.map(r => r.itemId);
    const items = await prismaClient.item.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        name: true,
        uniCode: true,
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { value: true },
        },
      },
    });

    return results.map(result => {
      const item = items.find(i => i.id === result.itemId);
      const currentPrice = item?.prices[0]?.value || 0;
      const totalPrice = params.includePricing ? (result._sum.quantity || 0) * currentPrice : undefined;

      return {
        x: item?.uniCode ? `${item.uniCode} - ${item.name}` : (item?.name || 'Item Desconhecido'),
        y: result._sum.quantity || 0,
        totalPrice,
        entityId: result.itemId,
        entityType: 'item',
        metadata: {
          activityCount: result._count.id,
          averagePerDay: this.calculateAveragePerDay(result._sum.quantity || 0, params),
        },
      };
    });
  }

  private async getConsumptionByCategory(
    prismaClient: PrismaService | PrismaTransaction,
    whereClause: any,
    params: InventoryConsumptionStatsFormData
  ): Promise<ConsumptionDataPoint[]> {
    // First get all activities that match the criteria
    const activities = await prismaClient.activity.findMany({
      where: whereClause,
      include: {
        item: {
          include: {
            category: true,
            prices: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { value: true },
            },
          },
        },
      },
    });

    // Group by category
    const categoryMap = new Map<string, {
      categoryId: string;
      categoryName: string;
      totalQuantity: number;
      totalPrice: number;
      activityCount: number;
    }>();

    activities.forEach(activity => {
      if (activity.item?.category) {
        const categoryId = activity.item.category.id;
        const categoryName = activity.item.category.name;
        const existing = categoryMap.get(categoryId) || {
          categoryId,
          categoryName,
          totalQuantity: 0,
          totalPrice: 0,
          activityCount: 0,
        };

        existing.totalQuantity += activity.quantity;
        existing.activityCount += 1;

        if (params.includePricing && activity.item.prices[0]?.value) {
          existing.totalPrice += activity.quantity * activity.item.prices[0].value;
        }

        categoryMap.set(categoryId, existing);
      }
    });

    return Array.from(categoryMap.values())
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, params.limit)
      .map(category => ({
        x: category.categoryName,
        y: category.totalQuantity,
        totalPrice: params.includePricing ? category.totalPrice : undefined,
        entityId: category.categoryId,
        entityType: 'category',
        metadata: {
          activityCount: category.activityCount,
          averagePerDay: this.calculateAveragePerDay(category.totalQuantity, params),
        },
      }));
  }

  private async calculatePricingBySector(
    prismaClient: PrismaService | PrismaTransaction,
    whereClause: any,
    sectorIds: string[]
  ): Promise<Map<string, number>> {
    const pricingMap = new Map<string, number>();

    for (const sectorId of sectorIds) {
      const activities = await prismaClient.activity.findMany({
        where: {
          ...whereClause,
          user: {
            position: {
              sectorId,
            },
          },
        },
        include: {
          item: {
            include: {
              prices: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { value: true },
              },
            },
          },
        },
      });

      const totalPrice = activities.reduce((sum, activity) => {
        const price = activity.item?.prices[0]?.value || 0;
        return sum + (activity.quantity * price);
      }, 0);

      pricingMap.set(sectorId, totalPrice);
    }

    return pricingMap;
  }

  private async calculatePricingByUser(
    prismaClient: PrismaService | PrismaTransaction,
    whereClause: any,
    userIds: string[]
  ): Promise<Map<string, number>> {
    const pricingMap = new Map<string, number>();

    for (const userId of userIds) {
      const activities = await prismaClient.activity.findMany({
        where: {
          ...whereClause,
          userId,
        },
        include: {
          item: {
            include: {
              prices: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { value: true },
              },
            },
          },
        },
      });

      const totalPrice = activities.reduce((sum, activity) => {
        const price = activity.item?.prices[0]?.value || 0;
        return sum + (activity.quantity * price);
      }, 0);

      pricingMap.set(userId, totalPrice);
    }

    return pricingMap;
  }

  private calculateSummary(
    points: ConsumptionDataPoint[],
    params: InventoryConsumptionStatsFormData
  ) {
    const totalQuantity = points.reduce((sum, point) => sum + point.y, 0);
    const totalValue = params.includePricing
      ? points.reduce((sum, point) => sum + (point.totalPrice || 0), 0)
      : undefined;
    const totalActivities = points.reduce((sum, point) => sum + (point.metadata?.activityCount || 0), 0);

    const periodDays = Math.ceil(
      (params.period.endDate.getTime() - params.period.startDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const averagePerDay = periodDays > 0 ? totalQuantity / periodDays : 0;

    return {
      totalQuantity,
      totalValue,
      totalActivities,
      periodDays,
      averagePerDay,
    };
  }

  private calculateAveragePerDay(
    totalQuantity: number,
    params: InventoryConsumptionStatsFormData
  ): number {
    const periodDays = Math.ceil(
      (params.period.endDate.getTime() - params.period.startDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return periodDays > 0 ? totalQuantity / periodDays : 0;
  }
}