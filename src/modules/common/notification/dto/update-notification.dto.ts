import { IsString, IsEnum, IsOptional, IsBoolean, IsDateString, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { NOTIFICATION_TYPE, NOTIFICATION_IMPORTANCE } from '../../../../constants';

/**
 * DTO for updating a notification
 */
export class UpdateNotificationDto {
  @ApiPropertyOptional({
    description: 'Notification title',
    example: 'Updated Task Assignment',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Notification body/content',
    example: 'Task details have been updated',
  })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({
    description: 'Notification type',
    enum: NOTIFICATION_TYPE,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_TYPE)
  type?: NOTIFICATION_TYPE;

  @ApiPropertyOptional({
    description: 'Notification importance level',
    enum: NOTIFICATION_IMPORTANCE,
  })
  @IsOptional()
  @IsEnum(NOTIFICATION_IMPORTANCE)
  importance?: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({
    description: 'Action URL for the notification',
    example: '/tasks/1234',
  })
  @IsOptional()
  @IsString()
  actionUrl?: string;

  @ApiPropertyOptional({
    description: 'Action type for the notification',
    example: 'NAVIGATE',
  })
  @IsOptional()
  @IsString()
  actionType?: string;

  @ApiPropertyOptional({
    description: 'Schedule notification for later (ISO date string)',
    example: '2026-01-10T10:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata for the notification',
    example: { taskNumber: 'T-1234', priority: 'high' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Whether this notification is mandatory (cannot be disabled)',
  })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional({
    description: 'Expiration date for the notification (ISO date string)',
    example: '2026-01-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description: 'Whether the notification has been read',
  })
  @IsOptional()
  @IsBoolean()
  isRead?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the notification has been seen',
  })
  @IsOptional()
  @IsBoolean()
  isSeen?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the notification is archived',
  })
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

/**
 * DTO for patching notification status fields
 */
export class PatchNotificationStatusDto {
  @ApiPropertyOptional({
    description: 'Whether the notification has been read',
  })
  @IsOptional()
  @IsBoolean()
  isRead?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the notification has been seen',
  })
  @IsOptional()
  @IsBoolean()
  isSeen?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the notification is archived',
  })
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the notification is dismissed',
  })
  @IsOptional()
  @IsBoolean()
  isDismissed?: boolean;
}
