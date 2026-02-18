import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  TaskCreatedEvent,
  TaskStatusChangedEvent,
  TaskFieldUpdatedEvent,
  TaskFieldChangedEvent,
  TaskDeadlineApproachingEvent,
  TaskOverdueEvent,
} from './task.events';
import {
  TaskForecastApproachingEvent,
  TaskForecastOverdueEvent,
} from './task-notification.scheduler';
import { TASK_STATUS } from '../../../constants/enums';

/**
 * Maps deadline thresholds to specific configuration keys.
 * Hour-based thresholds (< 24h) and day-based thresholds.
 */
function getDeadlineConfigKey(daysRemaining: number, hoursRemaining?: number): string | null {
  // Hour-based thresholds
  if (hoursRemaining !== undefined && hoursRemaining <= 1) return 'task.deadline_1hour';
  if (hoursRemaining !== undefined && hoursRemaining <= 4) return 'task.deadline_4hours';

  // Day-based thresholds
  if (daysRemaining <= 1) return 'task.deadline_1day';
  if (daysRemaining <= 3) return 'task.deadline_3days';
  if (daysRemaining <= 7) return 'task.deadline_7days';

  return null;
}

/**
 * Maps forecast thresholds to specific configuration keys.
 */
function getForecastConfigKey(daysRemaining: number): string | null {
  if (daysRemaining === 0) return 'task.forecast_today';
  if (daysRemaining <= 1) return 'task.forecast_1day';
  if (daysRemaining <= 3) return 'task.forecast_3days';
  if (daysRemaining <= 7) return 'task.forecast_7days';
  if (daysRemaining <= 10) return 'task.forecast_10days';

  return null;
}

/**
 * Maps task status to specific notification configuration keys.
 */
const STATUS_CONFIG_MAP: Partial<Record<TASK_STATUS, string>> = {
  [TASK_STATUS.WAITING_PRODUCTION]: 'task.waiting_production',
  [TASK_STATUS.IN_PRODUCTION]: 'task.in_production',
  [TASK_STATUS.COMPLETED]: 'task.completed',
};

/**
 * Task Event Listener
 * Handles all task-related events and creates appropriate notifications
 * using configuration-based dispatch for role-based targeting and multi-channel delivery
 */
@Injectable()
export class TaskListener {
  private readonly logger = new Logger(TaskListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly dispatchService: NotificationDispatchService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.log('========================================');
    this.logger.log('[TASK LISTENER] Initializing Task Event Listener');
    this.logger.log('[TASK LISTENER] Registering event handlers...');

    // Register event listeners
    this.eventEmitter.on('task.created', this.handleTaskCreated.bind(this));
    this.logger.log('[TASK LISTENER] ✅ Registered: task.created');

    this.eventEmitter.on('task.status.changed', this.handleTaskStatusChanged.bind(this));
    this.logger.log('[TASK LISTENER] ✅ Registered: task.status.changed');

    this.eventEmitter.on('task.field.updated', this.handleTaskFieldUpdated.bind(this));
    this.logger.log('[TASK LISTENER] ✅ Registered: task.field.updated');

    this.eventEmitter.on('task.field.changed', this.handleTaskFieldChanged.bind(this));
    this.logger.log('[TASK LISTENER] ✅ Registered: task.field.changed');

    this.eventEmitter.on(
      'task.deadline.approaching',
      this.handleTaskDeadlineApproaching.bind(this),
    );
    this.logger.log('[TASK LISTENER] ✅ Registered: task.deadline.approaching');

    this.eventEmitter.on('task.overdue', this.handleTaskOverdue.bind(this));
    this.logger.log('[TASK LISTENER] ✅ Registered: task.overdue');

    this.eventEmitter.on(
      'task.forecast.approaching',
      this.handleTaskForecastApproaching.bind(this),
    );
    this.logger.log('[TASK LISTENER] ✅ Registered: task.forecast.approaching');

    this.eventEmitter.on(
      'task.forecast.overdue',
      this.handleTaskForecastOverdue.bind(this),
    );
    this.logger.log('[TASK LISTENER] ✅ Registered: task.forecast.overdue');

    this.logger.log('[TASK LISTENER] All event handlers registered successfully');
    this.logger.log('========================================');
  }

