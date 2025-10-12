// api/src/modules/system/statistics/dto/chart-config.dto.ts

import { IsOptional, IsEnum, IsString, IsArray, IsNumber, IsBoolean, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CHART_TYPE, STATISTICS_GROUP_BY, STATISTICS_METRIC } from '@constants';
import { FilterBuilderDto } from './query-statistics.dto';

/**
 * DTO for chart data series configuration
 */
export class ChartDataSeriesDto {
  @ApiProperty({
    description: 'Series name',
    example: 'Revenue',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Data points for the series',
    type: [Number],
    example: [100, 200, 150, 300],
  })
  @IsArray()
  @IsNumber({}, { each: true })
  data: number[];

  @ApiPropertyOptional({
    description: 'Color for the series',
    example: '#3b82f6',
  })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({
    description: 'Chart type for this series (for mixed charts)',
    enum: CHART_TYPE,
    example: CHART_TYPE.LINE,
  })
  @IsOptional()
  @IsEnum(CHART_TYPE)
  type?: CHART_TYPE;

  @ApiPropertyOptional({
    description: 'Y-axis index (for dual-axis charts)',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  yAxisIndex?: number;

  @ApiPropertyOptional({
    description: 'Stack identifier for stacked charts',
    example: 'stack1',
  })
  @IsOptional()
  @IsString()
  stack?: string;
}

/**
 * DTO for X-axis configuration
 */
export class XAxisConfigDto {
  @ApiPropertyOptional({
    description: 'X-axis title',
    example: 'Month',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Axis type',
    enum: ['category', 'value', 'time'],
    example: 'category',
  })
  @IsOptional()
  @IsEnum(['category', 'value', 'time'])
  type?: 'category' | 'value' | 'time';

  @ApiPropertyOptional({
    description: 'Category labels',
    type: [String],
    example: ['Jan', 'Feb', 'Mar', 'Apr'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];
}

/**
 * DTO for Y-axis configuration
 */
export class YAxisConfigDto {
  @ApiPropertyOptional({
    description: 'Y-axis title',
    example: 'Revenue ($)',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Axis type',
    enum: ['value', 'log'],
    example: 'value',
  })
  @IsOptional()
  @IsEnum(['value', 'log'])
  type?: 'value' | 'log';

  @ApiPropertyOptional({
    description: 'Minimum value',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  min?: number;

  @ApiPropertyOptional({
    description: 'Maximum value',
    example: 1000,
  })
  @IsOptional()
  @IsNumber()
  max?: number;

  @ApiPropertyOptional({
    description: 'Axis position',
    enum: ['left', 'right'],
    example: 'left',
  })
  @IsOptional()
  @IsEnum(['left', 'right'])
  position?: 'left' | 'right';
}

/**
 * DTO for legend configuration
 */
export class LegendConfigDto {
  @ApiProperty({
    description: 'Show legend',
    example: true,
  })
  @IsBoolean()
  show: boolean;

  @ApiPropertyOptional({
    description: 'Legend position',
    enum: ['top', 'bottom', 'left', 'right'],
    example: 'bottom',
  })
  @IsOptional()
  @IsEnum(['top', 'bottom', 'left', 'right'])
  position?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * DTO for tooltip configuration
 */
export class TooltipConfigDto {
  @ApiProperty({
    description: 'Enable tooltip',
    example: true,
  })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({
    description: 'Format string for tooltip values',
    example: '{value} USD',
  })
  @IsOptional()
  @IsString()
  format?: string;
}

/**
 * DTO for data zoom configuration (for scrollable charts)
 */
export class DataZoomConfigDto {
  @ApiProperty({
    description: 'Enable data zoom',
    example: true,
  })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({
    description: 'Start percentage (0-100)',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  start?: number;

  @ApiPropertyOptional({
    description: 'End percentage (0-100)',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  end?: number;
}

/**
 * Main DTO for basic chart configuration
 */
export class ChartConfigDto {
  @ApiProperty({
    description: 'Chart type',
    enum: CHART_TYPE,
    example: CHART_TYPE.BAR,
  })
  @IsEnum(CHART_TYPE)
  type: CHART_TYPE;

  @ApiProperty({
    description: 'Data key to visualize',
    example: 'totalRevenue',
  })
  @IsString()
  dataKey: string;

  @ApiPropertyOptional({
    description: 'Fields to group data by',
    type: [String],
    example: ['category', 'month'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groupBy?: string[];

  @ApiPropertyOptional({
    description: 'Filters to apply to the data',
    type: [FilterBuilderDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterBuilderDto)
  filters?: FilterBuilderDto[];

  @ApiPropertyOptional({
    description: 'Aggregation type',
    enum: ['sum', 'avg', 'count', 'min', 'max', 'median'],
    example: 'sum',
  })
  @IsOptional()
  @IsEnum(['sum', 'avg', 'count', 'min', 'max', 'median'])
  aggregation?: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'median';
}

/**
 * DTO for multi-series chart configuration with advanced options
 */
export class MultiSeriesChartConfigDto {
  @ApiProperty({
    description: 'Primary chart type',
    enum: CHART_TYPE,
    example: CHART_TYPE.LINE,
  })
  @IsEnum(CHART_TYPE)
  chartType: CHART_TYPE;

  @ApiProperty({
    description: 'Data series to display',
    type: [ChartDataSeriesDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChartDataSeriesDto)
  series: ChartDataSeriesDto[];

  @ApiProperty({
    description: 'Labels for X-axis',
    type: [String],
    example: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
  })
  @IsArray()
  @IsString({ each: true })
  labels: string[];

  @ApiPropertyOptional({
    description: 'Color palette for series',
    type: [String],
    example: ['#3b82f6', '#ef4444', '#10b981'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  colors?: string[];

  @ApiPropertyOptional({
    description: 'X-axis configuration',
    type: XAxisConfigDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => XAxisConfigDto)
  xAxis?: XAxisConfigDto;

  @ApiPropertyOptional({
    description: 'Y-axis configurations (supports dual-axis)',
    type: [YAxisConfigDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => YAxisConfigDto)
  yAxis?: YAxisConfigDto[];

  @ApiPropertyOptional({
    description: 'Legend configuration',
    type: LegendConfigDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LegendConfigDto)
  legend?: LegendConfigDto;

  @ApiPropertyOptional({
    description: 'Tooltip configuration',
    type: TooltipConfigDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TooltipConfigDto)
  tooltip?: TooltipConfigDto;

  @ApiPropertyOptional({
    description: 'Data zoom configuration',
    type: DataZoomConfigDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DataZoomConfigDto)
  dataZoom?: DataZoomConfigDto;
}

/**
 * DTO for dashboard chart configuration
 * Used when configuring multiple charts on a dashboard
 */
export class DashboardChartConfigDto {
  @ApiProperty({
    description: 'Unique identifier for the chart',
    example: 'revenue-chart-1',
  })
  @IsString()
  id: string;

  @ApiProperty({
    description: 'Chart title',
    example: 'Monthly Revenue Trend',
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    description: 'Chart description',
    example: 'Revenue trends over the past 12 months',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Chart configuration',
    type: MultiSeriesChartConfigDto,
  })
  @ValidateNested()
  @Type(() => MultiSeriesChartConfigDto)
  config: MultiSeriesChartConfigDto;

  @ApiPropertyOptional({
    description: 'Chart width (grid units)',
    example: 6,
    minimum: 1,
    maximum: 12,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  width?: number;

  @ApiPropertyOptional({
    description: 'Chart height (pixels)',
    example: 400,
  })
  @IsOptional()
  @IsNumber()
  @Min(100)
  height?: number;

  @ApiPropertyOptional({
    description: 'Refresh interval in seconds (0 = no auto-refresh)',
    example: 300,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  refreshInterval?: number;
}

/**
 * DTO for exporting chart configuration
 */
export class ExportChartConfigDto {
  @ApiProperty({
    description: 'Chart configuration to export',
    type: MultiSeriesChartConfigDto,
  })
  @ValidateNested()
  @Type(() => MultiSeriesChartConfigDto)
  chartConfig: MultiSeriesChartConfigDto;

  @ApiProperty({
    description: 'Export format',
    enum: ['png', 'jpg', 'svg', 'pdf'],
    example: 'png',
  })
  @IsEnum(['png', 'jpg', 'svg', 'pdf'])
  format: 'png' | 'jpg' | 'svg' | 'pdf';

  @ApiPropertyOptional({
    description: 'Export width in pixels',
    example: 1200,
  })
  @IsOptional()
  @IsNumber()
  @Min(100)
  width?: number;

  @ApiPropertyOptional({
    description: 'Export height in pixels',
    example: 800,
  })
  @IsOptional()
  @IsNumber()
  @Min(100)
  height?: number;

  @ApiPropertyOptional({
    description: 'Background color for export',
    example: '#ffffff',
  })
  @IsOptional()
  @IsString()
  backgroundColor?: string;
}
