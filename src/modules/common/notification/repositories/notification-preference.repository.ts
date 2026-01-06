import { UserNotificationPreference } from '../../../../types';
import { NotificationType, NotificationChannel } from '@prisma/client';

export abstract class NotificationPreferenceRepository {
  /**
   * Get all notification preferences for a user
   */
  abstract getUserPreferences(userId: string): Promise<UserNotificationPreference[]>;

  /**
   * Get a specific notification preference by user, type, and event
   */
  abstract getPreference(
    userId: string,
    type: NotificationType,
    eventType?: string,
  ): Promise<UserNotificationPreference | null>;

  /**
   * Create a new notification preference
   */
  abstract createPreference(
    userId: string,
    type: NotificationType,
    eventType: string | null,
    channels: NotificationChannel[],
    isMandatory: boolean,
  ): Promise<UserNotificationPreference>;

  /**
   * Update an existing notification preference
   */
  abstract updatePreference(
    userId: string,
    type: NotificationType,
    eventType: string | null,
    channels: NotificationChannel[],
    enabled: boolean,
  ): Promise<UserNotificationPreference>;

  /**
   * Delete all preferences for a user (used before reset)
   */
  abstract deleteUserPreferences(userId: string): Promise<void>;

  /**
   * Batch create preferences
   */
  abstract batchCreatePreferences(
    preferences: Array<{
      userId: string;
      type: NotificationType;
      eventType: string | null;
      channels: NotificationChannel[];
      isMandatory: boolean;
    }>,
  ): Promise<UserNotificationPreference[]>;

  /**
   * Check if a preference exists
   */
  abstract preferenceExists(
    userId: string,
    type: NotificationType,
    eventType?: string,
  ): Promise<boolean>;

  /**
   * Get channels for a specific event type
   */
  abstract getChannelsForEvent(
    userId: string,
    type: NotificationType,
    eventType?: string,
  ): Promise<NotificationChannel[]>;
}
