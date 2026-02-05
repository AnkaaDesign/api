import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseStringPrismaRepository } from '../../base/base-string-prisma.repository';
import { PrismaTransaction } from '../../base/base.repository';
import { Notification, SeenNotification } from '../../../../types';
import {
  NotificationCreateFormData,
  NotificationUpdateFormData,
  NotificationInclude,
  NotificationWhere,
  NotificationOrderBy,
  SeenNotificationCreateFormData,
  SeenNotificationUpdateFormData,
  SeenNotificationInclude,
  SeenNotificationWhere,
  SeenNotificationOrderBy,
} from '../../../../schemas';
import { NotificationRepository, SeenNotificationRepository } from './notification.repository';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
} from '../../../../constants';
import {
  Prisma,
  Notification as PrismaNotification,
  SeenNotification as PrismaSeenNotification,
  NotificationType,
  NotificationChannel,
  NotificationImportance,
  NotificationActionType,
} from '@prisma/client';
import {
  mapNotificationTypeToPrisma,
  mapNotificationChannelArrayToPrisma,
  mapNotificationImportanceToPrisma,
  mapNotificationActionTypeToPrisma,
  mapWhereClause,
} from '../../../../utils';

@Injectable()
export class NotificationPrismaRepository
  extends BaseStringPrismaRepository<
    Notification,
    NotificationCreateFormData,
    NotificationUpdateFormData,
    NotificationInclude,
    NotificationOrderBy,
    NotificationWhere,
    PrismaNotification,
    Prisma.NotificationCreateInput,
    Prisma.NotificationUpdateInput,
    Prisma.NotificationInclude,
    Prisma.NotificationOrderByWithRelationInput,
    Prisma.NotificationWhereInput
  >
  implements NotificationRepository
{
  protected readonly logger = new Logger(NotificationPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(
    databaseEntity: PrismaNotification & { user?: any; seenBy?: any[] },
  ): Notification {
    const notification: Notification = {
      id: databaseEntity.id,
      userId: databaseEntity.userId,
      title: databaseEntity.title,
      body: databaseEntity.body,
      type: databaseEntity.type as NOTIFICATION_TYPE,
      channel: databaseEntity.channel as NOTIFICATION_CHANNEL[],
      importance: databaseEntity.importance as NOTIFICATION_IMPORTANCE,
      actionType: databaseEntity.actionType,
      actionUrl: databaseEntity.actionUrl,
      scheduledAt: databaseEntity.scheduledAt,
      sentAt: databaseEntity.sentAt,
      createdAt: databaseEntity.createdAt,
      updatedAt: databaseEntity.updatedAt,
    };

    // Add computed fields
    notification.typeOrder = this.getTypeOrder(notification.type);
    notification.importanceOrder = this.getImportanceOrder(notification.importance);

    // Add relations if present
    if (databaseEntity.user) {
      notification.user = databaseEntity.user;
    }
    if (databaseEntity.seenBy) {
      notification.seenBy = databaseEntity.seenBy;
    }

    return notification;
  }

  private getTypeOrder(type: NOTIFICATION_TYPE): number {
    const typeOrderMap: Record<NOTIFICATION_TYPE, number> = {
      [NOTIFICATION_TYPE.SYSTEM]: 1,
      [NOTIFICATION_TYPE.PRODUCTION]: 2,
      [NOTIFICATION_TYPE.STOCK]: 3,
      [NOTIFICATION_TYPE.USER]: 4,
      [NOTIFICATION_TYPE.GENERAL]: 5,
    };
    return typeOrderMap[type] || 99;
  }

  private getImportanceOrder(importance: NOTIFICATION_IMPORTANCE): number {
    const importanceOrderMap: Record<NOTIFICATION_IMPORTANCE, number> = {
      [NOTIFICATION_IMPORTANCE.LOW]: 1,
      [NOTIFICATION_IMPORTANCE.NORMAL]: 2,
      [NOTIFICATION_IMPORTANCE.HIGH]: 3,
      [NOTIFICATION_IMPORTANCE.URGENT]: 4,
    };
    return importanceOrderMap[importance] || 2;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: NotificationCreateFormData,
  ): Prisma.NotificationCreateInput {
    return {
      user: formData.userId ? { connect: { id: formData.userId } } : undefined,
      title: formData.title,
      body: formData.body,
      type: mapNotificationTypeToPrisma(formData.type),
      channel: mapNotificationChannelArrayToPrisma(
        formData.channel || [NOTIFICATION_CHANNEL.IN_APP],
      ),
      importance: mapNotificationImportanceToPrisma(
        formData.importance || NOTIFICATION_IMPORTANCE.NORMAL,
      ),
      actionType: formData.actionType
        ? mapNotificationActionTypeToPrisma(formData.actionType)
        : null,
      actionUrl: formData.actionUrl || null,
      scheduledAt: formData.scheduledAt || null,
      sentAt: formData.sentAt || null,
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: NotificationUpdateFormData,
  ): Prisma.NotificationUpdateInput {
    const updateInput: Prisma.NotificationUpdateInput = {};

    if (formData.userId !== undefined) {
      updateInput.user = formData.userId
        ? { connect: { id: formData.userId } }
        : { disconnect: true };
    }
    if (formData.title !== undefined) updateInput.title = formData.title;
    if (formData.body !== undefined) updateInput.body = formData.body;
    if (formData.type !== undefined) updateInput.type = mapNotificationTypeToPrisma(formData.type);
    if (formData.channel !== undefined)
      updateInput.channel = mapNotificationChannelArrayToPrisma(formData.channel);
    if (formData.importance !== undefined)
      updateInput.importance = mapNotificationImportanceToPrisma(formData.importance);
    if (formData.actionType !== undefined)
      updateInput.actionType = formData.actionType
        ? mapNotificationActionTypeToPrisma(formData.actionType)
        : null;
    if (formData.actionUrl !== undefined) updateInput.actionUrl = formData.actionUrl;
    if (formData.scheduledAt !== undefined) updateInput.scheduledAt = formData.scheduledAt;
    if (formData.sentAt !== undefined) updateInput.sentAt = formData.sentAt;

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: NotificationInclude,
  ): Prisma.NotificationInclude | undefined {
    return include as Prisma.NotificationInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: NotificationOrderBy,
  ): Prisma.NotificationOrderByWithRelationInput | undefined {
    return orderBy as Prisma.NotificationOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: NotificationWhere,
  ): Prisma.NotificationWhereInput | undefined {
    if (!where) return undefined;
    return mapWhereClause(where) as Prisma.NotificationWhereInput;
  }

  protected getDefaultInclude(): Prisma.NotificationInclude {
    return {
      user: true,
      seenBy: true,
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: NotificationCreateFormData,
    options?: CreateOptions<NotificationInclude>,
  ): Promise<Notification> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.notification.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar notificação', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<NotificationInclude>,
  ): Promise<Notification | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.notification.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar notificação por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<NotificationInclude>,
  ): Promise<Notification[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.notification.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar notificações por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<NotificationOrderBy, NotificationWhere, NotificationInclude>,
  ): Promise<FindManyResult<Notification>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, notifications] = await Promise.all([
      transaction.notification.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.notification.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: notifications.map(notification => this.mapDatabaseEntityToEntity(notification)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: NotificationUpdateFormData,
    options?: UpdateOptions<NotificationInclude>,
  ): Promise<Notification> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.notification.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar notificação ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Notification> {
    try {
      const result = await transaction.notification.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar notificação ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: NotificationWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.notification.count({ where: whereInput });
    } catch (error) {
      this.logError('contar notificações', error, { where });
      throw error;
    }
  }
}

@Injectable()
export class SeenNotificationPrismaRepository
  extends BaseStringPrismaRepository<
    SeenNotification,
    SeenNotificationCreateFormData,
    SeenNotificationUpdateFormData,
    SeenNotificationInclude,
    SeenNotificationOrderBy,
    SeenNotificationWhere,
    PrismaSeenNotification,
    Prisma.SeenNotificationCreateInput,
    Prisma.SeenNotificationUpdateInput,
    Prisma.SeenNotificationInclude,
    Prisma.SeenNotificationOrderByWithRelationInput,
    Prisma.SeenNotificationWhereInput
  >
  implements SeenNotificationRepository
{
  protected readonly logger = new Logger(SeenNotificationPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(
    databaseEntity: PrismaSeenNotification & { user?: any; notification?: any },
  ): SeenNotification {
    const seenNotification: SeenNotification = {
      id: databaseEntity.id,
      userId: databaseEntity.userId,
      notificationId: databaseEntity.notificationId,
      seenAt: databaseEntity.seenAt,
      createdAt: databaseEntity.createdAt,
      updatedAt: databaseEntity.updatedAt,
    };

    // Add relations if present
    if (databaseEntity.user) {
      seenNotification.user = databaseEntity.user;
    }
    if (databaseEntity.notification) {
      seenNotification.notification = databaseEntity.notification;
    }

    return seenNotification;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: SeenNotificationCreateFormData,
  ): Prisma.SeenNotificationCreateInput {
    return {
      user: { connect: { id: formData.userId } },
      notification: { connect: { id: formData.notificationId } },
      seenAt: formData.seenAt || new Date(),
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: SeenNotificationUpdateFormData,
  ): Prisma.SeenNotificationUpdateInput {
    return {
      ...formData,
    };
  }

  protected mapIncludeToDatabaseInclude(
    include?: SeenNotificationInclude,
  ): Prisma.SeenNotificationInclude | undefined {
    return include as Prisma.SeenNotificationInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: SeenNotificationOrderBy,
  ): Prisma.SeenNotificationOrderByWithRelationInput | undefined {
    return orderBy as Prisma.SeenNotificationOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: SeenNotificationWhere,
  ): Prisma.SeenNotificationWhereInput | undefined {
    return where as Prisma.SeenNotificationWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.SeenNotificationInclude {
    return {
      user: true,
      notification: true,
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: SeenNotificationCreateFormData,
    options?: CreateOptions<SeenNotificationInclude>,
  ): Promise<SeenNotification> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.seenNotification.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar notificação vista', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<SeenNotificationInclude>,
  ): Promise<SeenNotification | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.seenNotification.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar notificação vista por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<SeenNotificationInclude>,
  ): Promise<SeenNotification[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.seenNotification.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar notificações vistas por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<
      SeenNotificationOrderBy,
      SeenNotificationWhere,
      SeenNotificationInclude
    >,
  ): Promise<FindManyResult<SeenNotification>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, seenNotifications] = await Promise.all([
      transaction.seenNotification.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.seenNotification.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { seenAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: seenNotifications.map(seenNotification =>
        this.mapDatabaseEntityToEntity(seenNotification),
      ),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: SeenNotificationUpdateFormData,
    options?: UpdateOptions<SeenNotificationInclude>,
  ): Promise<SeenNotification> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.seenNotification.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar notificação vista ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<SeenNotification> {
    try {
      const result = await transaction.seenNotification.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar notificação vista ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: SeenNotificationWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.seenNotification.count({ where: whereInput });
    } catch (error) {
      this.logError('contar notificações vistas', error, { where });
      throw error;
    }
  }
}
