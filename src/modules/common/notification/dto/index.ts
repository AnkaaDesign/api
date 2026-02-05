/**
 * Notification DTOs Index
 *
 * This file exports all DTOs for the notification module for easy importing
 */

// Create Notification DTOs
export {
  CreateNotificationDto,
  BulkCreateNotificationDto,
  CreateSectorNotificationDto,
} from './create-notification.dto';

// Update Notification DTOs
export { UpdateNotificationDto, PatchNotificationStatusDto } from './update-notification.dto';

// Filter DTOs
export {
  NotificationFilterDto,
  NotificationDeliveryFilterDto,
  AdminNotificationFilterDto,
  NOTIFICATION_DELIVERY_STATUS,
} from './notification-filter.dto';

// Preference DTOs
export {
  UpdateNotificationPreferenceDto,
  BulkUpdateNotificationPreferencesDto,
  UpdateGlobalNotificationSettingsDto,
  UpdateChannelPreferencesDto,
  ToggleNotificationTypeDto,
  NotificationPreferencesExportDto,
  ResetPreferencesDto,
} from './notification-preference.dto';

// Mark Read DTOs
export {
  MarkNotificationReadDto,
  MarkNotificationsReadDto,
  MarkAllReadDto,
  MarkNotificationSeenDto,
  MarkNotificationsSeenDto,
  MarkNotificationUnreadDto,
  ArchiveNotificationsDto,
  DismissNotificationsDto,
  BulkNotificationActionDto,
  ClearOldNotificationsDto,
} from './mark-read.dto';

// Remind Later DTOs
export {
  RemindLaterDto,
  RemindAtDto,
  SnoozeNotificationDto,
  RescheduleReminderDto,
  RescheduleReminderAtDto,
  CancelReminderDto,
  GetReminderStatusDto,
  UpdateSnoozePreferencesDto,
  BatchRemindLaterDto,
  GetReminderSuggestionsDto,
} from './remind-later.dto';

// Response DTOs
export {
  NotificationResponseDto,
  PaginatedNotificationResponseDto,
  NotificationCountResponseDto,
  NotificationActionResponseDto,
  NotificationSummaryResponseDto,
  BatchNotificationResponseDto,
  DeliveryStatusSummaryDto,
  NotificationDeliveryResponseDto,
  NotificationUserResponseDto,
  NotificationDeliveryStatus,
} from './notification-response.dto';

// Analytics DTOs
export {
  AnalyticsQueryDto,
  NotificationPerformanceQueryDto,
  UserEngagementQueryDto,
  DeliveryAnalyticsQueryDto,
  ChannelPerformanceQueryDto,
  TrendAnalysisQueryDto,
  TopNotificationsQueryDto,
  ComparativeAnalyticsQueryDto,
  RealTimeAnalyticsQueryDto,
  AnalyticsTimeRange,
  AnalyticsGroupBy,
  AnalyticsMetric,
} from './analytics-query.dto';

// Legacy DTOs (from notification-api.dto.ts)
export {
  GetNotificationsFilterDto,
  MarkNotificationsReadDto as LegacyMarkNotificationsReadDto,
  MarkNotificationDeliveredDto,
  SetNotificationReminderDto,
  SendNotificationDto,
  UpdateNotificationPreferencesDto as LegacyUpdateNotificationPreferencesDto,
  BulkUpdateNotificationPreferencesDto as LegacyBulkUpdateNotificationPreferencesDto,
  AnalyticsQueryDto as LegacyAnalyticsQueryDto,
} from './notification-api.dto';

// Reminder DTOs (from notification-reminder.dto.ts)
export {
  ScheduleReminderDto,
  RescheduleReminderDto as LegacyRescheduleReminderDto,
  CancelReminderDto as LegacyCancelReminderDto,
  CleanupRemindersDto,
  ReminderStatsResponseDto,
  ReminderOptionResponseDto,
  ReminderWithDataResponseDto,
  ManualProcessingResponseDto,
  CleanupResponseDto,
  ReminderSuccessResponseDto,
} from './notification-reminder.dto';
