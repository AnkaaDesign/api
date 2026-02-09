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
  mandatoryChannels: NOTIFICATION_CHANNEL[]; // Channels that cannot be disabled by user
}

export interface ChannelPreferences {
  [NOTIFICATION_CHANNEL.IN_APP]: UserNotificationPreference[];
  [NOTIFICATION_CHANNEL.PUSH]: UserNotificationPreference[];
  [NOTIFICATION_CHANNEL.EMAIL]: UserNotificationPreference[];
  [NOTIFICATION_CHANNEL.WHATSAPP]: UserNotificationPreference[];
}

export interface TypePreferences {
  [NOTIFICATION_TYPE.SYSTEM]: UserNotificationPreference[];
  [NOTIFICATION_TYPE.PRODUCTION]: UserNotificationPreference[];
  [NOTIFICATION_TYPE.STOCK]: UserNotificationPreference[];
  [NOTIFICATION_TYPE.USER]: UserNotificationPreference[];
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

    // Check if user is trying to disable mandatory channels
    if (existingPreference?.mandatoryChannels && existingPreference.mandatoryChannels.length > 0) {
      const missingMandatoryChannels = existingPreference.mandatoryChannels.filter(
        mandatoryChannel => !validatedChannels.includes(mandatoryChannel),
      );

      if (missingMandatoryChannels.length > 0) {
        this.logger.warn('User attempted to disable mandatory channels', {
          userId,
          type,
          eventType,
          mandatoryChannels: existingPreference.mandatoryChannels,
          missingChannels: missingMandatoryChannels,
        });
        throw new BadRequestException(
          `Cannot disable mandatory channels: ${missingMandatoryChannels.join(', ')}. These channels are required for this notification type.`,
        );
      }
    }

