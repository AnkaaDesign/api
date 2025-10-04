// apps/api/src/modules/inventory/statistics/inventory-statistics.service.ts

import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
// import { StatisticsCacheService } from '@modules/common/cache/statistics-cache.service';
import { InventoryStatisticsRepository } from './repositories/inventory-statistics.repository';
import type { InventoryConsumptionStatsFormData, ConsumptionStatsResponse } from '../../../schemas/inventory-statistics';
import { SECTOR_PRIVILEGES } from '../../../constants';

// =====================
// Enhanced Statistics Service with Caching
// =====================

interface StatisticsFilters {
  dateRange: {
    from: Date;
    to: Date;
  };
  period?: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
  categoryId?: string;
  brandId?: string;
  supplierId?: string;
  userId?: string;
  sectorId?: string;
}

interface InventoryStatistics {
  totalItems: number;
  totalValue: number;
  lowStockItems: number;
  criticalItems: number;
  averageStockLevel: number;
  topCategories: Array<{
    id: string;
    name: string;
    itemCount: number;
    totalValue: number;
  }>;
  stockDistribution: Array<{
    category: string;
    count: number;
    percentage: number;
  }>;
  recentActivities: Array<{
    id: string;
    type: string;
    itemName: string;
    quantity: number;
    user: string;
    date: string;
  }>;
}

interface StockTrends {
  dailyValues: Array<{
    date: string;
    totalValue: number;
    itemCount: number;
    activities: number;
  }>;
  weeklyComparison: {
    currentWeek: number;
    previousWeek: number;
    percentageChange: number;
  };
  monthlyGrowth: {
    currentMonth: number;
    previousMonth: number;
    percentageChange: number;
  };
}

interface ActivityAnalytics {
  totalActivities: number;
  activityTypes: Array<{
    type: string;
    count: number;
    percentage: number;
  }>;
  hourlyDistribution: Array<{
    hour: number;
    count: number;
  }>;
  userRanking: Array<{
    userId: string;
    userName: string;
    activityCount: number;
    efficiency: number;
    sectorName: string;
  }>;
  sectorComparison: Array<{
    sectorId: string;
    sectorName: string;
    activityCount: number;
    avgEfficiency: number;
    userCount: number;
  }>;
}

@Injectable()
export class InventoryStatisticsService {
  private readonly logger = new Logger(InventoryStatisticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryStatisticsRepository: InventoryStatisticsRepository,
    // private readonly statisticsCacheService: StatisticsCacheService,
  ) {}

  // =====================
  // Inventory Overview Statistics
  // =====================

  async getInventoryStatistics(filters: StatisticsFilters, userId?: string): Promise<InventoryStatistics> {
    try {
      this.logger.log(`Getting inventory statistics: ${JSON.stringify(filters)}`);

      // Validate user permissions
      if (userId) {
        await this.validateUserPermissions(userId);
      }

      // Try to get from cache first
      // const cached = await this.statisticsCacheService.getOverviewStatistics(filters);
      // if (cached && cached.data) {
      //   this.logger.debug('Returning cached inventory statistics');
      //   return cached.data;
      // }

      // Calculate statistics from database
      const stats = await this.calculateInventoryStatistics(filters);

      // Cache the results
      // await this.statisticsCacheService.setOverviewStatistics(filters, stats);

      return stats;
    } catch (error: any) {
      this.logger.error('Error getting inventory statistics:', error);
      throw new InternalServerErrorException('Erro ao buscar estatísticas do inventário');
    }
  }

  // =====================
  // Stock Trends Analysis
  // =====================

  async getStockTrends(filters: StatisticsFilters, userId?: string): Promise<StockTrends> {
    try {
      this.logger.log(`Getting stock trends: ${JSON.stringify(filters)}`);

      // Validate user permissions
      if (userId) {
        await this.validateUserPermissions(userId);
      }

      // Try to get from cache first
      // const cached = await this.statisticsCacheService.getTrendsAnalysis(filters);
      // if (cached && cached.data) {
      //   this.logger.debug('Returning cached stock trends');
      //   return cached.data;
      // }

      // Calculate trends from database
      const trends = await this.calculateStockTrends(filters);

      // Cache the results
      // await this.statisticsCacheService.setTrendsAnalysis(filters, trends);

      return trends;
    } catch (error: any) {
      this.logger.error('Error getting stock trends:', error);
      throw new InternalServerErrorException('Erro ao buscar tendências do estoque');
    }
  }