  /**
   * Handle task creation event
   * Uses configuration-based dispatch for role-based targeting
   */
  private async handleTaskCreated(event: TaskCreatedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[TASK EVENT] Task created event received');
    this.logger.log(`[TASK EVENT] Task ID: ${event.task.id}`);
    this.logger.log(`[TASK EVENT] Task Name: ${event.task.name}`);
    this.logger.log(`[TASK EVENT] Serial Number: ${event.task.serialNumber || 'N/A'}`);
    this.logger.log(`[TASK EVENT] Created By: ${event.createdBy.name} (${event.createdBy.id})`);
    this.logger.log('========================================');

    try {
      await this.dispatchService.dispatchByConfiguration(
        'task.created',
        event.createdBy.id,
        {
          entityType: 'Task',
          entityId: event.task.id,
          action: 'created',
          data: {
            taskId: event.task.id,
            taskName: event.task.name,
            serialNumber: event.task.serialNumber,
            changedBy: event.createdBy?.name || 'Sistema',
          },
        },
      );

      this.logger.log('[TASK EVENT] Task creation notification dispatched via configuration');
    } catch (error) {
      this.logger.error('========================================');
      this.logger.error('[TASK EVENT] Error handling task created event');
      this.logger.error('[TASK EVENT] Error:', error.message);
      this.logger.error('[TASK EVENT] Stack:', error.stack);
      this.logger.error('========================================');
    }
  }

  /**
   * Handle task status change event
   * Dispatches both generic 'task.field.status' and status-specific notifications
   * (e.g., task.waiting_production, task.in_production, task.completed)
   */
  private async handleTaskStatusChanged(event: TaskStatusChangedEvent): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[TASK EVENT] Task status changed event received');
    this.logger.log(`[TASK EVENT] Task ID: ${event.task.id}`);
    this.logger.log(`[TASK EVENT] Task Name: ${event.task.name}`);
    this.logger.log(`[TASK EVENT] Old Status: ${event.oldStatus}`);
    this.logger.log(`[TASK EVENT] New Status: ${event.newStatus}`);
    this.logger.log(`[TASK EVENT] Changed By: ${event.changedBy.name} (${event.changedBy.id})`);
    this.logger.log('========================================');

