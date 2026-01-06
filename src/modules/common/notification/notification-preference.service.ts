import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { NotificationPreferenceRepository } from './repositories/notification-preference.repository';
import { UserNotificationPreference } from '../../../types';
import { NotificationType, NotificationChannel } from '@prisma/client';
import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL } from '../../../constants';

export interface DefaultNotificationPreference {
  type: NOTIFICATION_TYPE;
  eventType: string | null;
  channels: NOTIFICATION_CHANNEL[];
  mandatory: boolean;
}

export interface ChannelPreferences {
  [NOTIFICATION_CHANNEL.EMAIL]: UserNotificationPreference[];
  [NOTIFICATION_CHANNEL.PUSH]: UserNotificationPreference[];
  [NOTIFICATION_CHANNEL.IN_APP]: UserNotificationPreference[];
  [NOTIFICATION_CHANNEL.SMS]: UserNotificationPreference[];
  [NOTIFICATION_CHANNEL.WHATSAPP]: UserNotificationPreference[];
}

export interface TypePreferences {
  [NOTIFICATION_TYPE.TASK]: UserNotificationPreference[];
  [NOTIFICATION_TYPE.ORDER]: UserNotificationPreference[];
  [NOTIFICATION_TYPE.STOCK]: UserNotificationPreference[];
  [NOTIFICATION_TYPE.PPE]: UserNotificationPreference[];
  [NOTIFICATION_TYPE.VACATION]: UserNotificationPreference[];
  [NOTIFICATION_TYPE.WARNING]: UserNotificationPreference[];
  [NOTIFICATION_TYPE.SYSTEM]: UserNotificationPreference[];
  [NOTIFICATION_TYPE.GENERAL]: UserNotificationPreference[];
}

@Injectable()
export class NotificationPreferenceService {
  private readonly logger = new Logger(NotificationPreferenceService.name);

  constructor(private readonly preferenceRepository: NotificationPreferenceRepository) {}

