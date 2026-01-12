import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationPreferenceRepository } from './notification-preference.repository';
import { UserNotificationPreference } from '../../../../types';
import { NotificationType, NotificationChannel } from '@prisma/client';
import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL } from '../../../../constants';

@Injectable()
export class NotificationPreferencePrismaRepository implements NotificationPreferenceRepository {
  private readonly logger = new Logger(NotificationPreferencePrismaRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async getUserPreferences(userId: string): Promise<UserNotificationPreference[]> {
    try {
      const preferences = await this.prisma.userNotificationPreference.findMany({
        where: { userId },
        include: { user: true },
        orderBy: [{ notificationType: 'asc' }, { eventType: 'asc' }],
      });

      return preferences.map(pref => this.mapToEntity(pref));
    } catch (error) {
      this.logger.error(`Failed to get user preferences for user ${userId}`, error);
      throw error;
    }
  }

  async getPreference(
    userId: string,
    type: NotificationType,
    eventType?: string,
  ): Promise<UserNotificationPreference | null> {
    try {
      const preference = await this.prisma.userNotificationPreference.findUnique({
        where: {
          userId_notificationType_eventType: {
            userId,
            notificationType: type,
            eventType: eventType || null,
          },
        },
        include: { user: true },
      });

      return preference ? this.mapToEntity(preference) : null;
    } catch (error) {
      this.logger.error(
        `Failed to get preference for user ${userId}, type ${type}, event ${eventType}`,
        error,
      );
      throw error;
    }
  }

  async createPreference(
    userId: string,
    type: NotificationType,
    eventType: string | null,
    channels: NotificationChannel[],
    isMandatory: boolean,
  ): Promise<UserNotificationPreference> {
    try {
      const preference = await this.prisma.userNotificationPreference.create({
        data: {
          userId,
          notificationType: type,
          eventType,
          channels,
          isMandatory,
          enabled: true,
        },
        include: { user: true },
      });

      return this.mapToEntity(preference);
    } catch (error) {
      this.logger.error(
        `Failed to create preference for user ${userId}, type ${type}, event ${eventType}`,
        error,
      );
      throw error;
    }
  }

  async updatePreference(
    userId: string,
    type: NotificationType,
    eventType: string | null,
    channels: NotificationChannel[],
    enabled: boolean,
  ): Promise<UserNotificationPreference> {
    try {
      const preference = await this.prisma.userNotificationPreference.update({
        where: {
          userId_notificationType_eventType: {
            userId,
            notificationType: type,
            eventType,
          },
        },
        data: {
          channels,
          enabled,
        },
        include: { user: true },
      });

      return this.mapToEntity(preference);
    } catch (error) {
      this.logger.error(
        `Failed to update preference for user ${userId}, type ${type}, event ${eventType}`,
        error,
      );
      throw error;
    }
  }

  async deleteUserPreferences(userId: string): Promise<void> {
    try {
      await this.prisma.userNotificationPreference.deleteMany({
        where: { userId },
      });
    } catch (error) {
      this.logger.error(`Failed to delete preferences for user ${userId}`, error);
      throw error;
    }
  }

  async batchCreatePreferences(
    preferences: Array<{
      userId: string;
      type: NotificationType;
      eventType: string | null;
      channels: NotificationChannel[];
      mandatoryChannels: NotificationChannel[];
    }>,
  ): Promise<UserNotificationPreference[]> {
    try {
      const results = await Promise.all(
        preferences.map(pref =>
          this.prisma.userNotificationPreference.create({
            data: {
              userId: pref.userId,
              notificationType: pref.type,
              eventType: pref.eventType,
              channels: pref.channels,
              mandatoryChannels: pref.mandatoryChannels,
              enabled: true,
            },
            include: { user: true },
          }),
        ),
      );

      return results.map(pref => this.mapToEntity(pref));
    } catch (error) {
      this.logger.error('Failed to batch create preferences', error);
      throw error;
    }
  }

  async preferenceExists(
    userId: string,
    type: NotificationType,
    eventType?: string,
  ): Promise<boolean> {
    try {
      const count = await this.prisma.userNotificationPreference.count({
        where: {
          userId,
          notificationType: type,
          eventType: eventType || null,
        },
      });

      return count > 0;
    } catch (error) {
      this.logger.error(
        `Failed to check if preference exists for user ${userId}, type ${type}, event ${eventType}`,
        error,
      );
      throw error;
    }
  }

  async getChannelsForEvent(
    userId: string,
    type: NotificationType,
    eventType?: string,
  ): Promise<NotificationChannel[]> {
    try {
      const preference = await this.prisma.userNotificationPreference.findUnique({
        where: {
          userId_notificationType_eventType: {
            userId,
            notificationType: type,
            eventType: eventType || null,
          },
        },
      });

      if (!preference || !preference.enabled) {
        return [];
      }

      return preference.channels;
    } catch (error) {
      this.logger.error(
        `Failed to get channels for user ${userId}, type ${type}, event ${eventType}`,
        error,
      );
      throw error;
    }
  }

  private mapToEntity(prismaEntity: any): UserNotificationPreference {
    return {
      id: prismaEntity.id,
      userId: prismaEntity.userId,
      notificationType: prismaEntity.notificationType as NOTIFICATION_TYPE,
      eventType: prismaEntity.eventType,
      enabled: prismaEntity.enabled,
      channels: prismaEntity.channels.map((ch: string) => ch as NOTIFICATION_CHANNEL),
      isMandatory: prismaEntity.isMandatory,
      mandatoryChannels: (prismaEntity.mandatoryChannels || []).map((ch: string) => ch as NOTIFICATION_CHANNEL),
      createdAt: prismaEntity.createdAt,
      updatedAt: prismaEntity.updatedAt,
      user: prismaEntity.user,
    };
  }
}
