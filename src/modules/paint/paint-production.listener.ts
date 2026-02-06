import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TASK_STATUS } from '../../constants/enums';

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
 * Handles notifications when paint is produced using config-based dispatch.
 *
 * Config key: paint.produced
 *
 * Notification flow:
 * 1. Paint is produced
 * 2. Find all active tasks using this paint (via paintId or logoPaints)
 * 3. Get unique sectors from those tasks
 * 4. Get active users in those sectors
 * 5. For each user, build personalized notification (tasks in their sector)
 * 6. Dispatch via dispatchByConfigurationToUsers (checks config enablement + user preferences)
 *
 * Custom targeting: Users in sectors of tasks using the paint (NOT the static sector
 * list from the config). Per-user personalization with different task names per user.
 *
 * Message: "Tinta {paintName} que é utilizada na tarefa {taskName} foi produzida"
 */
@Injectable()
export class PaintProductionListener {
  private readonly logger = new Logger(PaintProductionListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly dispatchService: NotificationDispatchService,
    private readonly deepLinkService: DeepLinkService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.log('========================================');
    this.logger.log('[PAINT LISTENER] Initializing Paint Production Listener');
    this.logger.log('[PAINT LISTENER] Registering event handlers...');

    this.eventEmitter.on('paint.produced', this.handlePaintProduced.bind(this));
    this.logger.log('[PAINT LISTENER] Registered: paint.produced');

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

      // Get unique sector IDs from tasks
      const sectorIds = [...new Set(tasksUsingPaint.map((t) => t.sectorId).filter(Boolean))];

      // Get active users in those sectors (dispatch service will also exclude the triggering user)
      const usersInSectors = await this.prisma.user.findMany({
        where: {
          isActive: true,
          sectorId: {
            in: sectorIds as string[],
          },
        },
        select: {
          id: true,
          sectorId: true,
        },
      });

      this.logger.log(`[PAINT EVENT] Found ${usersInSectors.length} users in relevant sectors`);

      if (usersInSectors.length === 0) {
        this.logger.log('[PAINT EVENT] No users in relevant sectors, skipping notifications');
        return;
      }

      // For each user, build personalized notification based on their sector's tasks
      for (const user of usersInSectors) {
        const userTasks = tasksUsingPaint.filter((t) => t.sectorId === user.sectorId);

        if (userTasks.length === 0) {
          continue;
        }

        const taskNames = userTasks.map((t) => t.name || `#${t.serialNumber}`).slice(0, 3);
        const taskList = taskNames.join(', ');
        const firstTask = userTasks[0];
        const deepLinks = this.deepLinkService.generateTaskLinks(firstTask.id);

        await this.dispatchService.dispatchByConfigurationToUsers(
          'paint.produced',
          event.producedBy.id,
          {
            entityType: 'Task',
            entityId: firstTask.id,
            action: 'paint_produced',
            data: {
              paintName: event.paintName,
              taskName: taskList,
              taskNames: userTasks.map((t) => t.name || `#${t.serialNumber}`),
              volumeLiters: event.volumeLiters,
              producedByName: event.producedBy.name,
            },
            metadata: {
              paintId: event.paintId,
              paintProductionId: event.paintProductionId,
              taskIds: userTasks.map((t) => t.id),
            },
            overrides: {
              actionUrl: JSON.stringify(deepLinks),
              webUrl: `/producao/cronograma/detalhes/${firstTask.id}`,
              relatedEntityType: 'PAINT_PRODUCTION',
              title: 'Tinta Produzida',
              body:
                userTasks.length === 1
                  ? `Tinta "${event.paintName}" que é utilizada na tarefa "${taskList}" foi produzida.`
                  : `Tinta "${event.paintName}" que é utilizada nas tarefas ${taskList}${userTasks.length > 3 ? ` e mais ${userTasks.length - 3} tarefa(s)` : ''} foi produzida.`,
            },
          },
          [user.id],
        );
      }

      this.logger.log('========================================');
      this.logger.log('[PAINT EVENT] Paint produced notification dispatch completed');
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[PAINT EVENT] Error handling paint produced event:', error);
    }
  }
}
