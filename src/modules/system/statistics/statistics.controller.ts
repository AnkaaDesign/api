import { Controller, Get, Query, HttpCode, HttpStatus, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';

// Services
import { InventoryStatisticsService } from './services/inventory-statistics.service';
import { ProductionStatisticsService } from './services/production-statistics.service';
import { OrdersStatisticsService } from './services/orders-statistics.service';
import { HrStatisticsService } from './services/hr-statistics.service';
import { FinancialStatisticsService } from './services/financial-statistics.service';

// DTOs
import {
  InventoryOverviewQueryDto,
  StockLevelsQueryDto,
  ConsumptionTrendsQueryDto,
  AbcXyzAnalysisQueryDto,
  ReorderPointsQueryDto,
  SupplierPerformanceQueryDto,
  ProductionTasksOverviewQueryDto,
  CompletionRatesQueryDto,
  CycleTimeAnalysisQueryDto,
  BottleneckAnalysisQueryDto,
  SectorPerformanceQueryDto,
  PaintUsageQueryDto,
  OrdersOverviewQueryDto,
  FulfillmentRatesQueryDto,
  SupplierComparisonQueryDto,
  SpendingAnalysisQueryDto,
  DeliveryPerformanceQueryDto,
  EmployeeOverviewQueryDto,
  PerformanceMetricsQueryDto,
  BonusDistributionQueryDto,
  AttendanceTrendsQueryDto,
  WarningAnalyticsQueryDto,
  RevenueTrendsQueryDto,
  CostAnalysisQueryDto,
  ProfitabilityQueryDto,
  BudgetTrackingQueryDto,
} from './dto/query-statistics.dto';

@ApiTags('Statistics')
@Controller('statistics')
export class StatisticsController {
  constructor(
    private readonly inventoryStats: InventoryStatisticsService,
    private readonly productionStats: ProductionStatisticsService,
    private readonly ordersStats: OrdersStatisticsService,
    private readonly hrStats: HrStatisticsService,
    private readonly financialStats: FinancialStatisticsService,
  ) {}

  // =====================
  // INVENTORY STATISTICS
  // =====================

  @Get('inventory/overview')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get inventory overview statistics' })
  @ApiResponse({ status: 200, description: 'Inventory overview retrieved successfully' })
  async getInventoryOverview(@Query(ValidationPipe) query: InventoryOverviewQueryDto) {
    const data = await this.inventoryStats.getInventoryOverview(query);
    return {
      success: true,
      message: 'Inventory overview retrieved successfully',
      data,
      metadata: {
        generatedAt: new Date(),
        period: { from: query.startDate || null, to: query.endDate || null },
      },
    };
  }

  @Get('inventory/stock-levels')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get stock levels data' })
  async getStockLevels(@Query(ValidationPipe) query: StockLevelsQueryDto) {
    const data = await this.inventoryStats.getStockLevels(query);
    return {
      success: true,
      message: 'Stock levels retrieved successfully',
      data,
    };
  }

  @Get('inventory/consumption-trends')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get consumption trends' })
  async getConsumptionTrends(@Query(ValidationPipe) query: ConsumptionTrendsQueryDto) {
    const data = await this.inventoryStats.getConsumptionTrends(query);
    return {
      success: true,
      message: 'Consumption trends retrieved successfully',
      data,
    };
  }

  @Get('inventory/abc-xyz-analysis')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get ABC/XYZ analysis' })
  async getAbcXyzAnalysis(@Query(ValidationPipe) query: AbcXyzAnalysisQueryDto) {
    const data = await this.inventoryStats.getAbcXyzAnalysis(query);
    return {
      success: true,
      message: 'ABC/XYZ analysis retrieved successfully',
      data,
    };
  }

  @Get('inventory/reorder-points')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get reorder point analysis' })
  async getReorderPoints(@Query(ValidationPipe) query: ReorderPointsQueryDto) {
    const data = await this.inventoryStats.getReorderPoints(query);
    return {
      success: true,
      message: 'Reorder point analysis retrieved successfully',
      data,
    };
  }

  @Get('inventory/supplier-performance')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get supplier performance metrics' })
  async getSupplierPerformance(@Query(ValidationPipe) query: SupplierPerformanceQueryDto) {
    const data = await this.inventoryStats.getSupplierPerformance(query);
    return {
      success: true,
      message: 'Supplier performance retrieved successfully',
      data,
    };
  }

  // =====================
  // PRODUCTION STATISTICS
  // =====================

  @Get('production/tasks-overview')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get production tasks overview' })
  async getProductionTasksOverview(@Query(ValidationPipe) query: ProductionTasksOverviewQueryDto) {
    const data = await this.productionStats.getTasksOverview(query);
    return {
      success: true,
      message: 'Production tasks overview retrieved successfully',
      data,
    };
  }

  @Get('production/completion-rates')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get task completion rates' })
  async getCompletionRates(@Query(ValidationPipe) query: CompletionRatesQueryDto) {
    const data = await this.productionStats.getCompletionRates(query);
    return {
      success: true,
      message: 'Completion rates retrieved successfully',
      data,
    };
  }

  @Get('production/cycle-times')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get cycle time analysis' })
  async getCycleTimeAnalysis(@Query(ValidationPipe) query: CycleTimeAnalysisQueryDto) {
    const data = await this.productionStats.getCycleTimeAnalysis(query);
    return {
      success: true,
      message: 'Cycle time analysis retrieved successfully',
      data,
    };
  }

  @Get('production/bottlenecks')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get bottleneck analysis' })
  async getBottleneckAnalysis(@Query(ValidationPipe) query: BottleneckAnalysisQueryDto) {
    const data = await this.productionStats.getBottlenecks(query);
    return {
      success: true,
      message: 'Bottleneck analysis retrieved successfully',
      data,
    };
  }

  @Get('production/sector-performance')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get sector performance metrics' })
  async getSectorPerformance(@Query(ValidationPipe) query: SectorPerformanceQueryDto) {
    const data = await this.productionStats.getSectorPerformance(query);
    return {
      success: true,
      message: 'Sector performance retrieved successfully',
      data,
    };
  }

  @Get('production/paint-usage')
  @Roles(SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get paint usage statistics' })
  async getPaintUsage(@Query(ValidationPipe) query: PaintUsageQueryDto) {
    const data = await this.productionStats.getPaintUsage(query);
    return {
      success: true,
      message: 'Paint usage statistics retrieved successfully',
      data,
    };
  }

  // =====================
  // ORDER STATISTICS
  // =====================

  @Get('orders/overview')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get orders overview' })
  async getOrdersOverview(@Query(ValidationPipe) query: OrdersOverviewQueryDto) {
    const data = await this.ordersStats.getOrdersOverview(query);
    return {
      success: true,
      message: 'Orders overview retrieved successfully',
      data,
    };
  }

  @Get('orders/fulfillment-rates')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get order fulfillment rates' })
  async getFulfillmentRates(@Query(ValidationPipe) query: FulfillmentRatesQueryDto) {
    const data = await this.ordersStats.getFulfillmentRates(query);
    return {
      success: true,
      message: 'Fulfillment rates retrieved successfully',
      data,
    };
  }

  @Get('orders/supplier-comparison')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get supplier comparison' })
  async getSupplierComparison(@Query(ValidationPipe) query: SupplierComparisonQueryDto) {
    const data = await this.ordersStats.getSupplierComparison(query);
    return {
      success: true,
      message: 'Supplier comparison retrieved successfully',
      data,
    };
  }

  @Get('orders/spending-analysis')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get spending analysis' })
  async getSpendingAnalysis(@Query(ValidationPipe) query: SpendingAnalysisQueryDto) {
    const data = await this.ordersStats.getSpendingAnalysis(query);
    return {
      success: true,
      message: 'Spending analysis retrieved successfully',
      data,
    };
  }

  @Get('orders/delivery-performance')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get delivery performance' })
  async getDeliveryPerformance(@Query(ValidationPipe) query: DeliveryPerformanceQueryDto) {
    const data = await this.ordersStats.getDeliveryPerformance(query);
    return {
      success: true,
      message: 'Delivery performance retrieved successfully',
      data,
    };
  }

  // =====================
  // HR STATISTICS
  // =====================

  @Get('hr/employee-overview')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get employee overview' })
  async getEmployeeOverview(@Query(ValidationPipe) query: EmployeeOverviewQueryDto) {
    const data = await this.hrStats.getEmployeeOverview(query);
    return {
      success: true,
      message: 'Employee overview retrieved successfully',
      data,
    };
  }

  @Get('hr/performance-metrics')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get performance metrics' })
  async getPerformanceMetrics(@Query(ValidationPipe) query: PerformanceMetricsQueryDto) {
    const data = await this.hrStats.getPerformanceMetrics(query);
    return {
      success: true,
      message: 'Performance metrics retrieved successfully',
      data,
    };
  }

  @Get('hr/bonus-distribution')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get bonus distribution' })
  async getBonusDistribution(@Query(ValidationPipe) query: BonusDistributionQueryDto) {
    const data = await this.hrStats.getBonusDistribution(query);
    return {
      success: true,
      message: 'Bonus distribution retrieved successfully',
      data,
    };
  }

  @Get('hr/attendance-trends')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LEADER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get attendance trends' })
  async getAttendanceTrends(@Query(ValidationPipe) query: AttendanceTrendsQueryDto) {
    const data = await this.hrStats.getAttendanceTrends(query);
    return {
      success: true,
      message: 'Attendance trends retrieved successfully',
      data,
    };
  }

  @Get('hr/warning-analytics')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get warning analytics' })
  async getWarningAnalytics(@Query(ValidationPipe) query: WarningAnalyticsQueryDto) {
    const data = await this.hrStats.getWarningAnalytics(query);
    return {
      success: true,
      message: 'Warning analytics retrieved successfully',
      data,
    };
  }

  // =====================
  // FINANCIAL STATISTICS
  // =====================

  @Get('financial/revenue-trends')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get revenue trends' })
  async getRevenueTrends(@Query(ValidationPipe) query: RevenueTrendsQueryDto) {
    const data = await this.financialStats.getRevenueTrends(query);
    return {
      success: true,
      message: 'Revenue trends retrieved successfully',
      data,
    };
  }

  @Get('financial/cost-analysis')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get cost analysis' })
  async getCostAnalysis(@Query(ValidationPipe) query: CostAnalysisQueryDto) {
    const data = await this.financialStats.getCostAnalysis(query);
    return {
      success: true,
      message: 'Cost analysis retrieved successfully',
      data,
    };
  }

  @Get('financial/profitability')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get profitability metrics' })
  async getProfitability(@Query(ValidationPipe) query: ProfitabilityQueryDto) {
    const data = await this.financialStats.getProfitability(query);
    return {
      success: true,
      message: 'Profitability metrics retrieved successfully',
      data,
    };
  }

  @Get('financial/budget-tracking')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get budget tracking' })
  async getBudgetTracking(@Query(ValidationPipe) query: BudgetTrackingQueryDto) {
    const data = await this.financialStats.getBudgetTracking(query);
    return {
      success: true,
      message: 'Budget tracking retrieved successfully',
      data,
    };
  }
}
