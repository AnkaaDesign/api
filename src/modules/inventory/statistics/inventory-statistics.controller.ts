// apps/api/src/modules/inventory/statistics/inventory-statistics.controller.ts

import {
  Controller,
  Get,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InventoryStatisticsService } from './inventory-statistics.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { ZodQueryValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import type { ConsumptionStatsResponse } from '../../../schemas/inventory-statistics';
import type { InventoryConsumptionStatsFormData } from '../../../schemas/inventory-statistics';
import { inventoryConsumptionStatsSchema } from '../../../schemas/inventory-statistics';

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

@Controller('inventory-statistics')
export class InventoryStatisticsController {
  constructor(private readonly inventoryStatisticsService: InventoryStatisticsService) {}

  /**
   * Get inventory overview statistics
   */
  @Get()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  async getInventoryStatistics(
    @Query() query: any,
    @UserId() userId: string,
  ): Promise<any> {
    // Parse the dateRange from JSON string
    const filters: StatisticsFilters = {
      ...query,
      dateRange: query.dateRange ? JSON.parse(query.dateRange) : undefined,
    };

    if (filters.dateRange) {
      filters.dateRange.from = new Date(filters.dateRange.from);
      filters.dateRange.to = new Date(filters.dateRange.to);
    }

    const stats = await this.inventoryStatisticsService.getInventoryStatistics(filters, userId);
    return {
      success: true,
      message: 'Estatísticas carregadas com sucesso',
      data: stats,
    };
  }

  /**
   * Get stock trends
   */
  @Get('trends')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  async getStockTrends(
    @Query() query: any,
    @UserId() userId: string,
  ): Promise<any> {
    // Parse the dateRange from JSON string
    const filters: StatisticsFilters = {
      ...query,
      dateRange: query.dateRange ? JSON.parse(query.dateRange) : undefined,
    };

    if (filters.dateRange) {
      filters.dateRange.from = new Date(filters.dateRange.from);
      filters.dateRange.to = new Date(filters.dateRange.to);
    }

    const trends = await this.inventoryStatisticsService.getStockTrends(filters, userId);
    return {
      success: true,
      message: 'Tendências carregadas com sucesso',
      data: trends,
    };
  }

  /**
   * Get activity analytics
   */
  @Get('activities')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  async getActivityAnalytics(
    @Query() query: any,
    @UserId() userId: string,
  ): Promise<any> {
    // Parse the dateRange from JSON string
    const filters: StatisticsFilters = {
      ...query,
      dateRange: query.dateRange ? JSON.parse(query.dateRange) : undefined,
    };

    if (filters.dateRange) {
      filters.dateRange.from = new Date(filters.dateRange.from);
      filters.dateRange.to = new Date(filters.dateRange.to);
    }

    const analytics = await this.inventoryStatisticsService.getActivityAnalytics(filters, userId);
    return {
      success: true,
      message: 'Análise de atividades carregada com sucesso',
      data: analytics,
    };
  }

  /**
   * Get inventory consumption statistics
   *
   * Supports various grouping options (sector, user, item, category) and filtering
   * Returns aggregated consumption data with chart-ready format
   */
  @Get('consumption')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  async getConsumptionStatistics(
    @Query(new ZodQueryValidationPipe(inventoryConsumptionStatsSchema))
    query: InventoryConsumptionStatsFormData,
    @UserId() userId: string,
  ): Promise<ConsumptionStatsResponse> {
    return this.inventoryStatisticsService.getConsumptionStatistics(query, userId);
  }
}