  /**
   * Get all notification preferences for a user
   */
  async getUserPreferences(userId: string): Promise<UserNotificationPreference[]> {
    try {
      const preferences = await this.preferenceRepository.getUserPreferences(userId);

      // If user has no preferences, initialize with defaults
      if (preferences.length === 0) {
        this.logger.log(`User ${userId} has no preferences, initializing with defaults`);
        await this.initializeUserPreferences(userId);
        return await this.preferenceRepository.getUserPreferences(userId);
      }

      return preferences;
    } catch (error) {
      this.logger.error(`Failed to get user preferences for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Update a notification preference
   */
  async updatePreference(
    userId: string,
    type: string,
    eventType: string,
    channels: string[],
    requestingUserId: string,
    isAdmin: boolean = false,
  ): Promise<UserNotificationPreference> {
    this.logger.log('Updating user notification preference', {
      userId,
      type,
      eventType,
      channels,
      requestedBy: requestingUserId,
      isAdmin,
    });

    // Validate user can only update their own preferences unless admin
    if (userId !== requestingUserId && !isAdmin) {
      this.logger.warn('Unauthorized preference update attempt', {
        userId,
        requestingUserId,
        type,
      });
      throw new ForbiddenException('You can only update your own notification preferences');
    }

    // Validate notification type
    const notificationType = this.validateNotificationType(type);

    // Validate channels
    const validatedChannels = this.validateChannels(channels);

    // Check if preference exists
    const existingPreference = await this.preferenceRepository.getPreference(
      userId,
      notificationType as NotificationType,
      eventType || null,
    );

    if (!existingPreference) {
      this.logger.warn('Notification preference not found', {
        userId,
        type,
        eventType,
      });
      throw new NotFoundException(
        `Notification preference not found for type ${type} and event ${eventType}`,
      );
    }

    // Check if preference is mandatory
    if (existingPreference.isMandatory && validatedChannels.length === 0) {
      this.logger.warn('User attempted to disable mandatory notification', {
        userId,
        type,
        eventType,
        isMandatory: true,
      });
      throw new BadRequestException(
        'Cannot disable mandatory notification preferences. You must have at least one channel enabled.',
      );
    }

    // Update the preference
    try {
      const updated = await this.preferenceRepository.updatePreference(
        userId,
        notificationType as NotificationType,
        eventType || null,
        validatedChannels as NotificationChannel[],
        validatedChannels.length > 0, // enabled if channels exist
      );

      this.logger.log('User notification preference updated successfully', {
        userId,
        type,
        eventType,
        oldChannels: existingPreference.channels,
        newChannels: validatedChannels,
        enabled: validatedChannels.length > 0,
      });

      return updated;
    } catch (error) {
      this.logger.error('Failed to update notification preference', {
        error: error.message,
        userId,
        type,
        eventType,
      });
      throw error;
    }
  }

  /**
   * Reset user preferences to defaults
   */
  async resetToDefaults(
    userId: string,
    requestingUserId: string,
    isAdmin: boolean = false,
  ): Promise<void> {
    // Validate user can only reset their own preferences unless admin
    if (userId !== requestingUserId && !isAdmin) {
      throw new ForbiddenException('You can only reset your own notification preferences');
    }

    try {
      // Delete all existing preferences
      await this.preferenceRepository.deleteUserPreferences(userId);

      // Initialize with defaults
      await this.initializeUserPreferences(userId);

      this.logger.log(`Reset notification preferences to defaults for user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to reset notification preferences for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Get notification channels for a specific event
   */
  async getChannelsForEvent(
    userId: string,
    type: string,
    eventType?: string,
  ): Promise<NOTIFICATION_CHANNEL[]> {
    try {
      const notificationType = this.validateNotificationType(type);

      const channels = await this.preferenceRepository.getChannelsForEvent(
        userId,
        notificationType as NotificationType,
        eventType,
      );

      return channels.map(ch => ch as NOTIFICATION_CHANNEL);
    } catch (error) {
      this.logger.error(
        `Failed to get channels for user ${userId}, type ${type}, event ${eventType}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Initialize default notification preferences for a new user
   */
  async initializeUserPreferences(userId: string): Promise<void> {
    try {
      const defaults = this.getDefaultPreferences();

      const preferences = defaults.map(def => ({
        userId,
        type: this.mapToNotificationType(def.type),
        eventType: def.eventType,
        channels: def.channels.map(ch => this.mapToNotificationChannel(ch)),
        isMandatory: def.mandatory,
      }));

      await this.preferenceRepository.batchCreatePreferences(preferences);

      this.logger.log(`Initialized default notification preferences for user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to initialize preferences for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Validate preferences - ensure task notifications cannot be disabled
   */
  async validatePreferences(
    userId: string,
    type: string,
    eventType: string | null,
    channels: string[],
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const notificationType = this.validateNotificationType(type);

    // Check if this is a task notification (mandatory)
    if (notificationType === NOTIFICATION_TYPE.TASK) {
      if (channels.length === 0) {
        errors.push('Task notifications are mandatory and cannot be completely disabled.');
      }

      // Ensure at least one channel is enabled for mandatory task notifications
      const taskMandatoryEvents = [
        'status',
        'deadline',
        'assignment',
        'artwork',
        'priority',
        'description',
        'customer',
        'sector',
        'comment',
        'completion',
      ];

      if (eventType && taskMandatoryEvents.includes(eventType) && channels.length === 0) {
        errors.push(
          `Task notification for '${eventType}' is mandatory and requires at least one channel.`,
        );
      }
    }

    // Validate channels exist
    try {
      this.validateChannels(channels);
    } catch (error) {
      if (error instanceof BadRequestException) {
        errors.push(error.message);
      }
    }

    // Check if preference exists
    try {
      const existingPreference = await this.preferenceRepository.getPreference(
        userId,
        notificationType as NotificationType,
        eventType || null,
      );

      if (existingPreference?.isMandatory && channels.length === 0) {
        errors.push('This notification preference is mandatory and cannot be disabled.');
      }
    } catch (error) {
      this.logger.warn(`Could not find existing preference for validation: ${error.message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get preferences grouped by channel (EMAIL, PUSH, WHATSAPP, IN_APP)
   */
  async getChannelPreferences(userId: string): Promise<ChannelPreferences> {
    try {
      const allPreferences = await this.getUserPreferences(userId);

      const channelPrefs: ChannelPreferences = {
        [NOTIFICATION_CHANNEL.EMAIL]: [],
        [NOTIFICATION_CHANNEL.PUSH]: [],
        [NOTIFICATION_CHANNEL.IN_APP]: [],
        [NOTIFICATION_CHANNEL.SMS]: [],
        [NOTIFICATION_CHANNEL.WHATSAPP]: [],
      };

      // Group preferences by channel
      for (const pref of allPreferences) {
        for (const channel of pref.channels) {
          const channelKey = channel as string;

          // Map channel to enum and add to the appropriate array
          if (channelKey in channelPrefs) {
            channelPrefs[channel as NOTIFICATION_CHANNEL].push(pref);
          }
        }
      }

      return channelPrefs;
    } catch (error) {
      this.logger.error(`Failed to get channel preferences for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Get preferences grouped by type (TASK_CREATED, TASK_UPDATED, ORDER_CREATED, STOCK_LOW, etc.)
   */
  async getTypePreferences(userId: string): Promise<TypePreferences> {
    try {
      const allPreferences = await this.getUserPreferences(userId);

      const typePrefs: TypePreferences = {
        [NOTIFICATION_TYPE.TASK]: [],
        [NOTIFICATION_TYPE.ORDER]: [],
        [NOTIFICATION_TYPE.STOCK]: [],
        [NOTIFICATION_TYPE.PPE]: [],
        [NOTIFICATION_TYPE.VACATION]: [],
        [NOTIFICATION_TYPE.WARNING]: [],
        [NOTIFICATION_TYPE.SYSTEM]: [],
        [NOTIFICATION_TYPE.GENERAL]: [],
      };

      // Group preferences by notification type
      for (const pref of allPreferences) {
        const notifType = pref.notificationType as string;
        if (notifType in typePrefs) {
          typePrefs[notifType as NOTIFICATION_TYPE].push(pref);
        }
      }

      return typePrefs;
    } catch (error) {
      this.logger.error(`Failed to get type preferences for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Update multiple preferences at once
   */
  async updatePreferences(
    userId: string,
    preferences: Array<{
      type: string;
      eventType: string | null;
      channels: string[];
    }>,
    requestingUserId: string,
    isAdmin: boolean = false,
  ): Promise<UserNotificationPreference[]> {
    // Validate user can only update their own preferences unless admin
    if (userId !== requestingUserId && !isAdmin) {
      throw new ForbiddenException('You can only update your own notification preferences');
    }

    try {
      const updatedPreferences: UserNotificationPreference[] = [];

      for (const pref of preferences) {
        // Validate each preference
        const validation = await this.validatePreferences(
          userId,
          pref.type,
          pref.eventType,
          pref.channels,
        );

        if (!validation.valid) {
          throw new BadRequestException(
            `Invalid preference for ${pref.type}:${pref.eventType}: ${validation.errors.join(', ')}`,
          );
        }

        // Update the preference
        const updated = await this.updatePreference(
          userId,
          pref.type,
          pref.eventType || '',
          pref.channels,
          requestingUserId,
          isAdmin,
        );

        updatedPreferences.push(updated);
      }

      this.logger.log(
        `Updated ${updatedPreferences.length} notification preferences for user ${userId}`,
      );

      return updatedPreferences;
    } catch (error) {
      this.logger.error(`Failed to update multiple preferences for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Get default notification preferences
   */
  getDefaultPreferences(): DefaultNotificationPreference[] {
    return [
      // MANDATORY - Task updates (all fields)
      {
        type: NOTIFICATION_TYPE.TASK,
        eventType: 'status',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.EMAIL,
          NOTIFICATION_CHANNEL.PUSH,
        ],
        mandatory: true,
      },
      {
        type: NOTIFICATION_TYPE.TASK,
        eventType: 'deadline',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.EMAIL,
          NOTIFICATION_CHANNEL.PUSH,
        ],
        mandatory: true,
      },
      {
        type: NOTIFICATION_TYPE.TASK,
        eventType: 'assignment',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.EMAIL,
          NOTIFICATION_CHANNEL.PUSH,
        ],
        mandatory: true,
      },
      {
        type: NOTIFICATION_TYPE.TASK,
        eventType: 'artwork',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        mandatory: true,
      },
      {
        type: NOTIFICATION_TYPE.TASK,
        eventType: 'priority',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.EMAIL,
          NOTIFICATION_CHANNEL.PUSH,
        ],
        mandatory: true,
      },
      {
        type: NOTIFICATION_TYPE.TASK,
        eventType: 'description',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatory: true,
      },
      {
        type: NOTIFICATION_TYPE.TASK,
        eventType: 'customer',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        mandatory: true,
      },
      {
        type: NOTIFICATION_TYPE.TASK,
        eventType: 'sector',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        mandatory: true,
      },
      {
        type: NOTIFICATION_TYPE.TASK,
        eventType: 'comment',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatory: true,
      },
      {
        type: NOTIFICATION_TYPE.TASK,
        eventType: 'completion',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        mandatory: true,
      },

      // OPTIONAL - Orders
      {
        type: NOTIFICATION_TYPE.ORDER,
        eventType: 'created',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatory: false,
      },
      {
        type: NOTIFICATION_TYPE.ORDER,
        eventType: 'status',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        mandatory: false,
      },
      {
        type: NOTIFICATION_TYPE.ORDER,
        eventType: 'fulfilled',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        mandatory: false,
      },
      {
        type: NOTIFICATION_TYPE.ORDER,
        eventType: 'cancelled',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        mandatory: false,
      },
      {
        type: NOTIFICATION_TYPE.ORDER,
        eventType: 'overdue',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.EMAIL,
          NOTIFICATION_CHANNEL.PUSH,
        ],
        mandatory: false,
      },

      // OPTIONAL - Stock
      {
        type: NOTIFICATION_TYPE.STOCK,
        eventType: 'low',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        mandatory: false,
      },
      {
        type: NOTIFICATION_TYPE.STOCK,
        eventType: 'out',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        mandatory: false,
      },
      {
        type: NOTIFICATION_TYPE.STOCK,
        eventType: 'restock',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatory: false,
      },

      // OPTIONAL - PPE (Personal Protective Equipment)
      {
        type: NOTIFICATION_TYPE.PPE,
        eventType: 'delivery',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatory: false,
      },
      {
        type: NOTIFICATION_TYPE.PPE,
        eventType: 'expiration',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        mandatory: false,
      },
      {
        type: NOTIFICATION_TYPE.PPE,
        eventType: 'shortage',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.EMAIL,
          NOTIFICATION_CHANNEL.PUSH,
        ],
        mandatory: false,
      },

      // OPTIONAL - Vacation
      {
        type: NOTIFICATION_TYPE.VACATION,
        eventType: 'approved',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.EMAIL,
          NOTIFICATION_CHANNEL.PUSH,
        ],
        mandatory: false,
      },
      {
        type: NOTIFICATION_TYPE.VACATION,
        eventType: 'rejected',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.EMAIL,
          NOTIFICATION_CHANNEL.PUSH,
        ],
        mandatory: false,
      },
      {
        type: NOTIFICATION_TYPE.VACATION,
        eventType: 'expiring',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        mandatory: false,
      },

      // OPTIONAL - Warnings
      {
        type: NOTIFICATION_TYPE.WARNING,
        eventType: 'issued',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.EMAIL,
          NOTIFICATION_CHANNEL.PUSH,
        ],
        mandatory: false,
      },
      {
        type: NOTIFICATION_TYPE.WARNING,
        eventType: 'escalation',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.EMAIL,
          NOTIFICATION_CHANNEL.PUSH,
        ],
        mandatory: false,
      },

      // OPTIONAL - System
      {
        type: NOTIFICATION_TYPE.SYSTEM,
        eventType: 'maintenance',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        mandatory: false,
      },
      {
        type: NOTIFICATION_TYPE.SYSTEM,
        eventType: 'update',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatory: false,
      },
      {
        type: NOTIFICATION_TYPE.SYSTEM,
        eventType: 'announcement',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        mandatory: false,
      },

      // OPTIONAL - General
      {
        type: NOTIFICATION_TYPE.GENERAL,
        eventType: null,
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatory: false,
      },
    ];
  }

  /**
   * Validate notification type
   */
  private validateNotificationType(type: string): NOTIFICATION_TYPE {
    const upperType = type.toUpperCase();
    if (!Object.values(NOTIFICATION_TYPE).includes(upperType as NOTIFICATION_TYPE)) {
      throw new BadRequestException(
        `Invalid notification type: ${type}. Valid types are: ${Object.values(NOTIFICATION_TYPE).join(', ')}`,
      );
    }
    return upperType as NOTIFICATION_TYPE;
  }

  /**
   * Validate notification channels
   */
  private validateChannels(channels: string[]): NOTIFICATION_CHANNEL[] {
    const validatedChannels: NOTIFICATION_CHANNEL[] = [];

    for (const channel of channels) {
      const upperChannel = channel.toUpperCase();
      if (!Object.values(NOTIFICATION_CHANNEL).includes(upperChannel as NOTIFICATION_CHANNEL)) {
        throw new BadRequestException(
          `Invalid notification channel: ${channel}. Valid channels are: ${Object.values(NOTIFICATION_CHANNEL).join(', ')}`,
        );
      }
      validatedChannels.push(upperChannel as NOTIFICATION_CHANNEL);
    }

    return validatedChannels;
  }

  /**
   * Map NOTIFICATION_TYPE to Prisma NotificationType
   */
  private mapToNotificationType(type: NOTIFICATION_TYPE): NotificationType {
    return type as unknown as NotificationType;
  }

  /**
   * Map NOTIFICATION_CHANNEL to Prisma NotificationChannel
   */
  private mapToNotificationChannel(channel: NOTIFICATION_CHANNEL): NotificationChannel {
    return channel as unknown as NotificationChannel;
  }
}
