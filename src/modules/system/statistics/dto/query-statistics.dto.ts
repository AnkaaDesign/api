import { IsOptional, IsString, IsEnum, IsDateString, IsArray, IsNumber, Min, IsDate, IsBoolean, ValidateNested, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  STATISTICS_PERIOD,
  STATISTICS_GROUP_BY,
  STATISTICS_METRIC,
  CHART_TYPE,
  ACTIVITY_REASON,
  ACTIVITY_OPERATION,
} from '@constants';

export class BaseStatisticsQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(STATISTICS_PERIOD)
  period?: STATISTICS_PERIOD;

  @IsOptional()
  @IsEnum(STATISTICS_GROUP_BY)
  groupBy?: STATISTICS_GROUP_BY;

  @IsOptional()
  @IsEnum(CHART_TYPE)
  chartType?: CHART_TYPE;
}

// =====================
// INVENTORY QUERY DTOS
// =====================

export class InventoryOverviewQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;
}

export class StockLevelsQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsEnum(['critical', 'low', 'adequate', 'overstocked', 'all'])
  status?: 'critical' | 'low' | 'adequate' | 'overstocked' | 'all';

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  offset?: number;
}

export class ConsumptionTrendsQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reasons?: string[];

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  topN?: number;
}

export class AbcXyzAnalysisQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  lookbackDays?: number;
}

export class ReorderPointsQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsEnum(['all', 'needs-reorder', 'adequate'])
  filter?: 'all' | 'needs-reorder' | 'adequate';
}

export class SupplierPerformanceQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  minOrders?: number;
}

// =====================
// PRODUCTION QUERY DTOS
// =====================

export class ProductionTasksOverviewQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  sectorId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  statuses?: string[];
}

export class CompletionRatesQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  sectorId?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class CycleTimeAnalysisQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  sectorId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  percentile?: number;
}

export class BottleneckAnalysisQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  threshold?: number;
}

export class SectorPerformanceQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  sectorId?: string;
}

export class PaintUsageQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  paintTypeId?: string;

  @IsOptional()
  @IsString()
  paintBrandId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  topN?: number;
}

// =====================
// ORDER QUERY DTOS
// =====================

export class OrdersOverviewQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  statuses?: string[];
}

export class FulfillmentRatesQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;
}

export class SupplierComparisonQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supplierIds?: string[];

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  minOrders?: number;
}

export class SpendingAnalysisQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  topN?: number;
}

export class DeliveryPerformanceQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  minDeliveries?: number;
}

// =====================
// HR QUERY DTOS
// =====================

export class EmployeeOverviewQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  sectorId?: string;

  @IsOptional()
  @IsString()
  positionId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  statuses?: string[];
}

export class PerformanceMetricsQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  sectorId?: string;

  @IsOptional()
  @IsString()
  positionId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  topN?: number;
}

export class BonusDistributionQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  year?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  month?: number;

  @IsOptional()
  @IsString()
  sectorId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  topN?: number;
}

export class AttendanceTrendsQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  sectorId?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class WarningAnalyticsQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  sectorId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  severities?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  topN?: number;
}

// =====================
// FINANCIAL QUERY DTOS
// =====================

export class RevenueTrendsQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  sectorId?: string;

  @IsOptional()
  @IsEnum(['true', 'false'])
  includeProjections?: 'true' | 'false';
}

export class CostAnalysisQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsEnum(['inventory', 'labor', 'materials', 'overhead', 'all'])
  costType?: 'inventory' | 'labor' | 'materials' | 'overhead' | 'all';
}

export class ProfitabilityQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  sectorId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  topN?: number;
}

export class BudgetTrackingQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsEnum(['under', 'on-track', 'over', 'all'])
  status?: 'under' | 'on-track' | 'over' | 'all';
}

// =====================
// ENHANCED QUERY DTOS
// =====================

/**
 * DTO for date range filtering in statistics queries
 */
export class DateRangeDto {
  @ApiProperty({
    description: 'Start date for the statistics query',
    example: '2024-01-01',
    type: Date,
  })
  @IsDate()
  @Type(() => Date)
  from: Date;

