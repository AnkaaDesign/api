import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationService } from '@modules/common/notification/notification.service';
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
  NOTIFICATION_TYPE,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_ACTION_TYPE,
} from '../../../constants/enums';
import { TASK_STATUS_LABELS } from '../../../constants/enum-labels';

/**
 * Task Event Listener
 * Handles all task-related events and creates appropriate notifications
 */
@Injectable()
export class TaskListener {
  private readonly logger = new Logger(TaskListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly notificationService: NotificationService,
    private readonly prisma: PrismaService,
  ) {
    // Register event listeners
    this.eventEmitter.on('task.created', this.handleTaskCreated.bind(this));
    this.eventEmitter.on('task.status.changed', this.handleTaskStatusChanged.bind(this));
    this.eventEmitter.on('task.field.updated', this.handleTaskFieldUpdated.bind(this));
    this.eventEmitter.on('task.field.changed', this.handleTaskFieldChanged.bind(this));
    this.eventEmitter.on(
      'task.deadline.approaching',
      this.handleTaskDeadlineApproaching.bind(this),
    );
    this.eventEmitter.on('task.overdue', this.handleTaskOverdue.bind(this));
  }

  /**
   * Handle task creation event
   * Notify: sector manager + admin users
   */
  private async handleTaskCreated(event: TaskCreatedEvent): Promise<void> {
    try {
      this.logger.log(`Task created: ${event.task.id} by ${event.createdBy.name}`);

      const targetUsers = await this.getTargetUsersForTaskCreated(event.task);

      // Create notifications for all target users
      for (const userId of targetUsers) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          title: 'Nova tarefa criada',
          body: `Tarefa "${event.task.name}" foi criada por ${event.createdBy.name}${event.task.serialNumber ? ` (${event.task.serialNumber})` : ''}`,
          actionType: NOTIFICATION_ACTION_TYPE.TASK_CREATED,
          actionUrl: `/tasks/${event.task.id}`,
          channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        });
      }

      this.logger.log(`Created ${targetUsers.length} notifications for task creation`);
    } catch (error) {
      this.logger.error('Error handling task created event:', error);
    }
  }

  /**
   * Handle task status change event
   * Notify: assigned users + sector manager + admin users
   */
  private async handleTaskStatusChanged(event: TaskStatusChangedEvent): Promise<void> {
    try {
      this.logger.log(
        `Task status changed: ${event.task.id} from ${event.oldStatus} to ${event.newStatus}`,
      );

      const targetUsers = await this.getTargetUsersForStatusChange(event.task);

      const oldStatusLabel = TASK_STATUS_LABELS[event.oldStatus];
      const newStatusLabel = TASK_STATUS_LABELS[event.newStatus];

      // Create notifications for all target users
      for (const userId of targetUsers) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          title: 'Status da tarefa alterado',
          body: `Tarefa "${event.task.name}" mudou de "${oldStatusLabel}" para "${newStatusLabel}" por ${event.changedBy.name}`,
          actionType: NOTIFICATION_ACTION_TYPE.TASK_UPDATED,
          actionUrl: `/tasks/${event.task.id}`,
          channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        });
      }

      this.logger.log(`Created ${targetUsers.length} notifications for status change`);
    } catch (error) {
      this.logger.error('Error handling task status changed event:', error);
    }
  }

  /**
   * Handle task field update event
   * Notify users based on field type and importance
   */
  private async handleTaskFieldUpdated(event: TaskFieldUpdatedEvent): Promise<void> {
    try {
      this.logger.log(
        `Task field updated: ${event.task.id} - ${event.fieldName} changed from ${event.oldValue} to ${event.newValue}`,
      );

      // Skip if field is not important enough to notify
      if (!this.isImportantField(event.fieldName)) {
        return;
      }

      const targetUsers = await this.getTargetUsersForFieldUpdate(event.task, event.fieldName);
      const fieldLabel = this.getFieldLabel(event.fieldName);
      const importance = this.getFieldImportance(event.fieldName);

      // Format the values for display
      const oldValueFormatted = await this.formatFieldValue(event.fieldName, event.oldValue);
      const newValueFormatted = await this.formatFieldValue(event.fieldName, event.newValue);

      // Create notifications for all target users
      for (const userId of targetUsers) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance,
          title: `Tarefa atualizada: ${fieldLabel}`,
          body: `${fieldLabel} da tarefa "${event.task.name}" foi alterado de "${oldValueFormatted}" para "${newValueFormatted}" por ${event.updatedBy.name}`,
          actionType: NOTIFICATION_ACTION_TYPE.TASK_UPDATED,
          actionUrl: `/tasks/${event.task.id}`,
          channel: [NOTIFICATION_CHANNEL.IN_APP],
        });
      }

      this.logger.log(`Created ${targetUsers.length} notifications for field update`);
    } catch (error) {
      this.logger.error('Error handling task field updated event:', error);
    }
  }

  /**
   * Handle task field changed event from field tracker
   * Provides detailed handling for file array changes
   * Notify users based on field type and importance
   */
  private async handleTaskFieldChanged(event: TaskFieldChangedEvent): Promise<void> {
    try {
      this.logger.log(
        `Task field changed: ${event.task.id} - ${event.field} (isFileArray: ${event.isFileArray})`,
      );

      // Skip if field is not important enough to notify
      if (!this.isImportantField(event.field)) {
        return;
      }

      const targetUsers = await this.getTargetUsersForFieldUpdate(event.task, event.field);
      const fieldLabel = this.getFieldLabel(event.field);
      const importance = this.getFieldImportance(event.field);

      // Get the user who made the change
      const changedByUser = await this.prisma.user.findUnique({
        where: { id: event.changedBy },
        select: { name: true },
      });

      const changedByName = changedByUser?.name || 'Sistema';

      // Format notification body based on whether it's a file array
      let notificationBody: string;

      if (event.isFileArray && event.fileChange) {
        // Special handling for file arrays
        const { added, removed } = event.fileChange;
        const changes: string[] = [];

        if (added > 0) {
          changes.push(`${added} arquivo(s) adicionado(s)`);
        }
        if (removed > 0) {
          changes.push(`${removed} arquivo(s) removido(s)`);
        }

        notificationBody = `${fieldLabel} da tarefa "${event.task.name}": ${changes.join(', ')} por ${changedByName}`;
      } else {
        // Regular field change
        const oldValueFormatted = await this.formatFieldValue(event.field, event.oldValue);
        const newValueFormatted = await this.formatFieldValue(event.field, event.newValue);

        notificationBody = `${fieldLabel} da tarefa "${event.task.name}" foi alterado de "${oldValueFormatted}" para "${newValueFormatted}" por ${changedByName}`;
      }

      // Create notifications for all target users
      for (const userId of targetUsers) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance,
          title: `Tarefa atualizada: ${fieldLabel}`,
          body: notificationBody,
          actionType: NOTIFICATION_ACTION_TYPE.TASK_UPDATED,
          actionUrl: `/tasks/${event.task.id}`,
          channel: [NOTIFICATION_CHANNEL.IN_APP],
          metadata: {
            taskId: event.task.id,
            field: event.field,
            isFileArray: event.isFileArray,
            ...(event.fileChange && {
              filesAdded: event.fileChange.added,
              filesRemoved: event.fileChange.removed,
            }),
          },
        });
      }

      this.logger.log(
        `Created ${targetUsers.length} notifications for field change: ${event.field}`,
      );
    } catch (error) {
      this.logger.error('Error handling task field changed event:', error);
    }
  }

  /**
   * Handle deadline approaching event
   * Notify: assigned users + sector manager
   */
  private async handleTaskDeadlineApproaching(event: TaskDeadlineApproachingEvent): Promise<void> {
    try {
      this.logger.log(
        `Task deadline approaching: ${event.task.id} - ${event.daysRemaining} days remaining`,
      );

      const targetUsers = await this.getTargetUsersForDeadline(event.task);

      // Determine importance based on days remaining
      const importance =
        event.daysRemaining <= 1
          ? NOTIFICATION_IMPORTANCE.URGENT
          : event.daysRemaining <= 3
            ? NOTIFICATION_IMPORTANCE.HIGH
            : NOTIFICATION_IMPORTANCE.NORMAL;

      // Create notifications for all target users
      for (const userId of targetUsers) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance,
          title: 'Prazo da tarefa se aproximando',
          body: `Tarefa "${event.task.name}" tem prazo em ${event.daysRemaining} dia(s)${event.task.serialNumber ? ` (${event.task.serialNumber})` : ''}`,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl: `/tasks/${event.task.id}`,
          channel:
            event.daysRemaining <= 1
              ? [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL]
              : [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
        });
      }

      this.logger.log(`Created ${targetUsers.length} notifications for deadline approaching`);
    } catch (error) {
      this.logger.error('Error handling task deadline approaching event:', error);
    }
  }

  /**
   * Handle task overdue event
   * Notify: assigned users + sector manager + admin users
   */
  private async handleTaskOverdue(event: TaskOverdueEvent): Promise<void> {
    try {
      this.logger.log(`Task overdue: ${event.task.id} - ${event.daysOverdue} days overdue`);

      const targetUsers = await this.getTargetUsersForOverdue(event.task);

      // Create notifications for all target users
      for (const userId of targetUsers) {
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance: NOTIFICATION_IMPORTANCE.URGENT,
          title: 'Tarefa atrasada',
          body: `Tarefa "${event.task.name}" está atrasada há ${event.daysOverdue} dia(s)${event.task.serialNumber ? ` (${event.task.serialNumber})` : ''}`,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl: `/tasks/${event.task.id}`,
          channel: [
            NOTIFICATION_CHANNEL.IN_APP,
            NOTIFICATION_CHANNEL.PUSH,
            NOTIFICATION_CHANNEL.EMAIL,
          ],
        });
      }

      this.logger.log(`Created ${targetUsers.length} notifications for overdue task`);
    } catch (error) {
      this.logger.error('Error handling task overdue event:', error);
    }
  }

  // =====================
  // Helper Methods - Target Users
  // =====================

  /**
   * Get target users for task creation
   * Returns: sector manager + admin users
   */
  private async getTargetUsersForTaskCreated(task: any): Promise<string[]> {
    const userIds = new Set<string>();

    // Get sector manager
    if (task.sectorId) {
      const sector = await this.prisma.sector.findUnique({
        where: { id: task.sectorId },
        select: { managerId: true },
      });

      if (sector?.managerId) {
        userIds.add(sector.managerId);
      }
    }

    // Get admin users (users with admin positions)
    const admins = await this.prisma.user.findMany({
      where: {
        isActive: true,
        position: {
          isNot: null,
          name: {
            in: ['Admin', 'Super Admin', 'Administrador', 'Super Administrador'],
          },
        },
      },
      select: { id: true },
    });

    admins.forEach(admin => userIds.add(admin.id));

    return Array.from(userIds);
  }

  /**
   * Get target users for status change
   * Returns: assigned users + sector manager + admin users
   */
  private async getTargetUsersForStatusChange(task: any): Promise<string[]> {
    const userIds = new Set<string>();

    // Get sector manager
    if (task.sectorId) {
      const sector = await this.prisma.sector.findUnique({
        where: { id: task.sectorId },
        select: { managerId: true },
      });

      if (sector?.managerId) {
        userIds.add(sector.managerId);
      }
    }

    // Get admin users (users with admin positions)
    const admins = await this.prisma.user.findMany({
      where: {
        isActive: true,
        position: {
          isNot: null,
          name: {
            in: ['Admin', 'Super Admin', 'Administrador', 'Super Administrador'],
          },
        },
      },
      select: { id: true },
    });

    admins.forEach(admin => userIds.add(admin.id));

    return Array.from(userIds);
  }

  /**
   * Get target users for field update
   * Returns users based on field type
   */
  private async getTargetUsersForFieldUpdate(task: any, fieldName: string): Promise<string[]> {
    // For important fields, notify same users as status change
    if (this.isHighPriorityField(fieldName)) {
      return this.getTargetUsersForStatusChange(task);
    }

    // For regular fields, notify only sector manager
    const userIds = new Set<string>();

    if (task.sectorId) {
      const sector = await this.prisma.sector.findUnique({
        where: { id: task.sectorId },
        select: { managerId: true },
      });

      if (sector?.managerId) {
        userIds.add(sector.managerId);
      }
    }

    return Array.from(userIds);
  }

  /**
   * Get target users for deadline approaching
   * Returns: assigned users + sector manager
   */
  private async getTargetUsersForDeadline(task: any): Promise<string[]> {
    const userIds = new Set<string>();

    // Get sector manager
    if (task.sectorId) {
      const sector = await this.prisma.sector.findUnique({
        where: { id: task.sectorId },
        select: { managerId: true },
      });

      if (sector?.managerId) {
        userIds.add(sector.managerId);
      }
    }

    return Array.from(userIds);
  }

  /**
   * Get target users for overdue task
   * Returns: assigned users + sector manager + admin users
   */
  private async getTargetUsersForOverdue(task: any): Promise<string[]> {
    return this.getTargetUsersForStatusChange(task);
  }

  // =====================
  // Helper Methods - Field Utilities
  // =====================

  /**
   * Check if field is important enough to create notifications
   */
  private isImportantField(fieldName: string): boolean {
    const importantFields = [
      'term',
      'forecastDate',
      'sectorId',
      'artworks',
      'budgets',
      'invoices',
      'priority',
      'details',
    ];

    return importantFields.includes(fieldName);
  }

  /**
   * Check if field is high priority
   */
  private isHighPriorityField(fieldName: string): boolean {
    const highPriorityFields = ['term', 'sectorId', 'priority'];

    return highPriorityFields.includes(fieldName);
  }

  /**
   * Get importance level for a field
   */
  private getFieldImportance(fieldName: string): NOTIFICATION_IMPORTANCE {
    const urgentFields = ['term'];
    const highFields = ['sectorId', 'priority'];

    if (urgentFields.includes(fieldName)) {
      return NOTIFICATION_IMPORTANCE.URGENT;
    }

    if (highFields.includes(fieldName)) {
      return NOTIFICATION_IMPORTANCE.HIGH;
    }

    return NOTIFICATION_IMPORTANCE.NORMAL;
  }

  /**
   * Get human-readable label for a field
   */
  private getFieldLabel(fieldName: string): string {
    const labels: Record<string, string> = {
      term: 'Prazo',
      forecastDate: 'Data de Previsão',
      sectorId: 'Setor',
      artworks: 'Artes',
      budgets: 'Orçamentos',
      invoices: 'Notas Fiscais',
      priority: 'Prioridade',
      details: 'Detalhes',
    };

    return labels[fieldName] || fieldName;
  }

  /**
   * Format field value for display in notifications
   */
  private async formatFieldValue(fieldName: string, value: any): Promise<string> {
    if (value === null || value === undefined) {
      return 'N/A';
    }

    // Format dates
    if (fieldName === 'term' || fieldName === 'forecastDate') {
      const date = new Date(value);
      return date.toLocaleDateString('pt-BR');
    }

    // Format sector
    if (fieldName === 'sectorId') {
      const sector = await this.prisma.sector.findUnique({
        where: { id: value },
        select: { name: true },
      });
      return sector?.name || value;
    }

    // Format arrays (artworks, budgets, invoices)
    if (Array.isArray(value)) {
      return `${value.length} item(ns)`;
    }

    return String(value);
  }
}