    try {
      const notificationContext = {
        entityType: 'Task',
        entityId: event.task.id,
        action: 'field_updated',
        data: {
          taskId: event.task.id,
          taskName: event.task.name,
          serialNumber: event.task.serialNumber,
          fieldName: 'status',
          oldValue: event.oldStatus,
          newValue: event.newStatus,
          changedBy: event.changedBy?.name || 'Sistema',
        },
      };

      // 1. Generic field-level status change notification
      await this.dispatchService.dispatchByConfiguration(
        'task.field.status',
        event.changedBy.id,
        notificationContext,
      );
      this.logger.log('[TASK EVENT] Generic task.field.status notification dispatched');

      // 2. Status-specific notification (e.g., task.waiting_production, task.in_production, task.completed)
      const statusConfigKey = STATUS_CONFIG_MAP[event.newStatus as TASK_STATUS];
      if (statusConfigKey) {
        await this.dispatchService.dispatchByConfiguration(
          statusConfigKey,
          event.changedBy.id,
          {
            ...notificationContext,
            action: event.newStatus.toLowerCase(),
          },
        );
        this.logger.log(`[TASK EVENT] Status-specific notification dispatched: ${statusConfigKey}`);
      }

      // 3. Special case: When status changes TO WAITING_PRODUCTION, also notify PRODUCTION users
      if (event.newStatus === TASK_STATUS.WAITING_PRODUCTION) {
        this.logger.log(
          '[TASK EVENT] Status changed to WAITING_PRODUCTION - notifying production users...',
        );
        await this.notifyProductionUsersTaskReady(event.task, event.changedBy);
      }
    } catch (error) {
      this.logger.error('========================================');
      this.logger.error('[TASK EVENT] Error handling task status changed event');
      this.logger.error('[TASK EVENT] Error:', error.message);
      this.logger.error('[TASK EVENT] Stack:', error.stack);
      this.logger.error('========================================');
    }
  }

  /**
   * Handle task field update event
   * Uses configuration-based dispatch for role-based targeting
   */
  private async handleTaskFieldUpdated(event: TaskFieldUpdatedEvent): Promise<void> {
    try {
      this.logger.log(`Task field updated: ${event.task.id} - ${event.fieldName} changed`);

      await this.dispatchService.dispatchByConfiguration(
        `task.field.${event.fieldName}`,
        event.updatedBy.id,
        {
          entityType: 'Task',
          entityId: event.task.id,
          action: 'field_updated',
          data: {
            taskId: event.task.id,
            taskName: event.task.name,
            serialNumber: event.task.serialNumber,
            fieldName: event.fieldName,
            oldValue: event.oldValue,
            newValue: event.newValue,
            changedBy: event.updatedBy?.name || 'Sistema',
          },
        },
      );

      this.logger.log(`Field update notification dispatched for: ${event.fieldName}`);
    } catch (error) {
      this.logger.error('Error handling task field updated event:', error);
    }
  }

  /**
   * Handle task field changed event from field tracker
   * Uses configuration-based dispatch for role-based targeting
   */
  private async handleTaskFieldChanged(event: TaskFieldChangedEvent): Promise<void> {
    try {
      this.logger.log(
        `Task field changed: ${event.task.id} - ${event.field} (isFileArray: ${event.isFileArray})`,
      );

      // Get the user who made the change
      const changedByUser = await this.prisma.user.findUnique({
        where: { id: event.changedBy },
        select: { name: true },
      });

      const changedByName = changedByUser?.name || 'Sistema';

      // Calculate counts and formatted description for file arrays
      let count: number | undefined;
      let addedCount: number | undefined;
      let removedCount: number | undefined;
      let fileChangeDescription: string | undefined;

      if (event.isFileArray && event.fileChange) {
        const { added, removed } = event.fileChange;
        addedCount = added;
        removedCount = removed;
        count = added > 0 ? added : removed; // Total count for backwards compatibility

        // Build formatted description in Portuguese with proper grammar
        fileChangeDescription = this.formatFileChangeDescription(added, removed);
      }

      await this.dispatchService.dispatchByConfiguration(
        `task.field.${event.field}`,
        event.changedBy,
        {
          entityType: 'Task',
          entityId: event.task.id,
          action: 'field_changed',
          data: {
            taskId: event.task.id,
            taskName: event.task.name,
            serialNumber: event.task.serialNumber,
            fieldName: event.field,
            oldValue: event.oldValue,
            newValue: event.newValue,
            changedBy: changedByName,
            count,
            addedCount,
            removedCount,
            fileChangeDescription,
          },
        },
      );

      this.logger.log(`Field change notification dispatched for: ${event.field}`);
    } catch (error) {
      this.logger.error('Error handling task field changed event:', error);
    }
  }

  /**
   * Format file change description with proper Portuguese grammar
   * Handles singular/plural forms for added and removed files
   */
  private formatFileChangeDescription(added: number, removed: number): string {
    const parts: string[] = [];

    if (added > 0) {
      if (added === 1) {
        parts.push('1 arte adicionada');
      } else {
        parts.push(`${added} artes adicionadas`);
      }
    }

    if (removed > 0) {
      if (removed === 1) {
        parts.push('1 arte removida');
      } else {
        parts.push(`${removed} artes removidas`);
      }
    }

    return parts.join(' e ');
  }

  /**
   * Handle deadline approaching event
   * Maps threshold to specific config key (task.deadline_1hour, task.deadline_4hours,
   * task.deadline_1day, task.deadline_3days, task.deadline_7days)
   */
  private async handleTaskDeadlineApproaching(event: TaskDeadlineApproachingEvent): Promise<void> {
    try {
      const isHourBased = event.hoursRemaining !== undefined && event.hoursRemaining < 24;
      const timeLabel = isHourBased
        ? `${event.hoursRemaining} hora(s)`
        : `${event.daysRemaining} dia(s)`;

      this.logger.log(`Task deadline approaching: ${event.task.id} - ${timeLabel} remaining`);

      const configKey = getDeadlineConfigKey(event.daysRemaining, event.hoursRemaining);
      if (!configKey) {
        this.logger.warn(
          `[TASK EVENT] No deadline config key for daysRemaining=${event.daysRemaining}, hoursRemaining=${event.hoursRemaining}`,
        );
        return;
      }

      this.logger.log(`[TASK EVENT] Using deadline config key: ${configKey}`);

      await this.dispatchService.dispatchByConfiguration(
        configKey,
        'system',
        {
          entityType: 'Task',
          entityId: event.task.id,
          action: 'deadline_approaching',
          data: {
            taskId: event.task.id,
            taskName: event.task.name,
            serialNumber: event.task.serialNumber,
            daysRemaining: event.daysRemaining,
            hoursRemaining: event.hoursRemaining,
          },
        },
      );

      this.logger.log(`Deadline approaching notification dispatched (${configKey})`);
    } catch (error) {
      this.logger.error('Error handling task deadline approaching event:', error);
    }
  }

  /**
   * Handle task overdue event
   * Uses 'task.overdue' configuration for dispatch
   */
  private async handleTaskOverdue(event: TaskOverdueEvent): Promise<void> {
    try {
      this.logger.log(`Task overdue: ${event.task.id} - ${event.daysOverdue} days overdue`);

      await this.dispatchService.dispatchByConfiguration(
        'task.overdue',
        'system',
        {
          entityType: 'Task',
          entityId: event.task.id,
          action: 'overdue',
          data: {
            taskId: event.task.id,
            taskName: event.task.name,
            serialNumber: event.task.serialNumber,
            daysOverdue: event.daysOverdue,
          },
        },
      );

      this.logger.log('Overdue task notification dispatched');
    } catch (error) {
      this.logger.error('Error handling task overdue event:', error);
    }
  }

  /**
   * Handle forecast approaching event
   * Maps threshold to specific config key (task.forecast_10days, task.forecast_7days,
   * task.forecast_3days, task.forecast_1day, task.forecast_today)
   */
  private async handleTaskForecastApproaching(event: TaskForecastApproachingEvent): Promise<void> {
    try {
      this.logger.log(
        `Task forecast approaching: ${event.task.id} - ${event.daysRemaining} day(s) remaining`,
      );

      const configKey = getForecastConfigKey(event.daysRemaining);
      if (!configKey) {
        this.logger.warn(
          `[TASK EVENT] No forecast config key for daysRemaining=${event.daysRemaining}`,
        );
        return;
      }

      this.logger.log(`[TASK EVENT] Using forecast config key: ${configKey}`);

      await this.dispatchService.dispatchByConfiguration(
        configKey,
        'system',
        {
          entityType: 'Task',
          entityId: event.task.id,
          action: 'forecast_approaching',
          data: {
            taskId: event.task.id,
            taskName: event.task.name,
            serialNumber: event.task.serialNumber,
            daysRemaining: event.daysRemaining,
            hasIncompleteOrders: event.hasIncompleteOrders,
            incompleteOrderTypes: event.incompleteOrderTypes,
          },
        },
      );

      this.logger.log(`Forecast approaching notification dispatched (${configKey})`);
    } catch (error) {
      this.logger.error('Error handling task forecast approaching event:', error);
    }
  }

  /**
   * Handle forecast overdue event
   * Uses 'task.forecast_overdue' configuration for dispatch
   */
  private async handleTaskForecastOverdue(event: TaskForecastOverdueEvent): Promise<void> {
    try {
      this.logger.log(
        `Task forecast overdue: ${event.task.id} - ${event.daysOverdue} day(s) overdue`,
      );

      await this.dispatchService.dispatchByConfiguration(
        'task.forecast_overdue',
        'system',
        {
          entityType: 'Task',
          entityId: event.task.id,
          action: 'forecast_overdue',
          data: {
            taskId: event.task.id,
            taskName: event.task.name,
            serialNumber: event.task.serialNumber,
            daysOverdue: event.daysOverdue,
            hasIncompleteOrders: event.hasIncompleteOrders,
            incompleteOrderTypes: event.incompleteOrderTypes,
          },
        },
      );

      this.logger.log('Forecast overdue notification dispatched');
    } catch (error) {
      this.logger.error('Error handling task forecast overdue event:', error);
    }
  }

  /**
   * Notify PRODUCTION users when a task becomes ready for production (WAITING_PRODUCTION status)
   * Uses 'task.ready_for_production' configuration for dispatch
   */
  private async notifyProductionUsersTaskReady(task: any, changedBy: any): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[TASK EVENT] Notifying PRODUCTION users - Task ready for production');
    this.logger.log(`[TASK EVENT] Task ID: ${task.id}`);
    this.logger.log(`[TASK EVENT] Task Name: ${task.name}`);
    this.logger.log('========================================');

    try {
      await this.dispatchService.dispatchByConfiguration(
        'task.ready_for_production',
        changedBy.id,
        {
          entityType: 'Task',
          entityId: task.id,
          action: 'ready_for_production',
          data: {
            taskId: task.id,
            taskName: task.name,
            serialNumber: task.serialNumber,
            changedBy: changedBy?.name || 'Sistema',
          },
        },
      );

      this.logger.log('[TASK EVENT] Production ready notification dispatched via configuration');
    } catch (error) {
      this.logger.error('[TASK EVENT] Error notifying PRODUCTION users:', error.message);
    }
  }
}