  @ApiProperty({
    description: 'End date for the statistics query',
    example: '2024-12-31',
    type: Date,
  })
  @IsDate()
  @Type(() => Date)
  to: Date;
}

/**
 * DTO for grouping options in statistics queries
 */
export class GroupByDto {
  @ApiProperty({
    description: 'Field to group by',
    example: 'category',
  })
  @IsString()
  field: string;

  @ApiProperty({
    description: 'Aggregation function to apply',
    enum: ['sum', 'avg', 'count', 'min', 'max'],
    example: 'sum',
  })
  @IsEnum(['sum', 'avg', 'count', 'min', 'max'])
  aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max';
}

/**
 * DTO for advanced filter builder
 */
export class FilterBuilderDto {
  @ApiProperty({
    description: 'Field to filter on',
    example: 'totalPrice',
  })
  @IsString()
  field: string;

  @ApiProperty({
    description: 'Comparison operator',
    enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'startsWith', 'endsWith'],
    example: 'gte',
  })
  @IsEnum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'startsWith', 'endsWith'])
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'contains' | 'startsWith' | 'endsWith';

  @ApiProperty({
    description: 'Value to compare against',
    example: 1000,
  })
  value: any;

  @ApiPropertyOptional({
    description: 'Logical operator to combine with other filters',
    enum: ['AND', 'OR'],
    example: 'AND',
  })
  @IsOptional()
  @IsEnum(['AND', 'OR'])
  logicalOperator?: 'AND' | 'OR';
}

/**
 * Main DTO for querying statistics with filters and options
 */
export class QueryStatisticsDto {
  @ApiProperty({
    description: 'Date range for the statistics query',
    type: DateRangeDto,
  })
  @ValidateNested()
  @Type(() => DateRangeDto)
  dateRange: DateRangeDto;

  @ApiProperty({
    description: 'Time period for aggregation',
    enum: STATISTICS_PERIOD,
    example: STATISTICS_PERIOD.MONTHLY,
  })
  @IsEnum(STATISTICS_PERIOD)
  period: STATISTICS_PERIOD;

  @ApiPropertyOptional({
    description: 'Field to group results by',
    enum: STATISTICS_GROUP_BY,
    example: STATISTICS_GROUP_BY.CATEGORY,
  })
  @IsOptional()
  @IsEnum(STATISTICS_GROUP_BY)
  groupBy?: STATISTICS_GROUP_BY;

  @ApiPropertyOptional({
    description: 'Metric to calculate',
    enum: STATISTICS_METRIC,
    example: STATISTICS_METRIC.TOTAL_PRICE,
  })
  @IsOptional()
  @IsEnum(STATISTICS_METRIC)
  metric?: STATISTICS_METRIC;

  @ApiPropertyOptional({
    description: 'Type of chart to generate',
    enum: CHART_TYPE,
    example: CHART_TYPE.BAR,
  })
  @IsOptional()
  @IsEnum(CHART_TYPE)
  chartType?: CHART_TYPE;

