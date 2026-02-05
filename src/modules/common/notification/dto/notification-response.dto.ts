import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
} from '../../../../constants';

/**
 * Notification delivery status for responses
 */
export enum NotificationDeliveryStatus {
  PENDING = 'PENDING',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
}

/**
 * Delivery information response DTO
 */
export class NotificationDeliveryResponseDto {
  @ApiProperty({ description: 'Delivery ID' })
  id: string;

  @ApiProperty({ description: 'Channel used for delivery', enum: NOTIFICATION_CHANNEL })
  channel: NOTIFICATION_CHANNEL;

  @ApiProperty({ description: 'Delivery status', enum: NotificationDeliveryStatus })
  status: NotificationDeliveryStatus;

  @ApiPropertyOptional({ description: 'When delivery was attempted' })
  attemptedAt?: Date;

  @ApiPropertyOptional({ description: 'When delivery was successful' })
  deliveredAt?: Date;

  @ApiPropertyOptional({ description: 'When delivery failed' })
  failedAt?: Date;

  @ApiPropertyOptional({ description: 'Error message if delivery failed' })
  errorMessage?: string;

  @ApiPropertyOptional({ description: 'Number of retry attempts' })
  retryCount?: number;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  metadata?: Record<string, any>;
}

/**
 * User information response DTO (minimal)
 */
export class NotificationUserResponseDto {
  @ApiProperty({ description: 'User ID' })
  id: string;

  @ApiProperty({ description: 'User name' })
  name: string;

  @ApiProperty({ description: 'User email' })
  email: string;

  @ApiPropertyOptional({ description: 'User avatar URL' })
  avatar?: string;
}

/**
 * Main notification response DTO
 */
export class NotificationResponseDto {
  @ApiProperty({ description: 'Notification ID' })
  id: string;

  @ApiProperty({ description: 'User ID who receives the notification' })
  userId: string;

  @ApiProperty({ description: 'Notification title' })
  title: string;

  @ApiProperty({ description: 'Notification body/content' })
  body: string;

  @ApiProperty({ description: 'Notification type', enum: NOTIFICATION_TYPE })
  type: NOTIFICATION_TYPE;

  @ApiProperty({ description: 'Notification importance', enum: NOTIFICATION_IMPORTANCE })
  importance: NOTIFICATION_IMPORTANCE;

  @ApiPropertyOptional({ description: 'Action URL' })
  actionUrl?: string;

  @ApiPropertyOptional({ description: 'Action type' })
  actionType?: string;

  @ApiProperty({ description: 'Whether notification has been read' })
  isRead: boolean;

  @ApiProperty({ description: 'Whether notification has been seen' })
  isSeen: boolean;

  @ApiPropertyOptional({ description: 'Whether notification is archived' })
  isArchived?: boolean;

  @ApiPropertyOptional({ description: 'Whether notification is dismissed' })
  isDismissed?: boolean;

  @ApiPropertyOptional({ description: 'Related entity ID' })
  relatedEntityId?: string;

  @ApiPropertyOptional({ description: 'Related entity type' })
  relatedEntityType?: string;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  metadata?: Record<string, any>;

  @ApiProperty({ description: 'When notification was created' })
  createdAt: Date;

  @ApiProperty({ description: 'When notification was last updated' })
  updatedAt: Date;

  @ApiPropertyOptional({ description: 'When notification was read' })
  readAt?: Date;

  @ApiPropertyOptional({ description: 'When notification was seen' })
  seenAt?: Date;

  @ApiPropertyOptional({ description: 'When notification expires' })
  expiresAt?: Date;

  @ApiPropertyOptional({ description: 'When notification is scheduled for' })
  scheduledAt?: Date;

  @ApiPropertyOptional({
    description: 'Delivery information',
    type: [NotificationDeliveryResponseDto],
  })
  deliveries?: NotificationDeliveryResponseDto[];

  @ApiPropertyOptional({ description: 'Whether a reminder is set' })
  hasReminder?: boolean;

  @ApiPropertyOptional({ description: 'Reminder time if set' })
  remindAt?: Date;
}

