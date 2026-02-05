import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { NotificationPreferenceRepository } from './repositories/notification-preference/notification-preference.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  NotificationPreference,
  NotificationPreferenceIncludes,
  NotificationPreferenceOrderBy,
} from '../../../types';
import {
  NotificationPreferenceCreateFormData,
  NotificationPreferenceUpdateFormData,
} from '../../../schemas';
import { Prisma, NotificationType } from '@prisma/client';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  ALERT_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
  CHANGE_ACTION,
  ENTITY_TYPE,
  CHANGE_TRIGGERED_BY,
} from '../../../constants';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';

@Injectable()
export class NotificationPreferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationPreferenceRepository: NotificationPreferenceRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  async findMany(params: {
    where?: Prisma.NotificationPreferenceWhereInput;
    include?: NotificationPreferenceIncludes;
    orderBy?: NotificationPreferenceOrderBy | NotificationPreferenceOrderBy[];
    skip?: number;
    take?: number;
  }): Promise<NotificationPreference[]> {
    return this.notificationPreferenceRepository.findMany(params);
  }

  async findById(
    id: string,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference> {
    const notificationPreference = await this.notificationPreferenceRepository.findById(
      id,
      include,
    );

    if (!notificationPreference) {
      throw new NotFoundException('Preferência de notificação não encontrada');
    }

    return notificationPreference;
  }

  async findByPreferencesId(
    preferencesId: string,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference[]> {
    return this.notificationPreferenceRepository.findByPreferencesId(preferencesId, include);
  }

  async create(
    data: NotificationPreferenceCreateFormData,
    userId: string,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference> {
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Validate notification type
      if (!Object.values(ALERT_TYPE).includes(data.notificationType as ALERT_TYPE)) {
        throw new BadRequestException('Tipo de notificação inválido');
      }

      // Validate channels
      const validChannels = Object.values(NOTIFICATION_CHANNEL);
      const invalidChannels = data.channels.filter(channel => !validChannels.includes(channel));
      if (invalidChannels.length > 0) {
        throw new BadRequestException(`Canais inválidos: ${invalidChannels.join(', ')}`);
      }

      // Validate importance
      if (!Object.values(NOTIFICATION_IMPORTANCE).includes(data.importance)) {
        throw new BadRequestException('Importância inválida');
      }

      const createData: Prisma.NotificationPreferenceCreateInput = {
        notificationType: data.notificationType as NotificationType,
        enabled: data.enabled,
        channels: data.channels,
        importance: data.importance,
      };

      const notificationPreference =
        await this.notificationPreferenceRepository.createWithTransaction(tx, createData, include);

      // Enhanced changelog with comprehensive entity details
      const channelLabels = data.channels
        .map(channel => {
          const channelMap: Record<string, string> = {
            EMAIL: 'E-mail',
            PUSH: 'Push',
            SMS: 'SMS',
            IN_APP: 'No App',
          };
          return channelMap[channel] || channel;
        })
        .join(', ');

      const importanceLabels: Record<string, string> = {
        LOW: 'Baixa',
        NORMAL: 'Normal',
        HIGH: 'Alta',
        URGENT: 'Urgente',
      };

      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.NOTIFICATION_PREFERENCE,
        entityId: notificationPreference.id,
        action: CHANGE_ACTION.CREATE,
        entity: notificationPreference,
        reason: `Preferência de notificação criada: ${data.notificationType} - Canais: ${channelLabels} - Importância: ${importanceLabels[data.importance] || data.importance}`,
        userId: userId,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        transaction: tx,
      });

      return notificationPreference;
    });
  }

  async update(
    id: string,
    data: NotificationPreferenceUpdateFormData,
    userId: string,
    include?: NotificationPreferenceIncludes,
  ): Promise<NotificationPreference> {
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const existing = await this.findById(id);

      // Validate notification type if provided
      if (
        data.notificationType &&
        !Object.values(ALERT_TYPE).includes(data.notificationType as ALERT_TYPE)
      ) {
        throw new BadRequestException('Tipo de notificação inválido');
      }

      // Validate channels if provided
      if (data.channels) {
        const validChannels = Object.values(NOTIFICATION_CHANNEL);
        const invalidChannels = data.channels.filter(channel => !validChannels.includes(channel));
        if (invalidChannels.length > 0) {
          throw new BadRequestException(`Canais inválidos: ${invalidChannels.join(', ')}`);
        }
      }

      // Validate importance if provided
      if (data.importance && !Object.values(NOTIFICATION_IMPORTANCE).includes(data.importance)) {
        throw new BadRequestException('Importância inválida');
      }

      const updateData: Prisma.NotificationPreferenceUpdateInput = {
        ...(data.notificationType !== undefined && {
          notificationType: data.notificationType as NotificationType,
        }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
        ...(data.channels !== undefined && { channels: data.channels }),
        ...(data.importance !== undefined && { importance: data.importance }),
      };

      const updated = await this.notificationPreferenceRepository.updateWithTransaction(
        tx,
        id,
        updateData,
        include,
      );

      // Track field-level changes
      const fieldsToTrack = ['notificationType', 'enabled', 'channels', 'importance'];

      // Only track fields that were actually provided in the update
      const fieldsToActuallyTrack = fieldsToTrack.filter(field => data.hasOwnProperty(field));
      if (fieldsToActuallyTrack.length > 0) {
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.NOTIFICATION_PREFERENCE,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: fieldsToActuallyTrack,
          userId: userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });
      }

      return updated;
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const existing = await this.findById(id);

      await this.notificationPreferenceRepository.deleteWithTransaction(tx, id);

      // Enhanced deletion log with detailed reason
      const channelLabels = existing.channels
        .map(channel => {
          const channelMap: Record<string, string> = {
            EMAIL: 'E-mail',
            PUSH: 'Push',
            SMS: 'SMS',
            IN_APP: 'No App',
          };
          return channelMap[channel] || channel;
        })
        .join(', ');

      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.NOTIFICATION_PREFERENCE,
        entityId: id,
        action: CHANGE_ACTION.DELETE,
        oldEntity: existing,
        reason: `Preferência de notificação excluída: ${existing.notificationType} - Canais: ${channelLabels}`,
        userId: userId,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        transaction: tx,
      });
    });
  }

  async initializeDefaultPreferences(
    preferencesId: string,
    userId: string,
  ): Promise<NotificationPreference[]> {
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const preferences: NotificationPreference[] = [];

      for (const [alertType, settings] of Object.entries(DEFAULT_NOTIFICATION_SETTINGS)) {
        const createData: Prisma.NotificationPreferenceCreateInput = {
          notificationType: alertType as NotificationType,
          enabled: true,
          channels: settings.channels as NOTIFICATION_CHANNEL[],
          importance: settings.importance as NOTIFICATION_IMPORTANCE,
        };

        const preference = await this.notificationPreferenceRepository.createWithTransaction(
          tx,
          createData,
        );
        preferences.push(preference);

        // Log each preference creation with detailed info
        const channelLabels = (settings.channels as string[])
          .map(channel => {
            const channelMap: Record<string, string> = {
              EMAIL: 'E-mail',
              PUSH: 'Push',
              SMS: 'SMS',
              IN_APP: 'No App',
            };
            return channelMap[channel] || channel;
          })
          .join(', ');

        const importanceLabels: Record<string, string> = {
          LOW: 'Baixa',
          NORMAL: 'Normal',
          HIGH: 'Alta',
          URGENT: 'Urgente',
        };

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.NOTIFICATION_PREFERENCE,
          entityId: preference.id,
          action: CHANGE_ACTION.CREATE,
          entity: preference,
          reason: `Preferência padrão inicializada: ${alertType} - Canais: ${channelLabels} - Importância: ${importanceLabels[settings.importance as string] || settings.importance}`,
          userId: userId,
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
          transaction: tx,
        });
      }

      return preferences;
    });
  }

  async updateUserPreferences(
    preferencesId: string,
    updates: {
      notificationType: string;
      enabled?: boolean;
      channels?: NOTIFICATION_CHANNEL[];
      importance?: NOTIFICATION_IMPORTANCE;
    }[],
    userId: string,
  ): Promise<NotificationPreference[]> {
    const results: NotificationPreference[] = [];

    for (const update of updates) {
      const createData: Prisma.NotificationPreferenceCreateInput = {
        notificationType: update.notificationType as NotificationType,
        enabled: update.enabled ?? true,
        channels: update.channels ?? [],
        importance: update.importance ?? NOTIFICATION_IMPORTANCE.NORMAL,
      };

      const preference = await this.notificationPreferenceRepository.upsertByPreferencesAndType(
        preferencesId,
        update.notificationType,
        createData,
      );

      results.push(preference);
    }

    return results;
  }

  async batchCreate(
    data: NotificationPreferenceCreateFormData[],
    userId: string,
  ): Promise<{ created: number }> {
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Validate all data first
      for (const item of data) {
        if (!Object.values(ALERT_TYPE).includes(item.notificationType as ALERT_TYPE)) {
          throw new BadRequestException(`Tipo de notificação inválido: ${item.notificationType}`);
        }

        const validChannels = Object.values(NOTIFICATION_CHANNEL);
        const invalidChannels = item.channels.filter(channel => !validChannels.includes(channel));
        if (invalidChannels.length > 0) {
          throw new BadRequestException(`Canais inválidos: ${invalidChannels.join(', ')}`);
        }

        if (!Object.values(NOTIFICATION_IMPORTANCE).includes(item.importance)) {
          throw new BadRequestException(`Importância inválida: ${item.importance}`);
        }
      }

      const createData: Prisma.NotificationPreferenceCreateManyInput[] = data.map(item => ({
        notificationType: item.notificationType as NotificationType,
        enabled: item.enabled,
        channels: item.channels,
        importance: item.importance,
      }));

      const result = await this.notificationPreferenceRepository.batchCreateWithTransaction(
        tx,
        createData,
      );

      // Create individual changelog entries for each created preference
      const createdPreferences = await tx.notificationPreference.findMany({
        where: {
          notificationType: {
            in: data.map(item => item.notificationType as NotificationType),
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: result.count,
      });

      for (const preference of createdPreferences) {
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.NOTIFICATION_PREFERENCE,
          entityId: preference.id,
          action: CHANGE_ACTION.CREATE,
          entity: preference,
          reason: `Preferência de notificação criada em lote: ${preference.notificationType}`,
          userId: userId,
          triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
          transaction: tx,
        });
      }

      return { created: result.count };
    });
  }

  async batchUpdate(
    updates: { id: string; data: NotificationPreferenceUpdateFormData }[],
    userId: string,
  ): Promise<NotificationPreference[]> {
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Validate all updates first
      for (const { data } of updates) {
        if (
          data.notificationType &&
          !Object.values(ALERT_TYPE).includes(data.notificationType as ALERT_TYPE)
        ) {
          throw new BadRequestException(`Tipo de notificação inválido: ${data.notificationType}`);
        }

        if (data.channels) {
          const validChannels = Object.values(NOTIFICATION_CHANNEL);
          const invalidChannels = data.channels.filter(channel => !validChannels.includes(channel));
          if (invalidChannels.length > 0) {
            throw new BadRequestException(`Canais inválidos: ${invalidChannels.join(', ')}`);
          }
        }

        if (data.importance && !Object.values(NOTIFICATION_IMPORTANCE).includes(data.importance)) {
          throw new BadRequestException(`Importância inválida: ${data.importance}`);
        }
      }

      // Fetch existing preferences for changelog comparison
      const existingPreferences = await tx.notificationPreference.findMany({
        where: {
          id: {
            in: updates.map(u => u.id),
          },
        },
      });

      const existingMap = new Map(existingPreferences.map(p => [p.id, p]));

      const updateData = updates.map(({ id, data }) => ({
        id,
        data: {
          ...(data.notificationType !== undefined && { notificationType: data.notificationType }),
          ...(data.enabled !== undefined && { enabled: data.enabled }),
          ...(data.channels !== undefined && { channels: data.channels }),
          ...(data.importance !== undefined && { importance: data.importance }),
        } as Prisma.NotificationPreferenceUpdateInput,
      }));

      const results = await this.notificationPreferenceRepository.batchUpdateWithTransaction(
        tx,
        updateData,
      );

      // Log individual field changes for each updated preference
      for (const result of results) {
        const originalUpdate = updates.find(u => u.id === result.id);
        const existing = existingMap.get(result.id);

        if (originalUpdate && existing) {
          const fieldsToTrack = ['notificationType', 'enabled', 'channels', 'importance'];
          const fieldsToActuallyTrack = fieldsToTrack.filter(field =>
            originalUpdate.data.hasOwnProperty(field),
          );

          if (fieldsToActuallyTrack.length > 0) {
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.NOTIFICATION_PREFERENCE,
              entityId: result.id,
              oldEntity: existing,
              newEntity: result,
              fieldsToTrack: fieldsToActuallyTrack,
              userId: userId,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          }
        }
      }

      return results;
    });
  }

  async batchDelete(ids: string[], userId: string): Promise<{ deleted: number }> {
    return this.prisma.$transaction(async (tx: PrismaTransaction) => {
      // Fetch preferences before deletion for changelog
      const preferencesToDelete = await tx.notificationPreference.findMany({
        where: {
          id: {
            in: ids,
          },
        },
      });

      const result = await this.notificationPreferenceRepository.batchDeleteWithTransaction(
        tx,
        ids,
      );

      // Log each deletion
      for (const preference of preferencesToDelete) {
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.NOTIFICATION_PREFERENCE,
          entityId: preference.id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: preference,
          reason: `Preferência de notificação excluída em lote: ${preference.notificationType}`,
          userId: userId,
          triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
          transaction: tx,
        });
      }

      return { deleted: result.count };
    });
  }
}