    // Upsert the preference (create if not exists, update if exists)
    try {
      let result: UserNotificationPreference;

      if (existingPreference) {
        // Update existing preference
        result = await this.preferenceRepository.updatePreference(
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
      } else {
        // Create new preference
        this.logger.log('Creating new notification preference', {
          userId,
          type,
          eventType,
          channels: validatedChannels,
        });

        result = await this.preferenceRepository.createPreference(
          userId,
          notificationType as NotificationType,
          eventType || null,
          validatedChannels as NotificationChannel[],
          false, // New preferences created by user are not mandatory
        );

        this.logger.log('User notification preference created successfully', {
          userId,
          type,
          eventType,
          channels: validatedChannels,
          enabled: validatedChannels.length > 0,
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to update/create notification preference', {
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
        mandatoryChannels: def.mandatoryChannels.map(ch => this.mapToNotificationChannel(ch)),
      }));

      await this.preferenceRepository.batchCreatePreferences(preferences);

      this.logger.log(`Initialized default notification preferences for user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to initialize preferences for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Validate preferences - ensure mandatory channels cannot be disabled
   */
  async validatePreferences(
    userId: string,
    type: string,
    eventType: string | null,
    channels: string[],
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const notificationType = this.validateNotificationType(type);

    // Validate channels exist
    try {
      this.validateChannels(channels);
    } catch (error) {
      if (error instanceof BadRequestException) {
        errors.push(error.message);
      }
    }

    // Check if preference exists and has mandatory channels
    try {
      const existingPreference = await this.preferenceRepository.getPreference(
        userId,
        notificationType as NotificationType,
        eventType || null,
      );

      if (
        existingPreference?.mandatoryChannels &&
        existingPreference.mandatoryChannels.length > 0
      ) {
        const missingMandatoryChannels = existingPreference.mandatoryChannels.filter(
          mandatoryChannel => !channels.includes(mandatoryChannel as string),
        );

        if (missingMandatoryChannels.length > 0) {
          errors.push(
            `Cannot disable mandatory channels: ${missingMandatoryChannels.join(', ')}. These channels are required for this notification type.`,
          );
        }
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
        [NOTIFICATION_CHANNEL.IN_APP]: [],
        [NOTIFICATION_CHANNEL.PUSH]: [],
        [NOTIFICATION_CHANNEL.EMAIL]: [],
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
        [NOTIFICATION_TYPE.SYSTEM]: [],
        [NOTIFICATION_TYPE.PRODUCTION]: [],
        [NOTIFICATION_TYPE.STOCK]: [],
        [NOTIFICATION_TYPE.USER]: [],
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
      // ============================================
      // PRODUCTION NOTIFICATIONS (Tasks, Service Orders, Cuts)
      // ============================================

      // Nova Tarefa (New Task) - MANDATORY: IN_APP, PUSH, WHATSAPP
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_created',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
        ],
        mandatoryChannels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
        ],
      },

      // Mudança de Status (Status Change)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_status',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      },

      // Conclusão (Task Completed)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_completion',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      },

      // Tarefa Atrasada (Task Overdue)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_overdue',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
        ],
        mandatoryChannels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
        ],
      },

      // Prazo Alterado (Deadline Changed) - MANDATORY: IN_APP, PUSH, WHATSAPP
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_term',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
        ],
        mandatoryChannels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
        ],
      },

      // Prazo Próximo (Deadline Approaching)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_deadline',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
        ],
        mandatoryChannels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
        ],
      },

      // Detalhes Alterados (Details Changed)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_details',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },

      // Número de Série (Serial Number Changed)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_serialNumber',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },

      // Data Prevista (Forecast Date)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_forecastDate',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },

      // Setor Alterado (Sector Changed)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_sectorId',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      },

      // Atualização de Arte (Artwork Updated)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_artworks',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      },

      // Representantes (Representatives)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_representatives',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },

      // Pintura Geral (General Painting)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_paintId',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },

      // Observação (Observation)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_observation',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },

      // Comissão (Commission)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'task_commission',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },

      // Service Order Created (Nova Ordem de Serviço)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'service_order_created',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      },

      // Service Order Assigned (Atribuída a Mim)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'service_order_assigned',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
        ],
        mandatoryChannels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
        ],
      },

      // Service Order Assigned Updated (Atribuída a Mim Atualizada)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'service_order_assigned_updated',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      },

      // Service Order I Created Updated (Que Criei Atualizada)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'service_order_my_updated',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      },

      // Service Order I Created Completed (Que Criei Concluída)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'service_order_my_completed',
        channels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
        ],
        mandatoryChannels: [
          NOTIFICATION_CHANNEL.IN_APP,
          NOTIFICATION_CHANNEL.PUSH,
          NOTIFICATION_CHANNEL.WHATSAPP,
        ],
      },

      // Cut notifications (previously CUT type)
      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'cut_created',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [NOTIFICATION_CHANNEL.IN_APP],
      },

      {
        type: NOTIFICATION_TYPE.PRODUCTION,
        eventType: 'cut_status',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [NOTIFICATION_CHANNEL.IN_APP],
      },

      // ============================================
      // STOCK NOTIFICATIONS (Orders, Stock)
      // ============================================

      {
        type: NOTIFICATION_TYPE.STOCK,
        eventType: 'order_created',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.STOCK,
        eventType: 'order_status',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.STOCK,
        eventType: 'order_fulfilled',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.STOCK,
        eventType: 'order_cancelled',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.STOCK,
        eventType: 'order_overdue',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.STOCK,
        eventType: 'low',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.STOCK,
        eventType: 'out',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.STOCK,
        eventType: 'restock',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },

      // ============================================
      // USER NOTIFICATIONS (PPE, Vacation, Warning)
      // ============================================

      // PPE Notifications
      {
        type: NOTIFICATION_TYPE.USER,
        eventType: 'ppe_delivery',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.USER,
        eventType: 'ppe_expiration',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.USER,
        eventType: 'ppe_shortage',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [],
      },

      // Assinatura Solicitada (Signature Requested) - MANDATORY for employee
      {
        type: NOTIFICATION_TYPE.USER,
        eventType: 'ppe_signature_requested',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
      },

      // Assinatura Concluída (Signature Completed) - Notify admins/HR
      {
        type: NOTIFICATION_TYPE.USER,
        eventType: 'ppe_signature_completed',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },

      // Assinatura Rejeitada (Signature Rejected) - MANDATORY for admins/HR
      {
        type: NOTIFICATION_TYPE.USER,
        eventType: 'ppe_signature_rejected',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [NOTIFICATION_CHANNEL.IN_APP],
      },

      // Erro de Processamento de Assinatura (Signature Processing Failed) - MANDATORY for admins
      {
        type: NOTIFICATION_TYPE.USER,
        eventType: 'ppe_signature_failed',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [NOTIFICATION_CHANNEL.IN_APP],
      },

      // Lembrete de Assinatura Pendente (Pending Signature Reminder)
      {
        type: NOTIFICATION_TYPE.USER,
        eventType: 'ppe_signature_reminder',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [NOTIFICATION_CHANNEL.IN_APP],
      },

      // Vacation Notifications
      {
        type: NOTIFICATION_TYPE.USER,
        eventType: 'vacation_approved',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.USER,
        eventType: 'vacation_rejected',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.USER,
        eventType: 'vacation_expiring',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },

      // Warning Notifications
      {
        type: NOTIFICATION_TYPE.USER,
        eventType: 'warning_issued',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.USER,
        eventType: 'warning_escalation',
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        mandatoryChannels: [],
      },

      // ============================================
      // SYSTEM NOTIFICATIONS (OPTIONAL)
      // ============================================

      {
        type: NOTIFICATION_TYPE.SYSTEM,
        eventType: 'maintenance',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.SYSTEM,
        eventType: 'update',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },
      {
        type: NOTIFICATION_TYPE.SYSTEM,
        eventType: 'announcement',
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
      },

      // ============================================
      // GENERAL NOTIFICATIONS (OPTIONAL)
      // ============================================

      {
        type: NOTIFICATION_TYPE.GENERAL,
        eventType: null,
        channels: [NOTIFICATION_CHANNEL.IN_APP],
        mandatoryChannels: [],
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
