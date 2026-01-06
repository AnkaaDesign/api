import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsUUID,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
} from '../../../../constants';

/**
 * Notification delivery status enum
 */
export enum NOTIFICATION_DELIVERY_STATUS {
  PENDING = 'PENDING',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
}

/**
 * DTO for filtering notifications
 */
export class NotificationFilterDto {
  @ApiPropertyOptional({
    description: 'Filter by notification type',
    enum: NOTIFICATION_TYPE,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_TYPE)
  type?: NOTIFICATION_TYPE;

  @ApiPropertyOptional({
    description: 'Filter by read status',
    enum: ['read', 'unread', 'all'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['read', 'unread', 'all'])
  status?: 'read' | 'unread' | 'all';

  @ApiPropertyOptional({
    description: 'Filter by seen status',
  })
  @IsOptional()
  @IsBoolean()
  isSeen?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by archived status',
  })
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by notification channel',
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

  @ApiPropertyOptional({
    description: 'Filter notifications created after this date (ISO format)',
    example: '2026-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter notifications created before this date (ISO format)',
    example: '2026-01-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Filter by related entity type',
    example: 'TASK',
  })
  @IsOptional()
  @IsString()
  relatedEntityType?: string;

  @ApiPropertyOptional({
    description: 'Filter by related entity ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsOptional()
  @IsUUID('4')
  relatedEntityId?: string;

  @ApiPropertyOptional({
    description: 'Filter by delivery status',
    enum: NOTIFICATION_DELIVERY_STATUS,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_DELIVERY_STATUS)
  deliveryStatus?: NOTIFICATION_DELIVERY_STATUS;

  @ApiPropertyOptional({
    description: 'Search in title and body',
    example: 'task',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Include expired notifications',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includeExpired?: boolean;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['createdAt', 'updatedAt', 'importance', 'type'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'importance', 'type'])
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

/**
 * DTO for filtering notification deliveries
 */
export class NotificationDeliveryFilterDto {
  @ApiPropertyOptional({
    description: 'Filter by notification ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID('4')
  notificationId?: string;

  @ApiPropertyOptional({
    description: 'Filter by channel',
    enum: NOTIFICATION_CHANNEL,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_CHANNEL)
  channel?: NOTIFICATION_CHANNEL;

  @ApiPropertyOptional({
    description: 'Filter by delivery status',
    enum: NOTIFICATION_DELIVERY_STATUS,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_DELIVERY_STATUS)
  status?: NOTIFICATION_DELIVERY_STATUS;

  @ApiPropertyOptional({
    description: 'Filter deliveries attempted after this date (ISO format)',
    example: '2026-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter deliveries attempted before this date (ISO format)',
    example: '2026-01-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/**
 * DTO for admin notification filters (extended)
 */
export class AdminNotificationFilterDto extends NotificationFilterDto {
  @ApiPropertyOptional({
    description: 'Filter by scheduled status',
  })
  @IsOptional()
  @IsBoolean()
  isScheduled?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by mandatory status',
  })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by sector',
    example: 'PRODUCTION',
  })
  @IsOptional()
  @IsString()
  sector?: string;

  @ApiPropertyOptional({
    description: 'Include system notifications',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeSystem?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by creation method (manual, automatic)',
    enum: ['manual', 'automatic', 'all'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['manual', 'automatic', 'all'])
  creationMethod?: 'manual' | 'automatic' | 'all';
}