  // Entity filters
  @ApiPropertyOptional({
    description: 'Filter by category IDs',
    type: [String],
    example: ['cat-1', 'cat-2'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({
    description: 'Filter by brand IDs',
    type: [String],
    example: ['brand-1', 'brand-2'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  brandIds?: string[];

  @ApiPropertyOptional({
    description: 'Filter by supplier IDs',
    type: [String],
    example: ['supplier-1', 'supplier-2'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supplierIds?: string[];

  @ApiPropertyOptional({
    description: 'Filter by user IDs',
    type: [String],
    example: ['user-1', 'user-2'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];

  @ApiPropertyOptional({
    description: 'Filter by sector IDs',
    type: [String],
    example: ['sector-1', 'sector-2'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sectorIds?: string[];

  @ApiPropertyOptional({
    description: 'Filter by item IDs',
    type: [String],
    example: ['item-1', 'item-2'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemIds?: string[];

  // Activity filters
  @ApiPropertyOptional({
    description: 'Filter by activity reasons',
    enum: ACTIVITY_REASON,
    isArray: true,
    example: [ACTIVITY_REASON.PRODUCTION_USAGE],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ACTIVITY_REASON, { each: true })
  activityReasons?: ACTIVITY_REASON[];

  @ApiPropertyOptional({
    description: 'Filter by activity operations',
    enum: ACTIVITY_OPERATION,
    isArray: true,
    example: [ACTIVITY_OPERATION.OUTBOUND],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ACTIVITY_OPERATION, { each: true })
  activityOperations?: ACTIVITY_OPERATION[];

  // Value filters
  @ApiPropertyOptional({
    description: 'Minimum value threshold',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minValue?: number;

  @ApiPropertyOptional({
    description: 'Maximum value threshold',
    example: 10000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxValue?: number;

  // Pagination
  @ApiPropertyOptional({
    description: 'Maximum number of results to return',
    example: 50,
    default: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Number of results to skip',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  offset?: number;

  // Aggregate options
  @ApiPropertyOptional({
    description: 'Include empty/zero values in results',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includeEmpty?: boolean;

  @ApiPropertyOptional({
    description: 'Include totals in summary',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeTotals?: boolean;

  @ApiPropertyOptional({
    description: 'Include percentages in results',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includePercentages?: boolean;

  // Advanced filters
  @ApiPropertyOptional({
    description: 'Advanced filter conditions',
    type: [FilterBuilderDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterBuilderDto)
  advancedFilters?: FilterBuilderDto[];
}

/**
 * DTO for querying consumption statistics
 */
export class QueryConsumptionStatisticsDto extends QueryStatisticsDto {
  @ApiPropertyOptional({
    description: 'Include hourly breakdown',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includeHourlyBreakdown?: boolean;

  @ApiPropertyOptional({
    description: 'Include daily breakdown',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includeDailyBreakdown?: boolean;

  @ApiPropertyOptional({
    description: 'Include monthly breakdown',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includeMonthlyBreakdown?: boolean;

  @ApiPropertyOptional({
    description: 'Include top consumers',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includeTopConsumers?: boolean;

  @ApiPropertyOptional({
    description: 'Number of top consumers to include',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  topConsumersLimit?: number;
}

/**
 * DTO for querying activity analytics
 */
export class QueryActivityAnalyticsDto extends QueryStatisticsDto {
  @ApiPropertyOptional({
    description: 'Include user ranking',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includeUserRanking?: boolean;

  @ApiPropertyOptional({
    description: 'Include sector comparison',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includeSectorComparison?: boolean;

  @ApiPropertyOptional({
    description: 'Include peak times analysis',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includePeakTimes?: boolean;

  @ApiPropertyOptional({
    description: 'Include trend analysis',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includeTrends?: boolean;
}

/**
 * DTO for querying stock metrics
 */
export class QueryStockMetricsDto extends QueryStatisticsDto {
  @ApiPropertyOptional({
    description: 'Include stock health analysis',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includeStockHealth?: boolean;

  @ApiPropertyOptional({
    description: 'Include risk analysis',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includeRiskAnalysis?: boolean;

  @ApiPropertyOptional({
    description: 'Include top items',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includeTopItems?: boolean;

  @ApiPropertyOptional({
    description: 'Number of top items to include',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  topItemsLimit?: number;
}

/**
 * DTO for comparative statistics queries
 */
export class QueryComparativeStatisticsDto {
  @ApiProperty({
    description: 'Current period date range',
    type: DateRangeDto,
  })
  @ValidateNested()
  @Type(() => DateRangeDto)
  currentPeriod: DateRangeDto;

  @ApiProperty({
    description: 'Previous period date range for comparison',
    type: DateRangeDto,
  })
  @ValidateNested()
  @Type(() => DateRangeDto)
  previousPeriod: DateRangeDto;

  @ApiProperty({
    description: 'Base statistics query parameters',
    type: QueryStatisticsDto,
  })
  @ValidateNested()
  @Type(() => QueryStatisticsDto)
  query: QueryStatisticsDto;
}
