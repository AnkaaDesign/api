import {
  IsString,
  IsEnum,
  IsOptional,
  IsDateString,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsArray,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
} from '../../../../constants';

/**
 * Time range options for analytics
 */
export enum AnalyticsTimeRange {
  TODAY = 'today',
  YESTERDAY = 'yesterday',
  LAST_7_DAYS = 'last_7_days',
  LAST_30_DAYS = 'last_30_days',
  LAST_90_DAYS = 'last_90_days',
  THIS_MONTH = 'this_month',
  LAST_MONTH = 'last_month',
  THIS_YEAR = 'this_year',
  CUSTOM = 'custom',
}

/**
 * Analytics grouping options
 */
export enum AnalyticsGroupBy {
  HOUR = 'hour',
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  TYPE = 'type',
  CHANNEL = 'channel',
  IMPORTANCE = 'importance',
  USER = 'user',
}

/**
 * Analytics metric types
 */
export enum AnalyticsMetric {
  TOTAL = 'total',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  READ = 'read',
  UNREAD = 'unread',
  SEEN = 'seen',
  UNSEEN = 'unseen',
  DELIVERY_RATE = 'delivery_rate',
  READ_RATE = 'read_rate',
  ENGAGEMENT_RATE = 'engagement_rate',
  AVERAGE_READ_TIME = 'average_read_time',
}

/**
 * Base DTO for analytics queries
 */
export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Start date for analytics (ISO format)',
    example: '2026-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'End date for analytics (ISO format)',
    example: '2026-01-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Predefined time range (overrides dateFrom/dateTo if provided)',
    enum: AnalyticsTimeRange,
  })
  @IsOptional()
  @IsEnum(AnalyticsTimeRange)
  timeRange?: AnalyticsTimeRange;

  @ApiPropertyOptional({
    description: 'Filter by notification type',
    enum: NOTIFICATION_TYPE,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_TYPE)
  type?: NOTIFICATION_TYPE;

  @ApiPropertyOptional({
    description: 'Filter by channel',
    enum: NOTIFICATION_CHANNEL,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_CHANNEL)
  channel?: NOTIFICATION_CHANNEL;

  @ApiPropertyOptional({
    description: 'Filter by importance level',
    enum: NOTIFICATION_IMPORTANCE,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_IMPORTANCE)
  importance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({
    description: 'Filter by user ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID('4')
  userId?: string;
}

/**
 * DTO for notification performance analytics
 */
export class NotificationPerformanceQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Group results by',
    enum: AnalyticsGroupBy,
    example: AnalyticsGroupBy.DAY,
  })
  @IsOptional()
  @IsEnum(AnalyticsGroupBy)
  groupBy?: AnalyticsGroupBy;

  @ApiPropertyOptional({
    description: 'Metrics to include',
    enum: AnalyticsMetric,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(AnalyticsMetric, { each: true })
  metrics?: AnalyticsMetric[];

  @ApiPropertyOptional({
    description: 'Include comparison with previous period',
    default: false,
  })
  @IsOptional()
  includeComparison?: boolean;
}

/**
 * DTO for user engagement analytics
 */
export class UserEngagementQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Minimum read count for filtering',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minReadCount?: number;

  @ApiPropertyOptional({
    description: 'Maximum read count for filtering',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxReadCount?: number;

  @ApiPropertyOptional({
    description: 'Sort by field',
    enum: ['totalNotifications', 'readCount', 'readRate', 'avgReadTime'],
    default: 'totalNotifications',
  })
  @IsOptional()
  @IsIn(['totalNotifications', 'readCount', 'readRate', 'avgReadTime'])
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({
    description: 'Limit number of results',
    default: 100,
    minimum: 1,
    maximum: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

/**
 * DTO for delivery analytics
 */
export class DeliveryAnalyticsQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Include retry statistics',
    default: false,
  })
  @IsOptional()
  includeRetryStats?: boolean;

  @ApiPropertyOptional({
    description: 'Include error breakdown',
    default: false,
  })
  @IsOptional()
  includeErrorBreakdown?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by delivery status',
    enum: ['PENDING', 'DELIVERED', 'FAILED', 'RETRYING'],
  })
  @IsOptional()
  @IsIn(['PENDING', 'DELIVERED', 'FAILED', 'RETRYING'])
  deliveryStatus?: string;

  @ApiPropertyOptional({
    description: 'Group by channel for comparison',
    default: false,
  })
  @IsOptional()
  groupByChannel?: boolean;
}

/**
 * DTO for channel performance analytics
 */
export class ChannelPerformanceQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Channels to compare',
    enum: NOTIFICATION_CHANNEL,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(NOTIFICATION_CHANNEL, { each: true })
  channels?: NOTIFICATION_CHANNEL[];

  @ApiPropertyOptional({
    description: 'Include cost metrics (if available)',
    default: false,
  })
  @IsOptional()
  includeCostMetrics?: boolean;

  @ApiPropertyOptional({
    description: 'Include latency metrics',
    default: true,
  })
  @IsOptional()
  includeLatencyMetrics?: boolean;
}

/**
 * DTO for trend analysis
 */
export class TrendAnalysisQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Trend interval',
    enum: ['hourly', 'daily', 'weekly', 'monthly'],
    default: 'daily',
  })
  @IsOptional()
  @IsIn(['hourly', 'daily', 'weekly', 'monthly'])
  interval?: 'hourly' | 'daily' | 'weekly' | 'monthly';

  @ApiPropertyOptional({
    description: 'Include trend predictions',
    default: false,
  })
  @IsOptional()
  includePredictions?: boolean;

  @ApiPropertyOptional({
    description: 'Include anomaly detection',
    default: false,
  })
  @IsOptional()
  includeAnomalies?: boolean;
}