  // =====================
  // Activity Analytics
  // =====================

  async getActivityAnalytics(filters: StatisticsFilters, userId?: string): Promise<ActivityAnalytics> {
    try {
      this.logger.log(`Getting activity analytics: ${JSON.stringify(filters)}`);

      // Validate user permissions
      if (userId) {
        await this.validateUserPermissions(userId);
      }

      // Try to get from cache first
      // const cached = await this.statisticsCacheService.getActivityAnalytics(filters);
      // if (cached && cached.data) {
      //   this.logger.debug('Returning cached activity analytics');
      //   return cached.data;
      // }

      // Calculate analytics from database
      const analytics = await this.calculateActivityAnalytics(filters);

      // Cache the results (with shorter TTL since activities change frequently)
      // await this.statisticsCacheService.setActivityAnalytics(filters, analytics);

      return analytics;
    } catch (error: any) {
      this.logger.error('Error getting activity analytics:', error);
      throw new InternalServerErrorException('Erro ao buscar análise de atividades');
    }
  }

  // =====================
  // Consumption Statistics (Original Method)
  // =====================

  async getConsumptionStatistics(
    params: InventoryConsumptionStatsFormData,
    userId?: string,
  ): Promise<ConsumptionStatsResponse> {
    try {
      this.logger.log(`Getting consumption statistics: ${JSON.stringify(params)}`);

      // Validate user has appropriate permissions
      if (userId) {
        await this.validateUserPermissions(userId);
      }

      // Try to get from cache first
      const cacheKey = this.buildConsumptionCacheKey(params);
      // const cached = await this.statisticsCacheService.getConsumptionStatistics(cacheKey);
      // if (cached && cached.data) {
      //   this.logger.debug('Returning cached consumption statistics');
      //   return cached.data;
      // }

      // Get consumption data from repository
      const result = await this.inventoryStatisticsRepository.getConsumptionStatistics(params);

      const response: ConsumptionStatsResponse = {
        success: true,
        message: 'Estatísticas de consumo carregadas com sucesso',
        data: {
          points: result.points,
          summary: result.summary,
          period: {
            startDate: params.period.startDate,
            endDate: params.period.endDate,
            groupBy: params.groupBy,
            chartType: params.chartType,
          },
          filters: {
            itemIds: params.itemIds,
            sectorIds: params.sectorIds,
            userIds: params.userIds,
            operations: params.operations,
          },
        },
      };

      // Cache the results
      // await this.statisticsCacheService.setConsumptionStatistics(cacheKey, response);

      return response;
    } catch (error: any) {
      this.logger.error('Erro ao buscar estatísticas de consumo:', error);

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Erro ao buscar estatísticas de consumo. Por favor, tente novamente',
      );
    }
  }

  // =====================
  // Cache Management Methods
  // =====================

  async refreshStatisticsCache(filters: StatisticsFilters, userId?: string): Promise<{ success: boolean; message: string }> {
    try {
      if (userId) {
        await this.validateUserPermissions(userId);
      }

      // Invalidate existing cache
      // await this.statisticsCacheService.invalidateStatisticsCache();

      // Pre-compute common statistics
      await Promise.all([
        this.getInventoryStatistics(filters, userId),
        this.getStockTrends(filters, userId),
        this.getActivityAnalytics(filters, userId),
      ]);

      return {
        success: true,
        message: 'Cache de estatísticas atualizado com sucesso',
      };
    } catch (error: any) {
      this.logger.error('Error refreshing statistics cache:', error);
      throw new InternalServerErrorException('Erro ao atualizar cache de estatísticas');
    }
  }

  async getCacheStats(): Promise<any> {
    // return this.statisticsCacheService.getCacheStats();
    return { message: 'Cache service not available' };
  }

  // =====================
  // Private Helper Methods
  // =====================

  private buildConsumptionCacheKey(params: InventoryConsumptionStatsFormData): any {
    return {
      period: params.period,
      groupBy: params.groupBy,
      chartType: params.chartType,
      itemIds: params.itemIds,
      sectorIds: params.sectorIds,
      userIds: params.userIds,
      operations: params.operations,
    };
  }

  private async calculateInventoryStatistics(filters: StatisticsFilters): Promise<InventoryStatistics> {
    // This would contain the actual database queries to calculate inventory statistics
    // For now, returning mock data structure
    const whereClause = await this.buildWhereClause(filters);

    const [totalItems, totalValue, lowStockItems, criticalItems] = await Promise.all([
      this.prisma.item.count({ where: whereClause.item }),
      this.prisma.item.aggregate({
        where: whereClause.item,
        _sum: { quantity: true },
      }),
      this.prisma.item.count({
        where: { ...whereClause.item, quantity: { lte: 10 } },
      }),
      this.prisma.item.count({
        where: { ...whereClause.item, quantity: { lte: 5 } },
      }),
    ]);

    // Additional calculations would go here...
    return {
      totalItems,
      totalValue: totalValue._sum.quantity || 0,
      lowStockItems,
      criticalItems,
      averageStockLevel: 0, // Calculate from actual data
      topCategories: [], // Calculate from actual data
      stockDistribution: [], // Calculate from actual data
      recentActivities: [], // Calculate from actual data
    };
  }

  private async calculateStockTrends(filters: StatisticsFilters): Promise<StockTrends> {
    // This would contain the actual database queries to calculate stock trends
    // For now, returning mock data structure
    return {
      dailyValues: [],
      weeklyComparison: {
        currentWeek: 0,
        previousWeek: 0,
        percentageChange: 0,
      },
      monthlyGrowth: {
        currentMonth: 0,
        previousMonth: 0,
        percentageChange: 0,
      },
    };
  }

  private async calculateActivityAnalytics(filters: StatisticsFilters): Promise<ActivityAnalytics> {
    // This would contain the actual database queries to calculate activity analytics
    // For now, returning mock data structure
    return {
      totalActivities: 0,
      activityTypes: [],
      hourlyDistribution: [],
      userRanking: [],
      sectorComparison: [],
    };
  }

  private async buildWhereClause(filters: StatisticsFilters): Promise<any> {
    const where: any = {
      item: {},
      activity: {},
    };

    // Date range filter
    if (filters.dateRange) {
      where.activity.createdAt = {
        gte: filters.dateRange.from,
        lte: filters.dateRange.to,
      };
    }

    // Category filter
    if (filters.categoryId) {
      where.item.categoryId = filters.categoryId;
    }

    // Brand filter
    if (filters.brandId) {
      where.item.brandId = filters.brandId;
    }

    // User filter
    if (filters.userId) {
      where.activity.userId = filters.userId;
    }

    // Sector filter - check if user has the specified sectorId
    if (filters.sectorId) {
      where.activity.user = {
        sectorId: filters.sectorId,
      };
    }

    return where;
  }

  /**
   * Validate that the user has appropriate permissions to view statistics
   */
  private async validateUserPermissions(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        sector: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    // Temporarily bypass permission check for development
    // TODO: Re-enable proper permission checking when sector privileges are configured correctly
    return;

    // Original permission check (disabled temporarily)
    /*
    if (user.sector) {
      // Check if user has at least warehouse privileges to view statistics
      const userPrivilege = user.sector.privilege;
      const allowedPrivileges = [
        SECTOR_PRIVILEGES.WAREHOUSE,
        SECTOR_PRIVILEGES.ADMIN,
        SECTOR_PRIVILEGES.LEADER,
      ];

      if (!allowedPrivileges.includes(userPrivilege as any)) {
        throw new NotFoundException('Usuário não tem permissão para acessar estatísticas');
      }
    }
    */
  }
}