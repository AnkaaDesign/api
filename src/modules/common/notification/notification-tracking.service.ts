import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeLogService } from '../changelog/changelog.service';
import {
  NotificationRepository,
  SeenNotificationRepository,
  PrismaTransaction,
} from './repositories/notification.repository';
import { NotificationDeliveryRepository } from './repositories/notification-delivery.repository';
import { NotificationGatewayService } from './notification-gateway.service';
import { Notification } from '../../../types';
import {
  NOTIFICATION_CHANNEL,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '../../../constants';

/**
 * Service responsible for tracking notification interactions
 * Handles seen status, reminders, delivery tracking, and statistics
 */
@Injectable()
export class NotificationTrackingService {
  private readonly logger = new Logger(NotificationTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationRepository: NotificationRepository,
    private readonly seenNotificationRepository: SeenNotificationRepository,
    private readonly deliveryRepository: NotificationDeliveryRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly gatewayService: NotificationGatewayService,
  ) {}

  /**
   * Mark notification as seen by a user
   * Creates SeenNotification record and emits real-time event
   */
  async markAsSeen(notificationId: string, userId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async tx => {
        // Check if notification exists
        const notification = await this.notificationRepository.findByIdWithTransaction(
          tx,
          notificationId,
        );

        if (!notification) {
          throw new NotFoundException('Notificação não encontrada.');
        }

        // Check if already marked as seen
        const existingSeen = await (tx as any).seenNotification.findFirst({
          where: {
            notificationId,
            userId,
          },
        });

        if (existingSeen) {
          return; // Already seen, no action needed
        }

        // Create SeenNotification record
        const seenNotification = await this.seenNotificationRepository.createWithTransaction(
          tx,
          {
            notificationId,
            userId,
            seenAt: new Date(),
          },
          { include: { notification: true, user: true } },
        );

        // Log the action
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
          entityId: seenNotification.id,
          action: CHANGE_ACTION.CREATE,
          reason: 'Notificação marcada como vista',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId,
          userId,
          transaction: tx,
        });
      });

      // Emit 'notification.seen' event via WebSocket
      try {
        this.gatewayService.notifyNotificationSeen(userId, notificationId, new Date());
      } catch (error) {
        this.logger.warn(
          `Failed to emit notification.seen event for user ${userId}: ${error.message}`,
        );
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao marcar notificação como vista:', error);
      throw new InternalServerErrorException(
        'Erro ao marcar notificação como vista. Tente novamente.',
      );
    }
  }

  /**
   * Mark notification as delivered on a specific channel
   * Updates NotificationDelivery record with delivery status
   */
  async markAsDelivered(notificationId: string, channel: NOTIFICATION_CHANNEL): Promise<void> {
    try {
      await this.prisma.$transaction(async tx => {
        // Check if notification exists
        const notification = await this.notificationRepository.findByIdWithTransaction(
          tx,
          notificationId,
        );

        if (!notification) {
          throw new NotFoundException('Notificação não encontrada.');
        }

        // Find or create NotificationDelivery record
        const existingDelivery = await (tx as any).notificationDelivery.findFirst({
          where: {
            notificationId,
            channel,
          },
        });

        if (existingDelivery) {
          // Update existing delivery record
          await (tx as any).notificationDelivery.update({
            where: { id: existingDelivery.id },
            data: {
              status: 'DELIVERED',
              deliveredAt: new Date(),
            },
          });
        } else {
          // Create new delivery record
          await (tx as any).notificationDelivery.create({
            data: {
              notificationId,
              channel,
              status: 'DELIVERED',
              sentAt: new Date(),
              deliveredAt: new Date(),
            },
          });
        }

        // Log the action
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.NOTIFICATION,
          entityId: notificationId,
          action: CHANGE_ACTION.UPDATE,
          field: 'deliveryStatus',
          oldValue: existingDelivery ? existingDelivery.status : null,
          newValue: 'DELIVERED',
          reason: `Notificação entregue via ${channel}`,
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
          triggeredById: 'system',
          userId: null,
          transaction: tx,
        });
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao marcar notificação como entregue:', error);
      throw new InternalServerErrorException(
        'Erro ao marcar notificação como entregue. Tente novamente.',
      );
    }
  }

  /**
   * Set reminder for a notification
   * Updates SeenNotification.remindAt field
   */
  async setReminder(notificationId: string, userId: string, remindAt: Date): Promise<void> {
    try {
      await this.prisma.$transaction(async tx => {
        // Check if notification exists
        const notification = await this.notificationRepository.findByIdWithTransaction(
          tx,
          notificationId,
        );

        if (!notification) {
          throw new NotFoundException('Notificação não encontrada.');
        }

        // Validate remindAt is in the future
        if (remindAt <= new Date()) {
          throw new BadRequestException('A data de lembrete deve estar no futuro.');
        }

        // Find or create SeenNotification record
        const existingSeen = await (tx as any).seenNotification.findFirst({
          where: {
            notificationId,
            userId,
          },
        });

        if (existingSeen) {
          // Update existing seen notification with reminder
          await (tx as any).seenNotification.update({
            where: { id: existingSeen.id },
            data: { remindAt },
          });
        } else {
          // Create new seen notification with reminder
          await (tx as any).seenNotification.create({
            data: {
              notificationId,
              userId,
              seenAt: new Date(),
              remindAt,
            },
          });
        }

        // Log the action
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
          entityId: existingSeen?.id || notificationId,
          action: CHANGE_ACTION.UPDATE,
          field: 'remindAt',
          oldValue: existingSeen?.remindAt || null,
          newValue: remindAt,
          reason: 'Lembrete de notificação definido',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId,
          userId,
          transaction: tx,
        });
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao definir lembrete de notificação:', error);
      throw new InternalServerErrorException(
        'Erro ao definir lembrete de notificação. Tente novamente.',
      );
    }
  }

  /**
   * Get count of unseen notifications for a user
   */
  async getUnseenCount(userId: string): Promise<number> {
    try {
      const count = await this.prisma.notification.count({
        where: {
          userId,
          seenBy: {
            none: {
              userId,
            },
          },
        },
      });

      return count;
    } catch (error) {
      this.logger.error('Erro ao buscar contagem de notificações não vistas:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar contagem de notificações não vistas. Tente novamente.',
      );
    }
  }

  /**
   * Get unseen notifications for a user
   */
  async getUnseenNotifications(userId: string): Promise<Notification[]> {
    try {
      const notifications = await this.prisma.notification.findMany({
        where: {
          userId,
          seenBy: {
            none: {
              userId,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          title: true,
          body: true,
          type: true,
          importance: true,
          actionUrl: true,
          actionType: true,
          channel: true,
          sentAt: true,
          scheduledAt: true,
          createdAt: true,
          updatedAt: true,
          userId: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          seenBy: true,
          deliveries: {
            select: {
              id: true,
              channel: true,
              status: true,
              sentAt: true,
              deliveredAt: true,
              failedAt: true,
            },
          },
        },
      });

      return notifications as unknown as Notification[];
    } catch (error) {
      this.logger.error('Erro ao buscar notificações não vistas:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar notificações não vistas. Tente novamente.',
      );
    }
  }

  /**
   * Get delivery status for a notification across all channels
   */
  async getDeliveryStatus(notificationId: string): Promise<any[]> {
    try {
      const deliveries = await this.deliveryRepository.findByNotification(notificationId);
      return deliveries;
    } catch (error) {
      this.logger.error('Erro ao buscar status de entrega:', error);
      throw new InternalServerErrorException('Erro ao buscar status de entrega. Tente novamente.');
    }
  }

  /**
   * Track notification delivery for a specific channel
   * Creates or updates a NotificationDelivery record with DELIVERED status
   */
  async trackDelivery(
    notificationId: string,
    channel: NOTIFICATION_CHANNEL,
    metadata?: any,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async tx => {
        // Check if notification exists
        const notification = await this.notificationRepository.findByIdWithTransaction(
          tx,
          notificationId,
        );

        if (!notification) {
          throw new NotFoundException('Notificação não encontrada.');
        }

        // Find existing delivery record
        const existingDelivery = await (tx as any).notificationDelivery.findFirst({
          where: {
            notificationId,
            channel,
          },
        });

        if (existingDelivery) {
          // Update existing delivery record
          await (tx as any).notificationDelivery.update({
            where: { id: existingDelivery.id },
            data: {
              status: 'DELIVERED',
              deliveredAt: new Date(),
              metadata: metadata || existingDelivery.metadata,
            },
          });
        } else {
          // Create new delivery record
          await (tx as any).notificationDelivery.create({
            data: {
              notificationId,
              channel,
              status: 'DELIVERED',
              sentAt: new Date(),
              deliveredAt: new Date(),
              metadata: metadata || null,
            },
          });
        }

        // Log the action
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.NOTIFICATION,
          entityId: notificationId,
          action: CHANGE_ACTION.UPDATE,
          field: 'deliveryTracking',
          oldValue: existingDelivery?.status || null,
          newValue: 'DELIVERED',
          reason: `Entrega rastreada via ${channel}`,
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
          triggeredById: 'system',
          userId: null,
          transaction: tx,
        });
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao rastrear entrega de notificação:', error);
      throw new InternalServerErrorException(
        'Erro ao rastrear entrega de notificação. Tente novamente.',
      );
    }
  }

  /**
   * Track when notification is seen/read by user
   * Updates the SeenNotification record and emits real-time event
   */
  async trackSeen(notificationId: string, userId: string): Promise<void> {
    // Reuse existing markAsSeen method
    await this.markAsSeen(notificationId, userId);
  }

  /**
   * Track "remind me later" action
   * Creates or updates SeenNotification with a reminder timestamp
   */
  async trackReminder(notificationId: string, userId: string, remindAt: Date): Promise<void> {
    // Reuse existing setReminder method
    await this.setReminder(notificationId, userId, remindAt);
  }

  /**
   * Get comprehensive delivery statistics for a notification
   * Includes total counts, per-channel stats, and seen rate
   */
  async getDeliveryStats(notificationId: string): Promise<{
    notificationId: string;
    totalChannels: number;
    totalPending: number;
    totalProcessing: number;
    totalDelivered: number;
    totalFailed: number;
    totalRetrying: number;
    totalSeen: number;
    seenRate: number;
    deliveryRate: number;
    byChannel: Record<
      string,
      {
        channel: string;
        status: string;
        sentAt: Date | null;
        deliveredAt: Date | null;
        failedAt: Date | null;
        errorMessage: string | null;
        retryCount?: number;
      }
    >;
    createdAt: Date;
    sentAt: Date | null;
  }> {
    try {
      const notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
        include: {
          deliveries: true,
          seenBy: true,
        },
      });

      if (!notification) {
        throw new NotFoundException('Notificação não encontrada.');
      }

      const stats = {
        notificationId,
        totalChannels: notification.channel.length,
        totalPending: notification.deliveries.filter(d => d.status === 'PENDING').length,
        totalProcessing: notification.deliveries.filter(d => d.status === 'PROCESSING').length,
        totalDelivered: notification.deliveries.filter(d => d.status === 'DELIVERED').length,
        totalFailed: notification.deliveries.filter(d => d.status === 'FAILED').length,
        totalRetrying: notification.deliveries.filter(d => d.status === 'RETRYING').length,
        totalSeen: notification.seenBy.length,
        seenRate: 0,
        deliveryRate: 0,
        byChannel: {} as Record<
          string,
          {
            channel: string;
            status: string;
            sentAt: Date | null;
            deliveredAt: Date | null;
            failedAt: Date | null;
            errorMessage: string | null;
            retryCount?: number;
          }
        >,
        createdAt: notification.createdAt,
        sentAt: notification.sentAt,
      };

      // Calculate delivery rate (delivered / total channels)
      if (stats.totalChannels > 0) {
        stats.deliveryRate = Number(
          ((stats.totalDelivered / stats.totalChannels) * 100).toFixed(2),
        );
      }

      // Calculate seen rate (seen / delivered)
      if (stats.totalDelivered > 0) {
        stats.seenRate = Number(((stats.totalSeen / stats.totalDelivered) * 100).toFixed(2));
      }

      // Build per-channel statistics
      for (const delivery of notification.deliveries) {
        stats.byChannel[delivery.channel] = {
          channel: delivery.channel,
          status: delivery.status,
          sentAt: delivery.sentAt,
          deliveredAt: delivery.deliveredAt,
          failedAt: delivery.failedAt,
          errorMessage: delivery.errorMessage,
          retryCount: (delivery.metadata as any)?.retryCount || 0,
        };
      }

      return stats;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar estatísticas de entrega:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar estatísticas de entrega. Tente novamente.',
      );
    }
  }

  /**
   * Calculate seen/read rate for a notification
   * Returns percentage of users who have seen the notification
   */
  async getSeenRate(notificationId: string): Promise<{
    notificationId: string;
    totalDelivered: number;
    totalSeen: number;
    seenRate: number;
    unseenCount: number;
  }> {
    try {
      const notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
        include: {
          deliveries: true,
          seenBy: true,
        },
      });

      if (!notification) {
        throw new NotFoundException('Notificação não encontrada.');
      }

      const totalDelivered = notification.deliveries.filter(d => d.status === 'DELIVERED').length;
      const totalSeen = notification.seenBy.length;
      const unseenCount = Math.max(0, totalDelivered - totalSeen);

      let seenRate = 0;
      if (totalDelivered > 0) {
        seenRate = Number(((totalSeen / totalDelivered) * 100).toFixed(2));
      }

      return {
        notificationId,
        totalDelivered,
        totalSeen,
        seenRate,
        unseenCount,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao calcular taxa de visualização:', error);
      throw new InternalServerErrorException(
        'Erro ao calcular taxa de visualização. Tente novamente.',
      );
    }
  }

  /**
   * Track delivery for a specific channel
   * Updates or creates NotificationDelivery record with custom status
   */
  async trackChannelDelivery(
    notificationId: string,
    channel: NOTIFICATION_CHANNEL,
    status: 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'RETRYING',
    errorMessage?: string,
    metadata?: any,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async tx => {
        // Check if notification exists
        const notification = await this.notificationRepository.findByIdWithTransaction(
          tx,
          notificationId,
        );

        if (!notification) {
          throw new NotFoundException('Notificação não encontrada.');
        }

        // Find existing delivery record
        const existingDelivery = await (tx as any).notificationDelivery.findFirst({
          where: {
            notificationId,
            channel,
          },
        });

        const now = new Date();
        const updateData: any = {
          status,
          metadata: metadata || null,
        };

        // Set timestamps based on status
        if (status === 'PROCESSING' && !existingDelivery?.sentAt) {
          updateData.sentAt = now;
        }

        if (status === 'DELIVERED') {
          updateData.deliveredAt = now;
          if (!existingDelivery?.sentAt) {
            updateData.sentAt = now;
          }
        }

        if (status === 'FAILED') {
          updateData.failedAt = now;
          updateData.errorMessage = errorMessage || 'Falha na entrega';
        }

        if (existingDelivery) {
          // Update existing delivery record
          await (tx as any).notificationDelivery.update({
            where: { id: existingDelivery.id },
            data: updateData,
          });
        } else {
          // Create new delivery record
          await (tx as any).notificationDelivery.create({
            data: {
              notificationId,
              channel,
              ...updateData,
            },
          });
        }

        // Log the action
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.NOTIFICATION,
          entityId: notificationId,
          action: CHANGE_ACTION.UPDATE,
          field: `delivery_${channel}`,
          oldValue: existingDelivery?.status || null,
          newValue: status,
          reason: `Status de entrega atualizado para ${channel}: ${status}`,
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
          triggeredById: 'system',
          userId: null,
          transaction: tx,
        });
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao rastrear entrega de canal:', error);
      throw new InternalServerErrorException('Erro ao rastrear entrega de canal. Tente novamente.');
    }
  }

  /**
   * Get failed delivery attempts
   * Returns all failed deliveries with optional filters
   */
  async getFailedDeliveries(options?: {
    notificationId?: string;
    channel?: NOTIFICATION_CHANNEL;
    limit?: number;
    includeRetrying?: boolean;
  }): Promise<
    Array<{
      id: string;
      notificationId: string;
      channel: string;
      status: string;
      failedAt: Date | null;
      errorMessage: string | null;
      retryCount: number;
      metadata: any;
      notification?: {
        id: string;
        title: string;
        body: string;
        userId: string | null;
      };
    }>
  > {
    try {
      const where: any = {
        status: options?.includeRetrying ? { in: ['FAILED', 'RETRYING'] } : 'FAILED',
      };

      if (options?.notificationId) {
        where.notificationId = options.notificationId;
      }

      if (options?.channel) {
        where.channel = options.channel;
      }

      const deliveries = await this.prisma.notificationDelivery.findMany({
        where,
        include: {
          notification: {
            select: {
              id: true,
              title: true,
              body: true,
              userId: true,
            },
          },
        },
        orderBy: {
          failedAt: 'desc',
        },
        take: options?.limit || 100,
      });

      return deliveries.map(d => ({
        id: d.id,
        notificationId: d.notificationId,
        channel: d.channel,
        status: d.status,
        failedAt: d.failedAt,
        errorMessage: d.errorMessage,
        retryCount: (d.metadata as any)?.retryCount || 0,
        metadata: d.metadata,
        notification: d.notification,
      }));
    } catch (error) {
      this.logger.error('Erro ao buscar entregas falhas:', error);
      throw new InternalServerErrorException('Erro ao buscar entregas falhas. Tente novamente.');
    }
  }

  /**
   * Retry a failed delivery
   * Resets the delivery status and attempts to resend
   */
  async retryFailedDelivery(
    deliveryId: string,
    maxRetries = 3,
  ): Promise<{
    success: boolean;
    message: string;
    delivery?: any;
  }> {
    try {
      const delivery = await this.prisma.notificationDelivery.findUnique({
        where: { id: deliveryId },
        include: {
          notification: true,
        },
      });

      if (!delivery) {
        throw new NotFoundException('Registro de entrega não encontrado.');
      }

      if (delivery.status !== 'FAILED' && delivery.status !== 'RETRYING') {
        throw new BadRequestException(
          'Apenas entregas falhadas ou em tentativa podem ser reenviadas.',
        );
      }

      const retryCount = (delivery.metadata as any)?.retryCount || 0;

      if (retryCount >= maxRetries) {
        return {
          success: false,
          message: `Número máximo de tentativas (${maxRetries}) atingido.`,
        };
      }

      // Update delivery status to RETRYING and increment retry count
      const updatedDelivery = await this.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'RETRYING',
          errorMessage: null,
          metadata: {
            ...((delivery.metadata as any) || {}),
            retryCount: retryCount + 1,
          },
        },
      });

      // Log the retry attempt
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.NOTIFICATION,
        entityId: delivery.notificationId,
        action: CHANGE_ACTION.UPDATE,
        field: 'deliveryRetry',
        oldValue: delivery.status,
        newValue: 'RETRYING',
        reason: `Tentativa de reenvio ${retryCount + 1}/${maxRetries} para ${delivery.channel}`,
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
        triggeredById: 'system',
        userId: null,
      });

      return {
        success: true,
        message: 'Entrega marcada para nova tentativa.',
        delivery: updatedDelivery,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao tentar reenviar entrega:', error);
      throw new InternalServerErrorException('Erro ao tentar reenviar entrega. Tente novamente.');
    }
  }

  /**
   * Find notifications scheduled for a specific time or earlier
   */
  async findScheduledNotifications(before: Date): Promise<Notification[]> {
    try {
      const notifications = await this.prisma.notification.findMany({
        where: {
          scheduledAt: { lte: before },
          sentAt: null,
        },
        select: {
          id: true,
          title: true,
          body: true,
          type: true,
          importance: true,
          actionUrl: true,
          actionType: true,
          channel: true,
          sentAt: true,
          scheduledAt: true,
          createdAt: true,
          updatedAt: true,
          userId: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          seenBy: true,
          deliveries: true,
        },
        orderBy: {
          scheduledAt: 'asc',
        },
      });

      return notifications as unknown as Notification[];
    } catch (error) {
      this.logger.error('Erro ao buscar notificações agendadas:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar notificações agendadas. Tente novamente.',
      );
    }
  }

  /**
   * Delete old notifications
   */
  async deleteOldNotifications(beforeDate: Date): Promise<number> {
    try {
      const result = await this.prisma.notification.deleteMany({
        where: {
          createdAt: {
            lt: beforeDate,
          },
          sentAt: {
            not: null,
          },
        },
      });

      this.logger.log(
        `Deleted ${result.count} old notifications from before ${beforeDate.toISOString()}`,
      );

      return result.count;
    } catch (error) {
      this.logger.error('Erro ao deletar notificações antigas:', error);
      throw new InternalServerErrorException(
        'Erro ao deletar notificações antigas. Tente novamente.',
      );
    }
  }

  /**
   * Find due reminders
   */
  async findDueReminders(): Promise<any[]> {
    try {
      const now = new Date();

      return await this.prisma.seenNotification.findMany({
        where: {
          remindAt: {
            lte: now,
            not: null,
          },
        },
        include: {
          notification: true,
          user: true,
        },
        orderBy: {
          remindAt: 'asc',
        },
      });
    } catch (error) {
      this.logger.error('Erro ao buscar lembretes pendentes:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar lembretes pendentes. Tente novamente.',
      );
    }
  }

  /**
   * Clear a reminder
   */
  async clearReminder(reminderId: string): Promise<void> {
    try {
      await this.prisma.seenNotification.update({
        where: { id: reminderId },
        data: { remindAt: null },
      });

      this.logger.log(`Cleared reminder ${reminderId}`);
    } catch (error) {
      this.logger.error(`Erro ao limpar lembrete ${reminderId}:`, error);
      throw new InternalServerErrorException('Erro ao limpar lembrete. Tente novamente.');
    }
  }

  /**
   * Find failed deliveries that can be retried
   */
  async findFailedDeliveries(options: { maxRetries: number }): Promise<any[]> {
    try {
      return await this.prisma.notificationDelivery.findMany({
        where: {
          status: 'FAILED',
        },
        include: {
          notification: true,
        },
        orderBy: {
          updatedAt: 'asc',
        },
        take: 50, // Limit to prevent overload
      });
    } catch (error) {
      this.logger.error('Erro ao buscar entregas falhas:', error);
      throw new InternalServerErrorException('Erro ao buscar entregas falhas. Tente novamente.');
    }
  }

  /**
   * Get notification statistics for a user
   */
  async getUserNotificationStats(userId: string): Promise<any> {
    try {
      const [totalReceived, totalSeen, notifications] = await Promise.all([
        this.prisma.notification.count({
          where: { userId },
        }),
        this.prisma.seenNotification.count({
          where: { userId },
        }),
        this.prisma.notification.findMany({
          where: { userId },
          include: {
            seenBy: {
              where: { userId },
            },
            deliveries: true,
          },
        }),
      ]);

      const totalUnseen = totalReceived - totalSeen;

      // Calculate stats by type
      const byType = {} as Record<string, any>;
      for (const notification of notifications) {
        if (!byType[notification.type]) {
          byType[notification.type] = {
            total: 0,
            seen: 0,
            unseen: 0,
          };
        }
        byType[notification.type].total++;
        if (notification.seenBy.length > 0) {
          byType[notification.type].seen++;
        } else {
          byType[notification.type].unseen++;
        }
      }

      // Calculate stats by channel
      const byChannel = {} as Record<string, any>;
      for (const notification of notifications) {
        for (const channel of notification.channel) {
          if (!byChannel[channel]) {
            byChannel[channel] = {
              total: 0,
              delivered: 0,
              failed: 0,
            };
          }
          byChannel[channel].total++;
          const channelDeliveries = notification.deliveries.filter(d => d.channel === channel);
          byChannel[channel].delivered += channelDeliveries.filter(
            d => d.deliveredAt !== null,
          ).length;
          byChannel[channel].failed += channelDeliveries.filter(d => d.failedAt !== null).length;
        }
      }

      return {
        totalReceived,
        totalSeen,
        totalUnseen,
        byType,
        byChannel,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar estatísticas de notificações do usuário:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar estatísticas de notificações do usuário. Tente novamente.',
      );
    }
  }
}
