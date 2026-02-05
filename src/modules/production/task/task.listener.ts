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
import { TASK_STATUS } from '../../../constants/enums';

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
          entityType: 'task',
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
   * Uses 'task.field.status' configuration for dispatch
   * Special case: When status changes to WAITING_PRODUCTION, notify PRODUCTION users
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
      await this.dispatchService.dispatchByConfiguration(
        'task.field.status',
        event.changedBy.id,
        {
          entityType: 'task',
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
        },
      );

      this.logger.log('[TASK EVENT] Task status change notification dispatched via configuration');

      // Special case: When status changes TO WAITING_PRODUCTION, notify PRODUCTION users
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
          entityType: 'task',
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

      // Calculate count for file arrays
      let count: number | undefined;
      if (event.isFileArray && event.fileChange) {
        const { added, removed } = event.fileChange;
        count = added > 0 ? added : -removed; // Positive for added, negative for removed
      }

      await this.dispatchService.dispatchByConfiguration(
        `task.field.${event.field}`,
        event.changedBy,
        {
          entityType: 'task',
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
          },
        },
      );

      this.logger.log(`Field change notification dispatched for: ${event.field}`);
    } catch (error) {
      this.logger.error('Error handling task field changed event:', error);
    }
  }

  /**
   * Handle deadline approaching event
   * Uses 'task.deadline_approaching' configuration for dispatch
   */
  private async handleTaskDeadlineApproaching(event: TaskDeadlineApproachingEvent): Promise<void> {
    try {
      const isHourBased = event.hoursRemaining !== undefined && event.hoursRemaining < 24;
      const timeLabel = isHourBased
        ? `${event.hoursRemaining} hora(s)`
        : `${event.daysRemaining} dia(s)`;

      this.logger.log(`Task deadline approaching: ${event.task.id} - ${timeLabel} remaining`);

      await this.dispatchService.dispatchByConfiguration(
        'task.deadline_approaching',
        'system', // System-generated notification
        {
          entityType: 'task',
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

      this.logger.log(`Deadline approaching notification dispatched (${timeLabel})`);
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
        'system', // System-generated notification
        {
          entityType: 'task',
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
          entityType: 'task',
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
