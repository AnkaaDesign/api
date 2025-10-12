// api/src/modules/system/statistics/dto/statistics-response.dto.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { STATISTICS_PERIOD, STATISTICS_GROUP_BY, STATISTICS_METRIC, CHART_TYPE } from '@constants';

/**
 * Base DTO for statistics responses
 * Provides common fields for all statistics endpoints
 */
export class BaseStatisticsResponseDto {
  @ApiProperty({
    description: 'Indicates if the request was successful',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Human-readable message about the operation',
    example: 'Statistics retrieved successfully',
  })
  message: string;

  @ApiPropertyOptional({
    description: 'Error message if operation failed',
    example: null,
  })
  error?: string;

  @ApiProperty({
    description: 'Timestamp when statistics were generated',
    type: Date,
    example: '2024-01-15T10:30:00Z',
  })
  @Type(() => Date)
  generatedAt: Date;
}

/**
 * DTO for data point in consumption charts
 */
export class ConsumptionDataPointDto {
  @ApiProperty({ description: 'Unique identifier', example: 'dp-1' })
  id: string;

  @ApiProperty({ description: 'Label for the data point', example: 'Category A' })
  label: string;

  @ApiProperty({ description: 'Numeric value', example: 1500.50 })
  value: number;

  @ApiPropertyOptional({ description: 'Quantity', example: 100 })
  quantity?: number;

  @ApiPropertyOptional({ description: 'Total price', example: 1500.50 })
  totalPrice?: number;

  @ApiPropertyOptional({ description: 'Unit price', example: 15.005 })
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'Percentage of total', example: 25.5 })
  percentage?: number;

  @ApiPropertyOptional({ description: 'Color for visualization', example: '#3b82f6' })
  color?: string;

  @ApiPropertyOptional({ description: 'Additional metadata', example: { category: 'Electronics' } })
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Associated date', type: Date })
  @Type(() => Date)
  date?: Date;

  @ApiPropertyOptional({ description: 'Time period label', example: '2024-Q1' })
  period?: string;
}

/**
 * DTO for chart summary statistics
 */
export class ChartSummaryDto {
  @ApiProperty({ description: 'Total value across all data points', example: 50000 })
  totalValue: number;

  @ApiProperty({ description: 'Total quantity across all data points', example: 5000 })
  totalQuantity: number;

  @ApiProperty({ description: 'Average value', example: 10.5 })
  averageValue: number;

  @ApiProperty({ description: 'Number of data points', example: 25 })
  dataPointCount: number;

  @ApiPropertyOptional({ description: 'Top performing data point', type: ConsumptionDataPointDto })
  topPerformer?: ConsumptionDataPointDto;

  @ApiPropertyOptional({ description: 'Lowest performing data point', type: ConsumptionDataPointDto })
  lowestPerformer?: ConsumptionDataPointDto;
}

/**
 * DTO for trend information
 */
export class TrendDto {
  @ApiProperty({ description: 'Whether trend is growing', example: true })
  isGrowing: boolean;

  @ApiProperty({ description: 'Growth rate percentage', example: 12.5 })
  growthRate: number;

  @ApiProperty({ description: 'Trend direction', enum: ['up', 'down', 'stable'], example: 'up' })
  direction: 'up' | 'down' | 'stable';
}

/**
 * DTO for consumption chart data response
 */
export class ConsumptionChartDataDto {
  @ApiProperty({ enum: CHART_TYPE, example: CHART_TYPE.BAR })
  chartType: CHART_TYPE;

  @ApiProperty({ enum: STATISTICS_GROUP_BY, example: STATISTICS_GROUP_BY.CATEGORY })
  groupBy: STATISTICS_GROUP_BY;

  @ApiProperty({ enum: STATISTICS_METRIC, example: STATISTICS_METRIC.TOTAL_PRICE })
  metric: STATISTICS_METRIC;

  @ApiProperty({ enum: STATISTICS_PERIOD, example: STATISTICS_PERIOD.MONTHLY })
  period: STATISTICS_PERIOD;

  @ApiProperty({ type: [ConsumptionDataPointDto], description: 'Array of data points' })
  dataPoints: ConsumptionDataPointDto[];

  @ApiProperty({ type: ChartSummaryDto, description: 'Summary statistics' })
  summary: ChartSummaryDto;

  @ApiProperty({ type: [String], description: 'Labels for chart axes', example: ['Jan', 'Feb', 'Mar'] })
  labels: string[];

  @ApiPropertyOptional({ type: [String], description: 'Colors for chart elements', example: ['#3b82f6', '#ef4444'] })
  colors?: string[];

  @ApiPropertyOptional({ type: TrendDto, description: 'Trend analysis' })
  trends?: TrendDto;
}

/**
 * DTO for stock health status
 */
export class StockHealthDto {
  @ApiProperty({ description: 'Number of healthy items', example: 150 })
  healthy: number;

  @ApiProperty({ description: 'Number of low stock items', example: 25 })
  lowStock: number;

  @ApiProperty({ description: 'Number of critical stock items', example: 5 })
  criticalStock: number;

  @ApiProperty({ description: 'Number of overstocked items', example: 10 })
  overstock: number;

  @ApiProperty({ description: 'Number of out of stock items', example: 3 })
  outOfStock: number;
}

/**
 * DTO for activity type statistics
 */
export class ActivityTypeStatDto {
  @ApiProperty({ description: 'Activity type/reason', example: 'PRODUCTION_USAGE' })
  type: string;

  @ApiProperty({ description: 'Count of activities', example: 150 })
  count: number;

  @ApiProperty({ description: 'Percentage of total', example: 35.5 })
  percentage: number;