/**
 * DTO for top notifications query
 */
export class TopNotificationsQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Rank by metric',
    enum: ['views', 'reads', 'engagement', 'delivery_rate'],
    default: 'reads',
  })
  @IsOptional()
  @IsIn(['views', 'reads', 'engagement', 'delivery_rate'])
  rankBy?: 'views' | 'reads' | 'engagement' | 'delivery_rate';

  @ApiPropertyOptional({
    description: 'Number of top results to return',
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  topN?: number;

  @ApiPropertyOptional({
    description: 'Include notification details',
    default: true,
  })
  @IsOptional()
  includeDetails?: boolean;
}

/**
 * DTO for comparative analytics
 */
export class ComparativeAnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'First period start date (ISO format)',
    example: '2026-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  period1From?: string;

  @ApiPropertyOptional({
    description: 'First period end date (ISO format)',
    example: '2026-01-15T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  period1To?: string;

  @ApiPropertyOptional({
    description: 'Second period start date (ISO format)',
    example: '2026-01-16T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  period2From?: string;

  @ApiPropertyOptional({
    description: 'Second period end date (ISO format)',
    example: '2026-01-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  period2To?: string;

  @ApiPropertyOptional({
    description: 'Metrics to compare',
    enum: AnalyticsMetric,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(AnalyticsMetric, { each: true })
  metrics?: AnalyticsMetric[];

  @ApiPropertyOptional({
    description: 'Group comparison by',
    enum: AnalyticsGroupBy,
  })
  @IsOptional()
  @IsEnum(AnalyticsGroupBy)
  groupBy?: AnalyticsGroupBy;
}

/**
 * DTO for real-time analytics query
 */
export class RealTimeAnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Time window in minutes',
    default: 60,
    minimum: 5,
    maximum: 1440,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  windowMinutes?: number;

  @ApiPropertyOptional({
    description: 'Refresh interval in seconds',
    default: 30,
    minimum: 5,
    maximum: 300,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(300)
  refreshInterval?: number;

  @ApiPropertyOptional({
    description: 'Include active users count',
    default: true,
  })
  @IsOptional()
  includeActiveUsers?: boolean;
}
