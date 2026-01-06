import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsBoolean,
  IsDateString,
  IsUUID,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
} from '../../../../constants';

/**
 * DTO for filtering notifications in GET /notifications
 */
export class GetNotificationsFilterDto {
  @ApiPropertyOptional({ description: 'Filter by notification type', enum: NOTIFICATION_TYPE })
  @IsOptional()
  @IsEnum(NOTIFICATION_TYPE)
  type?: NOTIFICATION_TYPE;

  @ApiPropertyOptional({ description: 'Filter by read status', enum: ['read', 'unread', 'all'] })
  @IsOptional()
  @IsIn(['read', 'unread', 'all'])
  status?: 'read' | 'unread' | 'all';

  @ApiPropertyOptional({
    description: 'Filter by notification channel',
    enum: NOTIFICATION_CHANNEL,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_CHANNEL)
  channel?: NOTIFICATION_CHANNEL;

  @ApiPropertyOptional({ description: 'Page number for pagination', example: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: 'Number of items per page', example: 20 })
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

/**
 * DTO for marking notifications as read
 */
export class MarkNotificationsReadDto {
  @ApiProperty({ description: 'Array of notification IDs to mark as read', type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  notificationIds: string[];
}

/**
 * DTO for marking notification as delivered
 */
export class MarkNotificationDeliveredDto {
  @ApiProperty({ description: 'Notification ID to mark as delivered' })
  @IsUUID('4')
  notificationId: string;

  @ApiProperty({
    description: 'Channel where notification was delivered',
    enum: NOTIFICATION_CHANNEL,
  })
  @IsEnum(NOTIFICATION_CHANNEL)
  channel: NOTIFICATION_CHANNEL;
}

/**
 * DTO for setting reminder for notification
 */
export class SetNotificationReminderDto {
  @ApiProperty({
    description: 'When to remind about this notification (ISO date string)',
    example: '2026-01-10T10:00:00Z',
  })
  @IsDateString()
  remindAt: string;
}

/**
 * DTO for sending notification (admin)
 */
export class SendNotificationDto {
  @ApiProperty({ description: 'User ID to send notification to (optional if targeting sectors)' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiProperty({ description: 'Notification title', example: 'Important Update' })
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Notification body/content',
    example: 'Please review the new policy document',
  })
  @IsString()
  body: string;

  @ApiProperty({ description: 'Notification type', enum: NOTIFICATION_TYPE })
  @IsEnum(NOTIFICATION_TYPE)
  type: NOTIFICATION_TYPE;

  @ApiProperty({
    description: 'Channels to send notification through',
    enum: NOTIFICATION_CHANNEL,
    isArray: true,
  })
  @Transform(({ value }) => {
    // Convert object with numeric keys to array
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.values(value);
    }
    return value;
  })
  @IsArray()
  @IsEnum(NOTIFICATION_CHANNEL, { each: true })
  channel: NOTIFICATION_CHANNEL[];

  @ApiPropertyOptional({
    description: 'Notification importance level',
    enum: NOTIFICATION_IMPORTANCE,
    default: 'NORMAL',
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_IMPORTANCE)
  importance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({ description: 'Action URL (optional)', example: '/tasks/123' })
  @IsOptional()
  @IsString()
  actionUrl?: string;

  @ApiPropertyOptional({ description: 'Schedule notification for later (ISO date string)' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({ description: 'Target sectors (optional)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetSectors?: string[];

  @ApiPropertyOptional({ description: 'Target specific users by ID (optional)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  targetUsers?: string[];

  @ApiPropertyOptional({
    description: 'Is this notification mandatory (cannot be disabled)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;
}

/**
 * DTO for updating notification preferences
 */
export class UpdateNotificationPreferencesDto {
  @ApiProperty({
    description: 'Notification type to update preference for',
    enum: NOTIFICATION_TYPE,
  })
  @IsEnum(NOTIFICATION_TYPE)
  notificationType: NOTIFICATION_TYPE;

  @ApiPropertyOptional({
    description: 'Event type within the notification type (e.g., "status" for TASK)',
  })
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiProperty({ description: 'Whether this notification type is enabled', default: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    description: 'Channels to receive this notification type',
    enum: NOTIFICATION_CHANNEL,
    isArray: true,
  })
  @IsArray()
  @IsEnum(NOTIFICATION_CHANNEL, { each: true })
  channels: NOTIFICATION_CHANNEL[];
}

/**
 * DTO for bulk updating notification preferences
 */
export class BulkUpdateNotificationPreferencesDto {
  @ApiProperty({
    description: 'Array of preferences to update',
    type: [UpdateNotificationPreferencesDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateNotificationPreferencesDto)
  preferences: UpdateNotificationPreferencesDto[];
}

/**
 * Query DTO for analytics endpoints
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
}