  @ApiProperty({ description: 'Total quantity affected', example: 1500 })
  totalQuantity: number;

  @ApiPropertyOptional({ description: 'Total value', example: 25000.50 })
  totalValue?: number;
}

/**
 * DTO for hourly distribution
 */
export class HourlyDistributionDto {
  @ApiProperty({ description: 'Hour of day (0-23)', example: 14, minimum: 0, maximum: 23 })
  hour: number;

  @ApiProperty({ description: 'Activity count', example: 45 })
  count: number;

  @ApiProperty({ description: 'Average quantity', example: 12.5 })
  avgQuantity: number;

  @ApiPropertyOptional({ description: 'Average value', example: 250.75 })
  avgValue?: number;
}

/**
 * DTO for daily distribution
 */
export class DailyDistributionDto {
  @ApiProperty({ description: 'Date string', example: '2024-01-15' })
  date: string;

  @ApiProperty({ description: 'Activity count', example: 120 })
  count: number;

  @ApiProperty({ description: 'Total quantity', example: 1200 })
  totalQuantity: number;

  @ApiPropertyOptional({ description: 'Total value', example: 15000.50 })
  totalValue?: number;

  @ApiProperty({ description: 'Incoming activities', example: 80 })
  incoming: number;

  @ApiProperty({ description: 'Outgoing activities', example: 35 })
  outgoing: number;

  @ApiProperty({ description: 'Adjustment activities', example: 5 })
  adjustments: number;
}

/**
 * DTO for user ranking
 */
export class UserRankingDto {
  @ApiProperty({ description: 'User ID', example: 'user-123' })
  userId: string;

  @ApiProperty({ description: 'User name', example: 'John Doe' })
  userName: string;

  @ApiProperty({ description: 'Activity count', example: 250 })
  activityCount: number;

  @ApiProperty({ description: 'Total quantity handled', example: 2500 })
  totalQuantity: number;

  @ApiPropertyOptional({ description: 'Total value handled', example: 50000.75 })
  totalValue?: number;

  @ApiProperty({ description: 'Efficiency score', example: 92.5 })
  efficiency: number;

  @ApiProperty({ description: 'Sector name', example: 'Production' })
  sectorName: string;

  @ApiProperty({ description: 'Average daily activities', example: 12.5 })
  avgDailyActivities: number;
}

/**
 * DTO for complete statistics response
 */
export class StatisticsResponseDto extends BaseStatisticsResponseDto {
  @ApiPropertyOptional({ description: 'Statistics data', type: Object })
  data?: any; // Can be typed more specifically based on the endpoint
}

/**
 * DTO for consumption chart response
 */
export class ConsumptionChartResponseDto extends BaseStatisticsResponseDto {
  @ApiPropertyOptional({ type: ConsumptionChartDataDto })
  data?: ConsumptionChartDataDto;
}

/**
 * DTO for paginated statistics response
 */
export class PaginatedStatisticsResponseDto<T> extends BaseStatisticsResponseDto {
  @ApiPropertyOptional({ description: 'Array of data items', type: [Object] })
  data?: T[];

  @ApiPropertyOptional({
    description: 'Pagination metadata',
    example: {
      totalRecords: 150,
      page: 1,
      take: 50,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
    },
  })
  meta?: {
    totalRecords: number;
    page: number;
    take: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * DTO for comparative statistics response
 */
export class ComparativeStatisticsResponseDto<T> extends BaseStatisticsResponseDto {
  @ApiPropertyOptional({ description: 'Current period data' })
  current?: T;

  @ApiPropertyOptional({ description: 'Previous period data' })
  previous?: T;

  @ApiPropertyOptional({
    description: 'Comparison metrics',
    example: {
      absoluteChange: 150,
      percentageChange: 12.5,
      trend: 'up',
      isImprovement: true,
    },
  })
  comparison?: {
    absoluteChange: number;
    percentageChange: number;
    trend: 'up' | 'down' | 'stable';
    isImprovement: boolean;
  };
}

// Response type aliases for statistics endpoints
export type InventoryOverviewResponse = StatisticsResponseDto;
export type StockLevelsResponse = StatisticsResponseDto;
export type ConsumptionTrendsResponse = StatisticsResponseDto;
export type AbcXyzAnalysisResponse = StatisticsResponseDto;
export type ReorderPointsResponse = StatisticsResponseDto;
export type SupplierPerformanceResponse = StatisticsResponseDto;
export type ProductionTasksOverviewResponse = StatisticsResponseDto;
export type CompletionRatesResponse = StatisticsResponseDto;
export type CycleTimeAnalysisResponse = StatisticsResponseDto;
export type BottleneckAnalysisResponse = StatisticsResponseDto;
export type SectorPerformanceResponse = StatisticsResponseDto;
export type PaintUsageResponse = StatisticsResponseDto;
export type OrdersOverviewResponse = StatisticsResponseDto;
export type FulfillmentRatesResponse = StatisticsResponseDto;
export type SupplierComparisonResponse = StatisticsResponseDto;
export type SpendingAnalysisResponse = StatisticsResponseDto;
export type DeliveryPerformanceResponse = StatisticsResponseDto;
export type EmployeeOverviewResponse = StatisticsResponseDto;
export type PerformanceMetricsResponse = StatisticsResponseDto;
export type BonusDistributionResponse = StatisticsResponseDto;
export type AttendanceTrendsResponse = StatisticsResponseDto;
export type WarningAnalyticsResponse = StatisticsResponseDto;
export type RevenueTrendsResponse = StatisticsResponseDto;
export type CostAnalysisResponse = StatisticsResponseDto;
export type ProfitabilityResponse = StatisticsResponseDto;
export type BudgetTrackingResponse = StatisticsResponseDto;
