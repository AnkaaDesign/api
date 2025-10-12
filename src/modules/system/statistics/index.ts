// Statistics Module Exports

// Module
export { StatisticsModule } from './statistics.module';

// Controller
export { StatisticsController } from './statistics.controller';

// Services
export { InventoryStatisticsService } from './services/inventory-statistics.service';
export { ProductionStatisticsService } from './services/production-statistics.service';
export { OrdersStatisticsService } from './services/orders-statistics.service';
export { HrStatisticsService } from './services/hr-statistics.service';
export { FinancialStatisticsService } from './services/financial-statistics.service';

// DTOs - Query
export {
  BaseStatisticsQueryDto,
  // Inventory
  InventoryOverviewQueryDto,
  StockLevelsQueryDto,
  ConsumptionTrendsQueryDto,
  AbcXyzAnalysisQueryDto,
  ReorderPointsQueryDto,
  SupplierPerformanceQueryDto,
  // Production
  ProductionTasksOverviewQueryDto,
  CompletionRatesQueryDto,
  CycleTimeAnalysisQueryDto,
  BottleneckAnalysisQueryDto,
  SectorPerformanceQueryDto,
  PaintUsageQueryDto,
  // Orders
  OrdersOverviewQueryDto,
  FulfillmentRatesQueryDto,
  SupplierComparisonQueryDto,
  SpendingAnalysisQueryDto,
  DeliveryPerformanceQueryDto,
  // HR
  EmployeeOverviewQueryDto,
  PerformanceMetricsQueryDto,
  BonusDistributionQueryDto,
  AttendanceTrendsQueryDto,
  WarningAnalyticsQueryDto,
  // Financial
  RevenueTrendsQueryDto,
  CostAnalysisQueryDto,
  ProfitabilityQueryDto,
  BudgetTrackingQueryDto,
} from './dto/query-statistics.dto';

// DTOs - Response
export {
  // Inventory
  InventoryOverviewResponse,
  StockLevelsResponse,
  ConsumptionTrendsResponse,
  AbcXyzAnalysisResponse,
  ReorderPointsResponse,
  SupplierPerformanceResponse,
  // Production
  ProductionTasksOverviewResponse,
  CompletionRatesResponse,
  CycleTimeAnalysisResponse,
  BottleneckAnalysisResponse,
  SectorPerformanceResponse,
  PaintUsageResponse,
  // Orders
  OrdersOverviewResponse,
  FulfillmentRatesResponse,
  SupplierComparisonResponse,
  SpendingAnalysisResponse,
  DeliveryPerformanceResponse,
  // HR
  EmployeeOverviewResponse,
  PerformanceMetricsResponse,
  BonusDistributionResponse,
  AttendanceTrendsResponse,
  WarningAnalyticsResponse,
  // Financial
  RevenueTrendsResponse,
  CostAnalysisResponse,
  ProfitabilityResponse,
  BudgetTrackingResponse,
} from './dto/statistics-response.dto';

// Interfaces
export {
  StatisticsPeriod,
  GroupByType,
  ChartType,
  BaseStatisticsFilters,
  // Inventory
  InventoryOverview,
  StockLevelData,
  ConsumptionTrend,
  AbcXyzAnalysis,
  ReorderPointAnalysis,
  SupplierPerformance,
  // Production
  ProductionTasksOverview,
  CompletionRates,
  CycleTimeAnalysis,
  BottleneckAnalysis,
  SectorPerformance,
  PaintUsageStatistics,
  // Orders
  OrdersOverview,
  FulfillmentRates,
  SupplierComparison,
  SpendingAnalysis,
  DeliveryPerformance,
  // HR
  EmployeeOverview,
  PerformanceMetrics,
  BonusDistribution,
  AttendanceTrends,
  WarningAnalytics,
  // Financial
  RevenueTrends,
  CostAnalysis,
  ProfitabilityMetrics,
  BudgetTracking,
  // Generic
  StatisticsResponse,
  DataPoint,
  TrendPoint,
  ChartData,
} from './interfaces/statistics.interface';