/**
 * Paginated notification list response DTO
 */
export class PaginatedNotificationResponseDto {
  @ApiProperty({ description: 'List of notifications', type: [NotificationResponseDto] })
  data: NotificationResponseDto[];

  @ApiProperty({ description: 'Total number of notifications' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Number of items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;

  @ApiProperty({ description: 'Whether there is a next page' })
  hasNext: boolean;

  @ApiProperty({ description: 'Whether there is a previous page' })
  hasPrev: boolean;

  @ApiPropertyOptional({ description: 'Unread count' })
  unreadCount?: number;
}

/**
 * Notification count response DTO
 */
export class NotificationCountResponseDto {
  @ApiProperty({ description: 'Total notifications' })
  total: number;

  @ApiProperty({ description: 'Unread notifications' })
  unread: number;

  @ApiProperty({ description: 'Read notifications' })
  read: number;

  @ApiPropertyOptional({ description: 'Unseen notifications' })
  unseen?: number;

  @ApiPropertyOptional({ description: 'Archived notifications' })
  archived?: number;

  @ApiPropertyOptional({ description: 'Notifications with active reminders' })
  withReminders?: number;

  @ApiPropertyOptional({ description: 'Count by notification type' })
  byType?: Record<string, number>;

  @ApiPropertyOptional({ description: 'Count by importance level' })
  byImportance?: Record<string, number>;
}

/**
 * Notification action response DTO
 */
export class NotificationActionResponseDto {
  @ApiProperty({ description: 'Whether action was successful' })
  success: boolean;

  @ApiProperty({ description: 'Action result message' })
  message: string;

  @ApiPropertyOptional({ description: 'Number of notifications affected' })
  affectedCount?: number;

  @ApiPropertyOptional({ description: 'IDs of affected notifications' })
  affectedIds?: string[];

  @ApiPropertyOptional({ description: 'Additional data' })
  data?: any;
}

/**
 * Notification summary response DTO
 */
export class NotificationSummaryResponseDto {
  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'Notification counts', type: NotificationCountResponseDto })
  counts: NotificationCountResponseDto;

  @ApiPropertyOptional({ description: 'Recent notifications', type: [NotificationResponseDto] })
  recent?: NotificationResponseDto[];

  @ApiPropertyOptional({
    description: 'Notifications with active reminders',
    type: [NotificationResponseDto],
  })
  withReminders?: NotificationResponseDto[];

  @ApiPropertyOptional({ description: 'Latest notification timestamp' })
  latestNotificationAt?: Date;
}

/**
 * Batch operation response DTO
 */
export class BatchNotificationResponseDto {
  @ApiProperty({ description: 'Whether operation was successful' })
  success: boolean;

  @ApiProperty({ description: 'Number of successful operations' })
  successCount: number;

  @ApiProperty({ description: 'Number of failed operations' })
  failureCount: number;

  @ApiPropertyOptional({ description: 'IDs of successfully processed notifications' })
  successIds?: string[];

  @ApiPropertyOptional({ description: 'IDs of failed notifications' })
  failureIds?: string[];

  @ApiPropertyOptional({ description: 'Error details for failures' })
  errors?: Array<{ id: string; error: string }>;

  @ApiProperty({ description: 'Operation result message' })
  message: string;
}

/**
 * Delivery status summary response DTO
 */
export class DeliveryStatusSummaryDto {
  @ApiProperty({ description: 'Notification ID' })
  notificationId: string;

  @ApiProperty({ description: 'Total delivery attempts' })
  totalDeliveries: number;

  @ApiProperty({ description: 'Successful deliveries' })
  delivered: number;

  @ApiProperty({ description: 'Failed deliveries' })
  failed: number;

  @ApiProperty({ description: 'Pending deliveries' })
  pending: number;

  @ApiPropertyOptional({ description: 'Deliveries by channel' })
  byChannel?: Record<string, NotificationDeliveryStatus>;

  @ApiPropertyOptional({ description: 'Overall delivery status' })
  overallStatus?: 'all_delivered' | 'partial_delivered' | 'all_failed' | 'pending';
}
