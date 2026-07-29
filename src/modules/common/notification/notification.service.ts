import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeLogService } from '../changelog/changelog.service';
import {
  NotificationRepository,
  SeenNotificationRepository,
  PrismaTransaction,
} from './repositories/notification.repository';
import { hasValueChanged } from '../changelog/utils/serialize-changelog-value';
import { trackAndLogFieldChanges, logEntityChange } from '../changelog/utils/changelog-helpers';
import {
  Notification,
  SeenNotification,
  NotificationGetManyResponse,
  NotificationGetUniqueResponse,
  NotificationCreateResponse,
  NotificationUpdateResponse,
  NotificationDeleteResponse,
  NotificationBatchCreateResponse,
  NotificationBatchUpdateResponse,
  NotificationBatchDeleteResponse,
  SeenNotificationGetManyResponse,
  SeenNotificationGetUniqueResponse,
  SeenNotificationCreateResponse,
  SeenNotificationUpdateResponse,
  SeenNotificationDeleteResponse,
  SeenNotificationBatchCreateResponse,
  SeenNotificationBatchUpdateResponse,
  SeenNotificationBatchDeleteResponse,
} from '../../../types';
import {
  NotificationGetManyFormData,
  NotificationCreateFormData,
  NotificationUpdateFormData,
  NotificationBatchCreateFormData,
  NotificationBatchUpdateFormData,
  NotificationBatchDeleteFormData,
  NotificationInclude,
  SeenNotificationGetManyFormData,
  SeenNotificationCreateFormData,
  SeenNotificationUpdateFormData,
  SeenNotificationBatchCreateFormData,
  SeenNotificationBatchUpdateFormData,
  SeenNotificationBatchDeleteFormData,
  SeenNotificationInclude,
  UNREAD_FILTER_REQUESTER,
} from '../../../schemas';
import {
  NOTIFICATION_CHANNEL,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  NOTIFICATION_IMPORTANCE,
  CHANGE_ACTION,
  SECTOR_PRIVILEGES,
} from '../../../constants';
import { NotificationGatewayService } from './notification-gateway.service';
import { NotificationTrackingService } from './notification-tracking.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationConfigurationService } from './notification-configuration.service';
import { NotificationPreferenceService } from './notification-preference.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationRepository: NotificationRepository,
    private readonly seenNotificationRepository: SeenNotificationRepository,
    private readonly changeLogService: ChangeLogService,
    @Inject(forwardRef(() => NotificationGatewayService))
    private readonly gatewayService: NotificationGatewayService,
    private readonly trackingService: NotificationTrackingService,
    @Inject(forwardRef(() => NotificationDispatchService))
    private readonly dispatchService: NotificationDispatchService,
    private readonly configurationService: NotificationConfigurationService,
    private readonly preferenceService: NotificationPreferenceService,
  ) {}

  /**
   * SECURITY (audit B13, decision 11): notifications/seen-notifications are
   * self-scoped at the service layer; admin-wide operations require ADMIN.
   * Returns true when the actor's sector has ADMIN privileges.
   */
  private async isActorAdmin(actorUserId?: string): Promise<boolean> {
    if (!actorUserId) return false;
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { sector: { select: { privileges: true } } },
    });
    return actor?.sector?.privileges === SECTOR_PRIVILEGES.ADMIN;
  }

  /**
   * Throws ForbiddenException unless the record belongs to the actor or the actor is ADMIN.
   * No actor (internal/system call) passes. A null recordUserId (broadcast) passes.
   */
  private async enforceOwnership(
    recordUserId: string | null | undefined,
    actorUserId?: string,
  ): Promise<void> {
    if (!actorUserId) return;
    if (!recordUserId || recordUserId === actorUserId) return;
    if (await this.isActorAdmin(actorUserId)) return;
    throw new ForbiddenException('Você não tem permissão para acessar este registro.');
  }

  /**
   * Validar notificação completa
   */
  private async validateNotification(
    data: Partial<NotificationCreateFormData | NotificationUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar se o usuário existe quando userId é fornecido
    if (data.userId) {
      const user = await (transaction as any).user.findUnique({
        where: { id: data.userId },
      });

      if (!user) {
        throw new BadRequestException('Usuário não encontrado.');
      }
    }

    // Validar array de canais contém valores válidos
    if (data.channel && data.channel.length > 0) {
      const validChannels = Object.values(NOTIFICATION_CHANNEL);
      for (const channel of data.channel) {
        if (!validChannels.includes(channel as NOTIFICATION_CHANNEL)) {
          throw new BadRequestException(`Canal de notificação inválido: ${channel}`);
        }
      }
    }

    // Validar enum de importância
    if (data.importance) {
      const validImportance = Object.values(NOTIFICATION_IMPORTANCE);
      if (!validImportance.includes(data.importance as NOTIFICATION_IMPORTANCE)) {
        throw new BadRequestException(`Importância de notificação inválida: ${data.importance}`);
      }
    }

    // Garantir que título e conteúdo não estão vazios
    if (data.title !== undefined) {
      if (!data.title || data.title.trim().length === 0) {
        throw new BadRequestException('Título da notificação não pode estar vazio.');
      }

      if (data.title.length > 200) {
        throw new BadRequestException('Título da notificação deve ter no máximo 200 caracteres.');
      }
    }

    if (data.body !== undefined) {
      if (!data.body || data.body.trim().length === 0) {
        throw new BadRequestException('Conteúdo da notificação não pode estar vazio.');
      }

      if (data.body.length > 5000) {
        throw new BadRequestException(
          'Conteúdo da notificação deve ter no máximo 5000 caracteres.',
        );
      }
    }

    // Se scheduledAt é fornecido, garantir que está no futuro
    if (data.scheduledAt) {
      const scheduledDate = new Date(data.scheduledAt);
      const now = new Date();

      if (scheduledDate <= now) {
        throw new BadRequestException('Data de agendamento deve estar no futuro.');
      }
    }

    // Remove metadata validation as it doesn't exist in the schema
  }

  /**
   * Replace the `unread` convenience filter sentinel with the requesting user id.
   *
   * `notificationTransform` cannot know who is asking, so it emits
   * `seenBy: { none: { userId: UNREAD_FILTER_REQUESTER } }`. Everything that runs
   * a notification list must pass the where through here first, otherwise the
   * sentinel reaches Prisma and "unread" degrades to "not seen by a user that
   * does not exist" (i.e. everything).
   *
   * The scope user is taken from `where.userId` — every list endpoint pins it to
   * the authenticated user — with an explicit override for the specialized
   * per-user methods. When no scope can be determined the condition is dropped
   * (and logged) rather than left dangling.
   */
  private resolveUnreadFilterScope<T>(where: T, scopeUserId?: string): T {
    if (!where || typeof where !== 'object') return where;

    let sawSentinel = false;

    const walk = (node: any): any => {
      if (Array.isArray(node)) {
        return node.map(walk).filter(entry => entry !== undefined);
      }
      if (!node || typeof node !== 'object' || node instanceof Date) {
        return node;
      }

      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(node)) {
        if (key === 'seenBy' && value && typeof value === 'object') {
          const relation = value as Record<string, any>;
          const scoped: Record<string, any> = {};
          let dropped = false;

          for (const [op, condition] of Object.entries(relation)) {
            const conditionUserId = (condition as any)?.userId;
            if (conditionUserId === UNREAD_FILTER_REQUESTER) {
              sawSentinel = true;
              if (!scopeUserId) {
                dropped = true;
                continue;
              }
              scoped[op] = { ...(condition as object), userId: scopeUserId };
            } else {
              scoped[op] = condition;
            }
          }

          // Every operator was an unresolvable sentinel — drop the relation
          // filter entirely instead of emitting a where that matches nothing
          // (or, worse, everything).
          if (dropped && Object.keys(scoped).length === 0) {
            continue;
          }
          result[key] = scoped;
          continue;
        }

        result[key] = walk(value);
      }
      return result;
    };

    const resolved = walk(where);

    if (sawSentinel && !scopeUserId) {
      this.logger.warn(
        'Filtro "unread" recebido sem usuário para escopo — condição ignorada. ' +
          'Informe where.userId ou o usuário autenticado.',
      );
    }

    return resolved as T;
  }

  // =====================
  // Notification CRUD Operations
  // =====================

  async getNotifications(
    params: NotificationGetManyFormData,
  ): Promise<NotificationGetManyResponse> {
    try {
      const where = this.resolveUnreadFilterScope(
        params.where,
        typeof (params.where as any)?.userId === 'string'
          ? ((params.where as any).userId as string)
          : undefined,
      );

      const result = await this.notificationRepository.findMany({
        where,
        orderBy: params.orderBy || { createdAt: 'desc' },
        page: params.page,
        take: params.limit,
        include: params.include,
        // Client-facing list: the notification center derives `hasMore` from
        // `data.length < meta.totalRecords` and the admin table paginates by it,
        // so this endpoint opts into the real count.
        withTotal: true,
      });

      return {
        success: true,
        data: result.data,
        message: 'Notificações carregadas com sucesso.',
        meta: {
          totalRecords: result.meta.totalRecords,
          page: result.meta.page,
          take: result.meta.take,
          totalPages: result.meta.totalPages,
          hasNextPage: result.meta.hasNextPage,
          hasPreviousPage: result.meta.hasPreviousPage,
        },
      };
    } catch (error) {
      this.logger.error('Erro ao buscar notificações:', error);
      throw new InternalServerErrorException('Erro ao buscar notificações. Tente novamente.');
    }
  }

  async getNotificationById(
    id: string,
    include?: NotificationInclude,
    actorUserId?: string,
  ): Promise<NotificationGetUniqueResponse> {
    try {
      const notification = await this.notificationRepository.findById(id, { include });

      if (!notification) {
        throw new NotFoundException('Notificação não encontrada. Verifique se o ID está correto.');
      }

      // SECURITY (audit B13): only the recipient (or ADMIN) may read by id.
      await this.enforceOwnership(notification.userId, actorUserId);

      return {
        success: true,
        data: notification,
        message: 'Notificação carregada com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Erro ao buscar notificação:', error);
      throw new InternalServerErrorException('Erro ao buscar notificação. Tente novamente.');
    }
  }

  async createNotification(
    data: NotificationCreateFormData,
    include?: NotificationInclude,
    userId?: string,
  ): Promise<NotificationCreateResponse> {
    this.logger.log('Creating notification', {
      type: data.type,
      userId: data.userId,
      channels: data.channel,
      importance: data.importance,
    });

    try {
      // Check NotificationConfiguration if configKey is provided in metadata
      const configKey = (data.metadata as any)?.configKey as string | undefined;
      if (configKey) {
        const config = await this.configurationService.getConfiguration(configKey);
        if (config && !config.isEnabled) {
          this.logger.log(`Skipping notification creation: config "${configKey}" is disabled`);
          return { success: true, data: null, message: 'Configuration is disabled' } as any;
        }
      }

      // Check user preference - skip if user has disabled this notification type
      if (data.userId) {
        try {
          const preferences = await this.preferenceService.getUserPreferences(data.userId);
          const eventType = ((data.metadata as any)?.eventType as string) || null;
          const typePreference = preferences.find(
            p =>
              p.notificationType === data.type &&
              (p.eventType === eventType || p.eventType === null),
          );
          if (typePreference && !typePreference.enabled) {
            this.logger.log(
              `Skipping notification: user ${data.userId} disabled type ${data.type}/${eventType}`,
            );
            return { success: true, data: null, message: 'User preference disabled' } as any;
          }
        } catch (err) {
          this.logger.warn(`Could not check user preferences: ${err.message}`);
        }
      }

      // Never send notification to the actor who triggered the action
      const actorId = (data.metadata as any)?.actorId as string | undefined;
      if (actorId && data.userId === actorId) {
        this.logger.log(`Skipping notification: user ${data.userId} is the actor`);
        return { success: true, data: null, message: 'Actor filtered out' } as any;
      }

      const notification = await this.prisma.$transaction(async tx => {
        // Validate notification before creation
        await this.validateNotification(data, undefined, tx);

        const created = await this.notificationRepository.createWithTransaction(tx, data, {
          include,
        });

        this.logger.log('Notification created successfully', {
          notificationId: created.id,
          userId: created.userId,
          type: created.type,
          channels: created.channel,
        });

        // Log the creation with improved context
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.NOTIFICATION,
          entityId: created.id,
          action: CHANGE_ACTION.CREATE,
          entity: created,
          reason: 'Nova notificação criada',
          userId: userId || null,
          triggeredBy: userId ? CHANGE_TRIGGERED_BY.USER_ACTION : CHANGE_TRIGGERED_BY.SYSTEM,
          transaction: tx,
        });

        return created;
      });

      // Dispatch notification to all channels (EMAIL, PUSH, WHATSAPP, etc.)
      // IN_APP is handled via WebSocket in the dispatch service
      try {
        await this.dispatchService.dispatchNotification(notification.id);
      } catch (dispatchError) {
        // Log dispatch error but don't fail the notification creation
        // The notification was created successfully, dispatch can be retried
        this.logger.warn(
          `Failed to dispatch notification ${notification.id}, will retry later: ${dispatchError.message}`,
        );
      }

      return {
        success: true,
        data: notification,
        message: 'Notificação criada com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error creating notification', {
        error: error.message,
        stack: error.stack,
        type: data.type,
        userId: data.userId,
      });
      throw new InternalServerErrorException('Erro ao criar notificação. Tente novamente.');
    }
  }

  async updateNotification(
    id: string,
    data: NotificationUpdateFormData,
    include?: NotificationInclude,
    userId?: string,
  ): Promise<NotificationUpdateResponse> {
    try {
      const notification = await this.prisma.$transaction(async tx => {
        // Check if notification exists
        const existing = await this.notificationRepository.findByIdWithTransaction(tx, id);

        if (!existing) {
          throw new NotFoundException(
            'Notificação não encontrada. Verifique se o ID está correto.',
          );
        }

        // SECURITY (audit B13): ownership backstop — only the recipient or ADMIN may update.
        await this.enforceOwnership(existing.userId, userId);

        // Validate update data
        await this.validateNotification(data, id, tx);

        // Update notification
        const updated = await this.notificationRepository.updateWithTransaction(tx, id, data, {
          include,
        });

        // Track field-level changes with proper translations
        const fieldsToTrack = [
          'title',
          'body',
          'type',
          'importance',
          'actionUrl',
          'actionType',
          'sentAt',
          'scheduledAt',
          'channel',
          'userId',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.NOTIFICATION,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack,
          userId: userId || null,
          triggeredBy: userId ? CHANGE_TRIGGERED_BY.USER_ACTION : CHANGE_TRIGGERED_BY.SYSTEM,
          transaction: tx,
        });

        return updated;
      });

      // Emit real-time notification update to user via WebSocket
      if (notification.userId) {
        try {
          this.gatewayService.sendUpdateToUser(notification.userId, notification);
        } catch (error) {
          this.logger.warn(
            `Failed to send real-time notification update to user ${notification.userId}: ${error.message}`,
          );
        }
      }

      return {
        success: true,
        data: notification,
        message: 'Notificação atualizada com sucesso.',
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error('Erro ao atualizar notificação:', error);
      throw new InternalServerErrorException('Erro ao atualizar notificação. Tente novamente.');
    }
  }

  async deleteNotification(id: string, userId?: string): Promise<NotificationDeleteResponse> {
    try {
      let deletedNotificationUserId: string | null = null;

      await this.prisma.$transaction(async tx => {
        // Check if notification exists
        const existing = await this.notificationRepository.findByIdWithTransaction(tx, id);

        if (!existing) {
          throw new NotFoundException(
            'Notificação não encontrada. Verifique se o ID está correto.',
          );
        }

        // SECURITY (audit B13): ownership backstop — only the recipient or ADMIN may delete.
        await this.enforceOwnership(existing.userId, userId);

        // Store userId for real-time notification
        deletedNotificationUserId = existing.userId;

        // Delete notification
        await this.notificationRepository.deleteWithTransaction(tx, id);

        // Log the deletion with entity data
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.NOTIFICATION,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: existing,
          reason: 'Notificação excluída',
          userId: userId || null,
          triggeredBy: userId ? CHANGE_TRIGGERED_BY.USER_ACTION : CHANGE_TRIGGERED_BY.SYSTEM,
          transaction: tx,
        });
      });

      // Emit real-time notification deletion to user via WebSocket
      if (deletedNotificationUserId) {
        try {
          this.gatewayService.sendDeletionToUser(deletedNotificationUserId, id);
        } catch (error) {
          this.logger.warn(
            `Failed to send real-time notification deletion to user ${deletedNotificationUserId}: ${error.message}`,
          );
        }
      }

      return {
        success: true,
        message: 'Notificação excluída com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Erro ao excluir notificação:', error);
      throw new InternalServerErrorException('Erro ao excluir notificação. Tente novamente.');
    }
  }

  // =====================
  // Notification Batch Operations
  // =====================

  async batchCreateNotifications(
    data: NotificationBatchCreateFormData,
    include?: NotificationInclude,
    userId?: string,
  ): Promise<NotificationBatchCreateResponse<NotificationCreateFormData>> {
    try {
      // Filter out notifications that should be skipped (config disabled, user preference, actor)
      const filteredNotifications: NotificationCreateFormData[] = [];
      for (const notification of data.notifications) {
        const configKey = (notification.metadata as any)?.configKey as string | undefined;
        if (configKey) {
          const config = await this.configurationService.getConfiguration(configKey);
          if (config && !config.isEnabled) {
            this.logger.log(`Batch: skipping notification with disabled config "${configKey}"`);
            continue;
          }
        }

        if (notification.userId) {
          try {
            const preferences = await this.preferenceService.getUserPreferences(
              notification.userId,
            );
            const eventType = ((notification.metadata as any)?.eventType as string) || null;
            const typePreference = preferences.find(
              p =>
                p.notificationType === notification.type &&
                (p.eventType === eventType || p.eventType === null),
            );
            if (typePreference && !typePreference.enabled) {
              this.logger.log(
                `Batch: skipping notification for user ${notification.userId} (preference disabled)`,
              );
              continue;
            }
          } catch (err) {
            this.logger.warn(`Batch: could not check user preferences: ${err.message}`);
          }
        }

        const actorId = (notification.metadata as any)?.actorId as string | undefined;
        if (actorId && notification.userId === actorId) {
          this.logger.log(`Batch: skipping notification for actor ${notification.userId}`);
          continue;
        }

        filteredNotifications.push(notification);
      }

      if (filteredNotifications.length === 0) {
        return {
          success: true,
          data: { success: [], failed: [], totalProcessed: 0, totalSuccess: 0, totalFailed: 0 },
          message: 'All notifications were filtered out by configuration/preference checks.',
        } as any;
      }

      const result = await this.prisma.$transaction(async tx => {
        const batchResult = await this.notificationRepository.createManyWithTransaction(
          tx,
          filteredNotifications,
          { include },
        );

        // Log successful creations
        for (const notification of batchResult.success) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.NOTIFICATION,
            entityId: notification.id,
            action: CHANGE_ACTION.BATCH_CREATE,
            reason: 'Notificação criada em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            triggeredById: userId || 'system',
            userId: userId || null,
            transaction: tx,
          });
        }

        return batchResult;
      });

      // Convert BatchCreateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalCreated + result.totalFailed,
        totalSuccess: result.totalCreated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        data: batchOperationResult,
        message: `${result.totalCreated} notificações criadas com sucesso.`,
      };
    } catch (error) {
      this.logger.error('Erro ao criar notificações em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar notificações em lote. Tente novamente.',
      );
    }
  }

  async batchUpdateNotifications(
    data: NotificationBatchUpdateFormData,
    userId?: string,
    include?: NotificationInclude,
  ): Promise<NotificationBatchUpdateResponse<NotificationUpdateFormData>> {
    try {
      // SECURITY (audit B13): non-ADMIN actors may only batch-update their OWN notifications.
      if (userId && !(await this.isActorAdmin(userId))) {
        const targetIds = (data.notifications as Array<{ id: string }>).map(n => n.id);
        const targets = await this.prisma.notification.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, userId: true },
        });
        if (targets.some(n => n.userId !== userId)) {
          throw new ForbiddenException(
            'Você não tem permissão para alterar notificações de outros usuários.',
          );
        }
      }

      const result = await this.prisma.$transaction(async tx => {
        const batchResult = await this.notificationRepository.updateManyWithTransaction(
          tx,
          data.notifications as Array<{ id: string; data: NotificationUpdateFormData }>,
          { include },
        );

        // Log successful updates
        for (const notification of batchResult.success) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.NOTIFICATION,
            entityId: notification.id,
            action: CHANGE_ACTION.BATCH_UPDATE,
            reason: 'Notificação atualizada em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            triggeredById: userId || 'system',
            userId: userId || null,
            transaction: tx,
          });
        }

        return batchResult;
      });

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: {
            ...error.data,
            id: error.id || '',
          },
        })),
        totalProcessed: result.totalUpdated + result.totalFailed,
        totalSuccess: result.totalUpdated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        data: batchOperationResult,
        message: `${result.totalUpdated} notificações atualizadas com sucesso.`,
      };
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar notificações em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar notificações em lote. Tente novamente.',
      );
    }
  }

  async batchDeleteNotifications(
    data: NotificationBatchDeleteFormData,
    userId?: string,
  ): Promise<NotificationBatchDeleteResponse> {
    try {
      // SECURITY (audit B13): non-ADMIN actors may only batch-delete their OWN notifications.
      if (userId && !(await this.isActorAdmin(userId))) {
        const targets = await this.prisma.notification.findMany({
          where: { id: { in: data.notificationIds } },
          select: { id: true, userId: true },
        });
        if (targets.some(n => n.userId !== userId)) {
          throw new ForbiddenException(
            'Você não tem permissão para excluir notificações de outros usuários.',
          );
        }
      }

      const result = await this.prisma.$transaction(async tx => {
        const batchResult = await this.notificationRepository.deleteManyWithTransaction(
          tx,
          data.notificationIds,
        );

        // Log successful deletions
        for (const item of batchResult.success) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.NOTIFICATION,
            entityId: item.id,
            action: CHANGE_ACTION.BATCH_DELETE,
            reason: 'Notificação excluída em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            triggeredById: userId || 'system',
            userId: userId || null,
            transaction: tx,
          });
        }

        return batchResult;
      });

      // Convert BatchDeleteResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalDeleted + result.totalFailed,
        totalSuccess: result.totalDeleted,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        data: batchOperationResult,
        message: `${result.totalDeleted} notificações excluídas com sucesso.`,
      };
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Erro ao excluir notificações em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir notificações em lote. Tente novamente.',
      );
    }
  }

  // =====================
  // Notification Specialized Operations
  // =====================

  async getNotificationsByUser(
    userId: string,
    params: NotificationGetManyFormData = {},
  ): Promise<NotificationGetManyResponse> {
    try {
      const result = await this.notificationRepository.findMany({
        where: this.resolveUnreadFilterScope(
          {
            ...params.where,
            userId: userId,
          },
          userId,
        ),
        orderBy: params.orderBy || { createdAt: 'desc' },
        page: params.page,
        take: params.limit,
        include: params.include,
        // Client-facing list — clients page on meta.totalRecords.
        withTotal: true,
      });

      return {
        success: true,
        data: result.data,
        message: 'Notificações do usuário carregadas com sucesso.',
        meta: {
          totalRecords: result.meta.totalRecords,
          page: result.meta.page,
          take: result.meta.take,
          totalPages: result.meta.totalPages,
          hasNextPage: result.meta.hasNextPage,
          hasPreviousPage: result.meta.hasPreviousPage,
        },
      };
    } catch (error) {
      this.logger.error('Erro ao buscar notificações do usuário:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar notificações do usuário. Tente novamente.',
      );
    }
  }

  async getUnreadNotifications(
    userId: string,
    params: NotificationGetManyFormData = {},
  ): Promise<NotificationGetManyResponse> {
    try {
      const result = await this.notificationRepository.findMany({
        where: {
          // Any `unread` sentinel in params.where is resolved first; the explicit
          // `seenBy` below then wins, which is the same scoping anyway.
          ...this.resolveUnreadFilterScope(params.where, userId),
          userId: userId,
          seenBy: {
            none: {
              userId: userId,
            },
          },
        },
        orderBy: params.orderBy || { createdAt: 'desc' },
        page: params.page,
        take: params.limit,
        include: params.include,
        // Client-facing list — clients page on meta.totalRecords.
        withTotal: true,
      });

      return {
        success: true,
        data: result.data,
        message: 'Notificações não lidas carregadas com sucesso.',
        meta: {
          totalRecords: result.meta.totalRecords,
          page: result.meta.page,
          take: result.meta.take,
          totalPages: result.meta.totalPages,
          hasNextPage: result.meta.hasNextPage,
          hasPreviousPage: result.meta.hasPreviousPage,
        },
      };
    } catch (error) {
      this.logger.error('Erro ao buscar notificações não lidas:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar notificações não lidas. Tente novamente.',
      );
    }
  }

  async markAsRead(
    notificationId: string,
    userId: string,
  ): Promise<SeenNotificationCreateResponse> {
    try {
      const seenNotification = await this.prisma.$transaction(async tx => {
        // Check if notification exists
        const notification = await this.notificationRepository.findByIdWithTransaction(
          tx,
          notificationId,
        );

        if (!notification) {
          throw new NotFoundException(
            'Notificação não encontrada. Verifique se o ID está correto.',
          );
        }

        // Check if notification belongs to user or is a general notification
        if (notification.userId && notification.userId !== userId) {
          throw new BadRequestException(
            'Você não tem permissão para marcar esta notificação como lida.',
          );
        }

        // Mark as read. UPSERT (not findFirst → create) on the
        // `userId_notificationId` unique index: the read-then-write pair raced on
        // a double-click and surfaced the resulting P2002 as a generic 500.
        const seenAt = new Date();
        const seen = await (tx as any).seenNotification.upsert({
          where: {
            userId_notificationId: {
              userId: userId!,
              notificationId,
            },
          },
          create: {
            notificationId,
            userId: userId!,
            seenAt,
          },
          // Already seen — keep the original seenAt, this call is a no-op.
          update: {},
          include: { notification: true, user: true },
        });

        // `seenAt` is only written on create, so an unchanged timestamp means the
        // row already existed and this call marked nothing new. Skip the audit
        // entries in that case, matching the previous early-return behaviour.
        const isNewlySeen = seen.seenAt?.getTime() === seenAt.getTime();
        if (!isNewlySeen) {
          return seen;
        }

        // Log the action for notification with field-level tracking
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.NOTIFICATION,
          entityId: notificationId,
          action: CHANGE_ACTION.UPDATE,
          field: 'readStatus',
          oldValue: 'unread',
          newValue: 'read',
          reason: 'Notificação marcada como lida',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId,
          userId: userId,
          transaction: tx,
        });

        // Log the creation of SeenNotification with entity data
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
          entityId: seen.id,
          action: CHANGE_ACTION.CREATE,
          entity: seen,
          reason: 'Visualização de notificação criada',
          userId: userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return seen;
      });

      // Emit real-time notification about seen status via WebSocket
      try {
        this.gatewayService.notifyNotificationSeen(userId, notificationId, seenNotification.seenAt);
      } catch (error) {
        this.logger.warn(
          `Failed to send real-time notification seen update to user ${userId}: ${error.message}`,
        );
      }

      return {
        success: true,
        data: seenNotification,
        message: 'Notificação marcada como lida.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao marcar notificação como lida:', error);
      throw new InternalServerErrorException(
        'Erro ao marcar notificação como lida. Tente novamente.',
      );
    }
  }

  /**
   * Mark every unread notification of a user as read.
   *
   * Rewritten (notification plan, phase 1.1). The previous implementation ran a
   * serial per-row loop (one `create` + one ChangeLog write per notification —
   * roughly 2 round-trips per row) inside a SINGLE 60s transaction capped at
   * 1000 rows. On an accumulated inbox it blew the transaction timeout and
   * rolled back atomically: the user waited, got a 500, and NOTHING was written.
   *
   * Now: page over the unread ids with a projection-only `findMany`, write each
   * page with ONE `createMany({ skipDuplicates: true })`, and emit ONE aggregate
   * ChangeLog entry at the end. Pagination happens OUTSIDE any transaction, so a
   * huge inbox degrades into several fast statements instead of one doomed one,
   * and a partial failure leaves the already-marked pages persisted.
   *
   * `skipDuplicates` also makes the whole operation idempotent, so a concurrent
   * single mark-as-read (or a double-click on "mark all") can no longer race into
   * a P2002 on the `userId_notificationId` unique index.
   */
  async markAllAsRead(userId: string): Promise<{ count: number }> {
    // Page size for the id projection. Large enough that a normal inbox is a
    // single round-trip, small enough that one INSERT stays well inside any
    // statement timeout.
    const BATCH_SIZE = 5000;

    try {
      let markedCount = 0;

      for (;;) {
        const unreadIds = await this.prisma.notification.findMany({
          where: {
            userId,
            seenBy: {
              none: { userId },
            },
          },
          select: { id: true },
          take: BATCH_SIZE,
        });

        if (unreadIds.length === 0) {
          break;
        }

        const seenAt = new Date();
        const result = await this.prisma.seenNotification.createMany({
          data: unreadIds.map(notification => ({
            notificationId: notification.id,
            userId,
            seenAt,
          })),
          skipDuplicates: true,
        });

        markedCount += result.count;

        // Last (or only) page.
        if (unreadIds.length < BATCH_SIZE) {
          break;
        }

        // Defensive: if a full page produced zero inserts, every row was already
        // seen by someone else's concurrent write and the same page would be
        // returned forever. Stop instead of spinning.
        if (result.count === 0) {
          break;
        }
      }

      if (markedCount > 0) {
        // ONE aggregate audit entry for the whole bulk action. The previous code
        // wrote one SEEN_NOTIFICATION ChangeLog row per notification (plus this
        // one), which is what made the operation quadratic in round-trips and
        // which flooded the ChangeLog table with unqueried read-state noise.
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.NOTIFICATION,
          entityId: 'BATCH',
          action: CHANGE_ACTION.BATCH_UPDATE,
          reason: `${markedCount} notificações marcadas como lidas`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          triggeredById: userId,
          userId: userId || null,
          // NOTE: ChangeLogService.logChange builds its own metadata and ignores a
          // `metadata` param, so the count lives in `reason`; the acting user is
          // already carried by userId/triggeredById.
        });
      }

      return { count: markedCount };
    } catch (error) {
      this.logger.error('Erro ao marcar todas notificações como lidas:', error);
      throw new InternalServerErrorException(
        'Erro ao marcar todas notificações como lidas. Tente novamente.',
      );
    }
  }

  async sendNotification(
    notificationId: string,
    userId?: string,
  ): Promise<NotificationUpdateResponse> {
    try {
      // Check if notification exists
      const existing = await this.notificationRepository.findById(notificationId);

      if (!existing) {
        throw new NotFoundException('Notificação não encontrada. Verifique se o ID está correto.');
      }

      // Check if already sent
      if (existing.sentAt) {
        throw new BadRequestException('Esta notificação já foi enviada.');
      }

      // Use dispatch service to handle sending across all channels
      await this.dispatchService.dispatchNotification(notificationId);

      // Fetch updated notification
      const notification = await this.notificationRepository.findById(notificationId, {
        include: { user: true },
      });

      return {
        success: true,
        data: notification,
        message: 'Notificação enviada com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao enviar notificação:', error);
      throw new InternalServerErrorException('Erro ao enviar notificação. Tente novamente.');
    }
  }

  // =====================
  // SeenNotification CRUD Operations
  // =====================

  async getSeenNotifications(
    params: SeenNotificationGetManyFormData,
    actorUserId?: string,
  ): Promise<SeenNotificationGetManyResponse> {
    try {
      // SECURITY (audit B13): non-ADMIN actors only see their OWN seen-notification records.
      const scopedWhere =
        actorUserId && !(await this.isActorAdmin(actorUserId))
          ? { ...params.where, userId: actorUserId }
          : params.where;

      const result = await this.seenNotificationRepository.findMany({
        where: scopedWhere,
        orderBy: params.orderBy || { seenAt: 'desc' },
        page: params.page,
        take: params.limit,
        include: params.include,
      });

      return {
        success: true,
        data: result.data,
        message: 'Visualizações carregadas com sucesso.',
        meta: {
          totalRecords: result.meta.totalRecords,
          page: result.meta.page,
          take: result.meta.take,
          totalPages: result.meta.totalPages,
          hasNextPage: result.meta.hasNextPage,
          hasPreviousPage: result.meta.hasPreviousPage,
        },
      };
    } catch (error) {
      this.logger.error('Erro ao buscar visualizações:', error);
      throw new InternalServerErrorException('Erro ao buscar visualizações. Tente novamente.');
    }
  }

  async getSeenNotificationById(
    id: string,
    include?: SeenNotificationInclude,
    actorUserId?: string,
  ): Promise<SeenNotificationGetUniqueResponse> {
    try {
      const seenNotification = await this.seenNotificationRepository.findById(id, { include });

      if (!seenNotification) {
        throw new NotFoundException('Visualização não encontrada. Verifique se o ID está correto.');
      }

      // SECURITY (audit B13): only the owner (or ADMIN) may read by id.
      await this.enforceOwnership(seenNotification.userId, actorUserId);

      return {
        success: true,
        data: seenNotification,
        message: 'Visualização carregada com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Erro ao buscar visualização:', error);
      throw new InternalServerErrorException('Erro ao buscar visualização. Tente novamente.');
    }
  }

  async createSeenNotification(
    data: SeenNotificationCreateFormData,
    include?: SeenNotificationInclude,
    userId?: string,
  ): Promise<SeenNotificationCreateResponse> {
    try {
      // SECURITY (audit B13): non-ADMIN actors can only mark notifications as seen for THEMSELVES.
      if (userId && data.userId !== userId && !(await this.isActorAdmin(userId))) {
        data = { ...data, userId };
      }

      const seenNotification = await this.prisma.$transaction(async tx => {
        const created = await this.seenNotificationRepository.createWithTransaction(tx, data, {
          include,
        });

        // Log the creation
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
          entityId: created.id,
          action: CHANGE_ACTION.CREATE,
          reason: 'Visualização de notificação criada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId || 'system',
          userId: userId || null,
          transaction: tx,
        });

        return created;
      });

      return {
        success: true,
        data: seenNotification,
        message: 'Visualização criada com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao criar visualização:', error);
      throw new InternalServerErrorException('Erro ao criar visualização. Tente novamente.');
    }
  }

  async updateSeenNotification(
    id: string,
    data: SeenNotificationUpdateFormData,
    include?: SeenNotificationInclude,
    userId?: string,
  ): Promise<SeenNotificationUpdateResponse> {
    try {
      const seenNotification = await this.prisma.$transaction(async tx => {
        // Check if exists
        const existing = await this.seenNotificationRepository.findByIdWithTransaction(tx, id);
        if (!existing) {
          throw new NotFoundException(
            'Visualização não encontrada. Verifique se o ID está correto.',
          );
        }

        // SECURITY (audit B13): only the owner (or ADMIN) may update.
        await this.enforceOwnership(existing.userId, userId);

        const updated = await this.seenNotificationRepository.updateWithTransaction(tx, id, data, {
          include,
        });

        // Track field-level changes for specific fields
        const fieldsToTrack = ['seenAt', 'notificationId', 'userId'] as const;
        const changedFields = Object.keys(data) as Array<keyof SeenNotificationUpdateFormData>;

        for (const field of changedFields) {
          // Only track specific fields that are important for audit
          if (fieldsToTrack.includes(field as any)) {
            const oldValue = existing[field as keyof typeof existing];
            const newValue = updated[field as keyof typeof updated];

            // Only log if the value actually changed
            if (hasValueChanged(oldValue, newValue)) {
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
                entityId: id,
                action: CHANGE_ACTION.UPDATE,
                field,
                oldValue,
                newValue,
                reason: `Campo ${String(field)} atualizado`,
                triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                triggeredById: userId || 'system',
                userId: userId || null,
                transaction: tx,
              });
            }
          }
        }

        return updated;
      });

      return {
        success: true,
        data: seenNotification,
        message: 'Visualização atualizada com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar visualização:', error);
      throw new InternalServerErrorException('Erro ao atualizar visualização. Tente novamente.');
    }
  }

  async deleteSeenNotification(
    id: string,
    userId?: string,
  ): Promise<SeenNotificationDeleteResponse> {
    try {
      await this.prisma.$transaction(async tx => {
        // Check if exists
        const existing = await this.seenNotificationRepository.findByIdWithTransaction(tx, id);
        if (!existing) {
          throw new NotFoundException(
            'Visualização não encontrada. Verifique se o ID está correto.',
          );
        }

        // SECURITY (audit B13): only the owner (or ADMIN) may delete.
        await this.enforceOwnership(existing.userId, userId);

        await this.seenNotificationRepository.deleteWithTransaction(tx, id);

        // Log the deletion
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          reason: 'Visualização de notificação excluída',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId || 'system',
          userId: userId || null,
          transaction: tx,
        });
      });

      return {
        success: true,
        message: 'Visualização excluída com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Erro ao excluir visualização:', error);
      throw new InternalServerErrorException('Erro ao excluir visualização. Tente novamente.');
    }
  }

  // =====================
  // SeenNotification Batch Operations
  // =====================

  async batchCreateSeenNotifications(
    data: SeenNotificationBatchCreateFormData,
    include?: SeenNotificationInclude,
    userId?: string,
  ): Promise<SeenNotificationBatchCreateResponse<SeenNotificationCreateFormData>> {
    try {
      // SECURITY (audit B13): non-ADMIN actors can only mark notifications as seen for THEMSELVES.
      let seenNotifications = data.seenNotifications;
      if (userId && !(await this.isActorAdmin(userId))) {
        seenNotifications = seenNotifications.map(item =>
          item.userId === userId ? item : { ...item, userId },
        );
      }

      const result = await this.prisma.$transaction(async tx => {
        const batchResult = await this.seenNotificationRepository.createManyWithTransaction(
          tx,
          seenNotifications,
          { include },
        );

        // Log successful creations
        for (const seenNotification of batchResult.success) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
            entityId: seenNotification.id,
            action: CHANGE_ACTION.BATCH_CREATE,
            reason: 'Visualização criada em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            triggeredById: userId || 'system',
            userId: userId || null,
            transaction: tx,
          });
        }

        return batchResult;
      });

      // Convert BatchCreateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalCreated + result.totalFailed,
        totalSuccess: result.totalCreated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        data: batchOperationResult,
        message: `${result.totalCreated} visualizações criadas com sucesso.`,
      };
    } catch (error) {
      this.logger.error('Erro ao criar visualizações em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar visualizações em lote. Tente novamente.',
      );
    }
  }

  async batchUpdateSeenNotifications(
    data: SeenNotificationBatchUpdateFormData,
    userId?: string,
    include?: SeenNotificationInclude,
  ): Promise<SeenNotificationBatchUpdateResponse<SeenNotificationUpdateFormData>> {
    try {
      // SECURITY (audit B13): non-ADMIN actors may only batch-update their OWN records.
      if (userId && !(await this.isActorAdmin(userId))) {
        const targetIds = (data.seenNotifications as Array<{ id: string }>).map(s => s.id);
        const targets = await this.prisma.seenNotification.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, userId: true },
        });
        if (targets.some(s => s.userId !== userId)) {
          throw new ForbiddenException(
            'Você não tem permissão para alterar visualizações de outros usuários.',
          );
        }
      }

      const result = await this.prisma.$transaction(async tx => {
        const batchResult = await this.seenNotificationRepository.updateManyWithTransaction(
          tx,
          data.seenNotifications as Array<{ id: string; data: SeenNotificationUpdateFormData }>,
          { include },
        );

        // Log successful updates
        for (const seenNotification of batchResult.success) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
            entityId: seenNotification.id,
            action: CHANGE_ACTION.BATCH_UPDATE,
            reason: 'Visualização atualizada em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
            triggeredById: userId || 'system',
            userId: userId || null,
            transaction: tx,
          });
        }

        return batchResult;
      });

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: {
            ...error.data,
            id: error.id || '',
          },
        })),
        totalProcessed: result.totalUpdated + result.totalFailed,
        totalSuccess: result.totalUpdated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        data: batchOperationResult,
        message: `${result.totalUpdated} visualizações atualizadas com sucesso.`,
      };
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar visualizações em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar visualizações em lote. Tente novamente.',
      );
    }
  }

  async batchDeleteSeenNotifications(
    data: SeenNotificationBatchDeleteFormData,
    userId?: string,
  ): Promise<SeenNotificationBatchDeleteResponse> {
    try {
      // SECURITY (audit B13): non-ADMIN actors may only batch-delete their OWN records.
      if (userId && !(await this.isActorAdmin(userId))) {
        const targets = await this.prisma.seenNotification.findMany({
          where: { id: { in: data.seenNotificationIds } },
          select: { id: true, userId: true },
        });
        if (targets.some(s => s.userId !== userId)) {
          throw new ForbiddenException(
            'Você não tem permissão para excluir visualizações de outros usuários.',
          );
        }
      }

      const result = await this.prisma.$transaction(async tx => {
        const batchResult = await this.seenNotificationRepository.deleteManyWithTransaction(
          tx,
          data.seenNotificationIds,
        );

        // Log successful deletions
        for (const item of batchResult.success) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
            entityId: item.id,
            action: CHANGE_ACTION.BATCH_DELETE,
            reason: 'Visualização excluída em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            triggeredById: userId || 'system',
            userId: userId || null,
            transaction: tx,
          });
        }

        return batchResult;
      });

      // Convert BatchDeleteResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalDeleted + result.totalFailed,
        totalSuccess: result.totalDeleted,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        data: batchOperationResult,
        message: `${result.totalDeleted} visualizações excluídas com sucesso.`,
      };
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Erro ao excluir visualizações em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir visualizações em lote. Tente novamente.',
      );
    }
  }

  // =====================
  // SeenNotification Specialized Operations
  // =====================

  async getSeenNotificationsByUser(
    userId: string,
    params: SeenNotificationGetManyFormData = {},
  ): Promise<SeenNotificationGetManyResponse> {
    try {
      const result = await this.seenNotificationRepository.findMany({
        where: {
          ...params.where,
          userId: userId,
        },
        orderBy: params.orderBy || { seenAt: 'desc' },
        page: params.page,
        take: params.limit,
        include: params.include,
      });

      return {
        success: true,
        data: result.data,
        message: 'Visualizações do usuário carregadas com sucesso.',
        meta: {
          totalRecords: result.meta.totalRecords,
          page: result.meta.page,
          take: result.meta.take,
          totalPages: result.meta.totalPages,
          hasNextPage: result.meta.hasNextPage,
          hasPreviousPage: result.meta.hasPreviousPage,
        },
      };
    } catch (error) {
      this.logger.error('Erro ao buscar visualizações do usuário:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar visualizações do usuário. Tente novamente.',
      );
    }
  }

  async getSeenNotificationsByNotification(
    notificationId: string,
    params: SeenNotificationGetManyFormData = {},
  ): Promise<SeenNotificationGetManyResponse> {
    try {
      const result = await this.seenNotificationRepository.findMany({
        where: {
          ...params.where,
          notificationId: notificationId,
        },
        orderBy: params.orderBy || { seenAt: 'desc' },
        page: params.page,
        take: params.limit,
        include: params.include,
      });

      return {
        success: true,
        data: result.data,
        message: 'Visualizações da notificação carregadas com sucesso.',
        meta: {
          totalRecords: result.meta.totalRecords,
          page: result.meta.page,
          take: result.meta.take,
          totalPages: result.meta.totalPages,
          hasNextPage: result.meta.hasNextPage,
          hasPreviousPage: result.meta.hasPreviousPage,
        },
      };
    } catch (error) {
      this.logger.error('Erro ao buscar visualizações da notificação:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar visualizações da notificação. Tente novamente.',
      );
    }
  }

  // =====================
  // Notification Tracking Operations (Delegated to TrackingService)
  // =====================

  /**
   * Mark notification as seen by a user
   * @deprecated Use trackingService directly
   */
  async markAsSeen(notificationId: string, userId: string): Promise<void> {
    return this.trackingService.markAsSeen(notificationId, userId);
  }

  /**
   * Mark notification as delivered on a specific channel
   * @deprecated Use trackingService directly
   */
  async markAsDelivered(notificationId: string, channel: NOTIFICATION_CHANNEL): Promise<void> {
    return this.trackingService.markAsDelivered(notificationId, channel);
  }

  /**
   * Set reminder for a notification
   * @deprecated Use trackingService directly
   */
  async setReminder(notificationId: string, userId: string, remindAt: Date): Promise<void> {
    return this.trackingService.setReminder(notificationId, userId, remindAt);
  }

  /**
   * Get count of unseen notifications for a user
   * @deprecated Use trackingService directly
   */
  async getUnseenCount(userId: string): Promise<number> {
    return this.trackingService.getUnseenCount(userId);
  }

  /**
   * Get unseen notifications for a user
   * @deprecated Use trackingService directly
   */
  async getUnseenNotifications(userId: string, limit?: number): Promise<Notification[]> {
    return this.trackingService.getUnseenNotifications(userId, limit);
  }

  /**
   * Get delivery status for a notification across all channels
   * @deprecated Use trackingService directly
   */
  async getDeliveryStatus(notificationId: string): Promise<any[]> {
    return this.trackingService.getDeliveryStatus(notificationId);
  }

  /**
   * Get delivery statistics for a notification
   * @deprecated Use trackingService directly
   */
  async getDeliveryStats(notificationId: string): Promise<any> {
    return this.trackingService.getDeliveryStats(notificationId);
  }

  /**
   * Find notifications scheduled for a specific time or earlier
   * @deprecated Use trackingService directly
   */
  async findScheduledNotifications(before: Date): Promise<Notification[]> {
    return this.trackingService.findScheduledNotifications(before);
  }

  /**
   * Schedule a notification for future delivery
   */
  async scheduleNotification(
    notification: NotificationCreateFormData,
    scheduledAt: Date,
    userId?: string,
  ): Promise<NotificationCreateResponse> {
    try {
      // Validate scheduledAt is in the future
      if (scheduledAt <= new Date()) {
        throw new BadRequestException('A data de agendamento deve estar no futuro.');
      }

      return await this.createNotification(
        {
          ...notification,
          scheduledAt,
        },
        undefined,
        userId,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao agendar notificação:', error);
      throw new InternalServerErrorException('Erro ao agendar notificação. Tente novamente.');
    }
  }

  /**
   * Delete old notifications
   * @deprecated Use trackingService directly
   */
  async deleteOldNotifications(beforeDate: Date): Promise<number> {
    return this.trackingService.deleteOldNotifications(beforeDate);
  }

  /**
   * Find due reminders
   * @deprecated Use trackingService directly
   */
  async findDueReminders(): Promise<any[]> {
    return this.trackingService.findDueReminders();
  }

  /**
   * Clear a reminder
   * @deprecated Use trackingService directly
   */
  async clearReminder(reminderId: string): Promise<void> {
    return this.trackingService.clearReminder(reminderId);
  }

  /**
   * Find failed deliveries that can be retried
   * @deprecated Use trackingService directly
   */
  async findFailedDeliveries(options: { maxRetries: number }): Promise<any[]> {
    return this.trackingService.findFailedDeliveries(options);
  }

  /**
   * Get notification statistics for a user
   * @deprecated Use trackingService directly
   */
  async getUserNotificationStats(userId: string): Promise<any> {
    return this.trackingService.getUserNotificationStats(userId);
  }

  // =====================
  // Convenience Aliases for Common Operations
  // =====================

  /**
   * Alias for getNotificationsByUser - Get all notifications for a specific user
   */
  async getUserNotifications(
    userId: string,
    params: NotificationGetManyFormData = {},
  ): Promise<NotificationGetManyResponse> {
    return this.getNotificationsByUser(userId, params);
  }

  /**
   * Alias for getUnseenCount - Get count of unread notifications for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.getUnseenCount(userId);
  }
}
