import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationService } from '@modules/common/notification/notification.service';
import { NotificationPreferenceService } from '@modules/common/notification/notification-preference.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_CHANNEL,
  TASK_STATUS,
} from '../../constants/enums';

/**
 * Event emitted when paint is produced
 */
export interface PaintProducedEvent {
  paintProductionId: string;
  formulaId: string;
  paintId: string;
  paintName: string;
  volumeLiters: number;
  producedBy: {
    id: string;
    name: string;
  };
}

/**
 * Paint Production Listener
 * Handles notifications when paint is produced
 *
 * Notification flow:
 * 1. Paint is produced
 * 2. Find all active tasks using this paint (via paintId or logoPaints)
 * 3. Notify users in those task's sectors
 *
 * Message: "Tinta {paintName} que é utilizada na tarefa {taskName} foi produzida"
 */
@Injectable()
export class PaintProductionListener {
  private readonly logger = new Logger(PaintProductionListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly notificationService: NotificationService,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly deepLinkService: DeepLinkService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.log('========================================');
    this.logger.log('[PAINT LISTENER] Initializing Paint Production Listener');
    this.logger.log('[PAINT LISTENER] Registering event handlers...');

    this.eventEmitter.on('paint.produced', this.handlePaintProduced.bind(this));
    this.logger.log('[PAINT LISTENER] ✅ Registered: paint.produced');

    this.logger.log('[PAINT LISTENER] All event handlers registered successfully');
    this.logger.log('========================================');
  }

  /**
   * Handle paint produced event
   * Notify users in sectors with tasks that use this paint
   */
  private async handlePaintProduced(event: PaintProducedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[PAINT EVENT] Paint produced event received');
    this.logger.log(`[PAINT EVENT] Paint ID: ${event.paintId}`);
    this.logger.log(`[PAINT EVENT] Paint Name: ${event.paintName}`);
    this.logger.log(`[PAINT EVENT] Volume: ${event.volumeLiters}L`);
    this.logger.log(`[PAINT EVENT] Produced By: ${event.producedBy.name} (${event.producedBy.id})`);
    this.logger.log('========================================');

    try {
      // Find all active tasks using this paint (either as general paint or logo paint)
      const tasksUsingPaint = await this.prisma.task.findMany({
        where: {
          OR: [
            { paintId: event.paintId },
            {
              logoPaints: {
                some: {
                  id: event.paintId,
                },
              },
            },
          ],
          status: {
            notIn: [TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED],
          },
        },
        include: {
          sector: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      this.logger.log(`[PAINT EVENT] Found ${tasksUsingPaint.length} active tasks using this paint`);

      if (tasksUsingPaint.length === 0) {
        this.logger.log('[PAINT EVENT] No active tasks using this paint, skipping notifications');
        return;
      }

      // Get unique sector IDs
      const sectorIds = [...new Set(tasksUsingPaint.map((t) => t.sectorId).filter(Boolean))];

      // Get users in these sectors
      const usersInSectors = await this.prisma.user.findMany({
        where: {
          isActive: true,
          sectorId: {
            in: sectorIds as string[],
          },
          id: {
            not: event.producedBy.id, // Exclude the user who produced the paint
          },
        },
        select: {
          id: true,
          name: true,
          sectorId: true,
        },
      });

      this.logger.log(`[PAINT EVENT] Found ${usersInSectors.length} users in relevant sectors`);

      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      // Create notifications for each user
      for (const user of usersInSectors) {
        try {
          // Find tasks in user's sector that use this paint
          const userTasks = tasksUsingPaint.filter((t) => t.sectorId === user.sectorId);

          if (userTasks.length === 0) {
            continue;
          }

          // Get user's notification preferences
          const channels = await this.getEnabledChannelsForUser(
            user.id,
            NOTIFICATION_TYPE.PRODUCTION,
            'paint.produced',
          );

          if (channels.length === 0) {
            notificationsSkipped++;
            continue;
          }

          // Build notification message
          const taskNames = userTasks.map((t) => t.name || `#${t.serialNumber}`).slice(0, 3);
          const taskList = taskNames.join(', ');
          const moreTasksText =
            userTasks.length > 3 ? ` e mais ${userTasks.length - 3} tarefa(s)` : '';

          // Use first task for deep link
          const firstTask = userTasks[0];
          const deepLinks = this.deepLinkService.generateTaskLinks(firstTask.id);

          await this.notificationService.createNotification({
            userId: user.id,
            type: NOTIFICATION_TYPE.PRODUCTION,
            importance: NOTIFICATION_IMPORTANCE.NORMAL,
            title: 'Tinta Produzida',
            body:
              userTasks.length === 1
                ? `Tinta "${event.paintName}" que é utilizada na tarefa "${taskList}" foi produzida.`
                : `Tinta "${event.paintName}" que é utilizada nas tarefas ${taskList}${moreTasksText} foi produzida.`,
            actionUrl: deepLinks.webPath,
            relatedEntityId: event.paintProductionId,
            relatedEntityType: 'PAINT_PRODUCTION',
            metadata: {
              webUrl: deepLinks.web,
              mobileUrl: deepLinks.mobile,
              universalLink: deepLinks.universalLink,
              entityType: 'Task',
              entityId: firstTask.id,
              paintId: event.paintId,
              paintName: event.paintName,
              volumeLiters: event.volumeLiters,
              producedById: event.producedBy.id,
              producedByName: event.producedBy.name,
              taskIds: userTasks.map((t) => t.id),
              taskNames: userTasks.map((t) => t.name || `#${t.serialNumber}`),
            },
            channel: channels,
          });
          notificationsCreated++;
        } catch (error) {
          this.logger.error(
            `[PAINT EVENT] Error creating notification for user ${user.id}:`,
            error,
          );
        }
      }

      this.logger.log('========================================');
      this.logger.log('[PAINT EVENT] Paint produced notification summary:');
      this.logger.log(`[PAINT EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[PAINT EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[PAINT EVENT] ❌ Error handling paint produced event:', error);
    }
  }

  /**
   * Get enabled channels for a user based on their preferences
   */
  private async getEnabledChannelsForUser(
    userId: string,
    notificationType: NOTIFICATION_TYPE,
    eventType: string,
  ): Promise<NOTIFICATION_CHANNEL[]> {
    try {
      const channels = await this.preferenceService.getChannelsForEvent(
        userId,
        notificationType,
        eventType,
      );

      if (channels.length > 0) {
        return channels;
      }

      // Default channels for paint production notifications
      return [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH];
    } catch (error) {
      this.logger.warn(`Error getting channels for user ${userId}, using defaults:`, error);
      return [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH];
    }
  }
}
