import {
  IsArray,
  IsUUID,
  IsBoolean,
  IsOptional,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NOTIFICATION_TYPE } from '../../../../constants';

/**
 * DTO for marking a single notification as read
 */
export class MarkNotificationReadDto {
  @ApiProperty({
    description: 'Notification ID to mark as read',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  notificationId: string;
}

/**
 * DTO for marking multiple notifications as read
 */
export class MarkNotificationsReadDto {
  @ApiProperty({
    description: 'Array of notification IDs to mark as read',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  notificationIds: string[];
}

/**
 * DTO for marking all notifications as read with optional filters
 */
export class MarkAllReadDto {
  @ApiPropertyOptional({
    description: 'Only mark notifications of specific types as read',
    enum: NOTIFICATION_TYPE,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(NOTIFICATION_TYPE, { each: true })
  types?: NOTIFICATION_TYPE[];

  @ApiPropertyOptional({
    description: 'Only mark notifications created before this date (ISO format)',
    example: '2026-01-05T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  before?: string;
}

/**
 * DTO for marking a notification as seen (viewed but not necessarily read)
 */
export class MarkNotificationSeenDto {
  @ApiProperty({
    description: 'Notification ID to mark as seen',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  notificationId: string;
}

/**
 * DTO for marking multiple notifications as seen
 */
export class MarkNotificationsSeenDto {
  @ApiProperty({
    description: 'Array of notification IDs to mark as seen',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  notificationIds: string[];
}

/**
 * DTO for marking a notification as unread
 */
export class MarkNotificationUnreadDto {
  @ApiProperty({
    description: 'Notification ID to mark as unread',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  notificationId: string;
}

/**
 * DTO for archiving/unarchiving notifications
 */
export class ArchiveNotificationsDto {
  @ApiProperty({
    description: 'Array of notification IDs to archive or unarchive',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  notificationIds: string[];

  @ApiProperty({
    description: 'Whether to archive (true) or unarchive (false)',
    example: true,
  })
  @IsBoolean()
  archive: boolean;
}

/**
 * DTO for dismissing notifications
 */
export class DismissNotificationsDto {
  @ApiProperty({
    description: 'Array of notification IDs to dismiss',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  notificationIds: string[];
}

/**
 * DTO for bulk notification actions
 */
export class BulkNotificationActionDto {
  @ApiProperty({
    description: 'Array of notification IDs to perform action on',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  notificationIds: string[];

  @ApiProperty({
    description: 'Action to perform',
    enum: ['mark_read', 'mark_unread', 'mark_seen', 'archive', 'unarchive', 'dismiss', 'delete'],
    example: 'mark_read',
  })
  @IsEnum(['mark_read', 'mark_unread', 'mark_seen', 'archive', 'unarchive', 'dismiss', 'delete'])
  action: 'mark_read' | 'mark_unread' | 'mark_seen' | 'archive' | 'unarchive' | 'dismiss' | 'delete';
}

/**
 * DTO for clearing old notifications
 */
export class ClearOldNotificationsDto {
  @ApiPropertyOptional({
    description: 'Clear notifications older than this many days',
    example: 30,
  })
  @IsOptional()
  olderThanDays?: number;

  @ApiPropertyOptional({
    description: 'Only clear read notifications',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  onlyRead?: boolean;

  @ApiPropertyOptional({
    description: 'Only clear notifications of specific types',
    enum: NOTIFICATION_TYPE,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(NOTIFICATION_TYPE, { each: true })
  types?: NOTIFICATION_TYPE[];
}
