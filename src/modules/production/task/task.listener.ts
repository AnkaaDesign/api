import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { NotificationService } from '@modules/common/notification/notification.service';
import { NotificationPreferenceService } from '@modules/common/notification/notification-preference.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';
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
  SECTOR_PRIVILEGES,
  COMMISSION_STATUS,
  TASK_STATUS,
} from '../../../constants/enums';
import { TASK_STATUS_LABELS } from '../../../constants/enum-labels';
import {
  TASK_FIELD_NOTIFICATIONS,
  getFieldConfig,
  getAllowedRolesForField,
  canRoleReceiveFieldNotification,
  getFieldLabel,
  TaskFieldCategory,
  CATEGORY_ALLOWED_ROLES,
} from '@modules/common/notification/task-notification.config';

/**
 * Commission Status Labels
 */
const COMMISSION_STATUS_LABELS: Record<string, string> = {
  [COMMISSION_STATUS.NO_COMMISSION]: 'Sem Comissão',
  [COMMISSION_STATUS.PARTIAL_COMMISSION]: 'Comissão Parcial',
  [COMMISSION_STATUS.FULL_COMMISSION]: 'Comissão Total',
  [COMMISSION_STATUS.SUSPENDED_COMMISSION]: 'Comissão Suspensa',
};

/**
 * Task Event Listener
 * Handles all task-related events and creates appropriate notifications
 * with role-based targeting and multi-channel delivery
 */
@Injectable()
export class TaskListener {
  private readonly logger = new Logger(TaskListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly notificationService: NotificationService,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly deepLinkService: DeepLinkService,
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
   * Notify: sector manager + admin users
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
      this.logger.log('[TASK EVENT] Step 1: Fetching target users for task creation...');
      const targetUsers = await this.getTargetUsersForTaskCreated(event.task);
      this.logger.log(`[TASK EVENT] Found ${targetUsers.length} target user(s)`);
      targetUsers.forEach((userId, idx) => {
        this.logger.log(`[TASK EVENT]   User ${idx + 1}: ${userId}`);
      });

      // Create notifications for all target users
      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      for (const userId of targetUsers) {
        this.logger.log('----------------------------------------');
        this.logger.log(`[TASK EVENT] Processing user: ${userId}`);

        // Use 'created' to match user preference event type
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.TASK,
          'created',
        );

        this.logger.log(`[TASK EVENT] Enabled channels for user: [${channels.join(', ')}]`);

        if (channels.length === 0) {
          this.logger.warn(`[TASK EVENT] ⚠️ No enabled channels for user ${userId} - skipping`);
          notificationsSkipped++;
          continue;
        }

        this.logger.log(`[TASK EVENT] Creating notification for user ${userId}...`);
        const { actionUrl, metadata } = this.getTaskNotificationMetadata(event.task);
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          title: 'Nova tarefa criada',
          body: `Tarefa "${event.task.name}" foi criada por ${event.createdBy.name}${event.task.serialNumber ? ` (${event.task.serialNumber})` : ''}`,
          actionType: NOTIFICATION_ACTION_TYPE.TASK_CREATED,
          actionUrl,
          relatedEntityId: event.task.id,
          relatedEntityType: 'TASK',
          metadata,
          channel: channels,
        });
        this.logger.log(`[TASK EVENT] ✅ Notification created for user ${userId}`);
        notificationsCreated++;
      }

      this.logger.log('========================================');
      this.logger.log('[TASK EVENT] Task creation notification summary:');
      this.logger.log(`[TASK EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[TASK EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('========================================');
      this.logger.error('[TASK EVENT] ❌ Error handling task created event');
      this.logger.error('[TASK EVENT] Error:', error.message);
      this.logger.error('[TASK EVENT] Stack:', error.stack);
      this.logger.error('========================================');
    }
  }

  /**
   * Handle task status change event
   * Notify: assigned users + sector manager + admin users
   * Special case: When status changes to WAITING_PRODUCTION, notify PRODUCTION users with task creation message
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
      this.logger.log('[TASK EVENT] Step 1: Fetching target users...');
      const targetUsers = await this.getTargetUsersForField(event.task, 'status');
      this.logger.log(`[TASK EVENT] Found ${targetUsers.length} target user(s)`);
      targetUsers.forEach((userId, idx) => {
        this.logger.log(`[TASK EVENT]   User ${idx + 1}: ${userId}`);
      });

      const oldStatusLabel = TASK_STATUS_LABELS[event.oldStatus];
      const newStatusLabel = TASK_STATUS_LABELS[event.newStatus];
      this.logger.log(`[TASK EVENT] Status labels: "${oldStatusLabel}" → "${newStatusLabel}"`);

      // Create notifications for all target users
      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      for (const userId of targetUsers) {
        this.logger.log('----------------------------------------');
        this.logger.log(`[TASK EVENT] Processing user: ${userId}`);

        // Use 'status' to match user preference event type
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.TASK,
          'status',
        );

        this.logger.log(`[TASK EVENT] Enabled channels for user: [${channels.join(', ')}]`);

        if (channels.length === 0) {
          this.logger.warn(`[TASK EVENT] ⚠️ No enabled channels for user ${userId} - skipping`);
          notificationsSkipped++;
          continue;
        }

        this.logger.log(`[TASK EVENT] Creating notification for user ${userId}...`);
        const { actionUrl, metadata } = this.getTaskNotificationMetadata(event.task);
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance: NOTIFICATION_IMPORTANCE.HIGH,
          title: 'Status da tarefa alterado',
          body: `Tarefa "${event.task.name}" mudou de "${oldStatusLabel}" para "${newStatusLabel}" por ${event.changedBy.name}`,
          actionType: NOTIFICATION_ACTION_TYPE.TASK_UPDATED,
          actionUrl,
          relatedEntityId: event.task.id,
          relatedEntityType: 'TASK',
          metadata,
          channel: channels,
        });
        this.logger.log(`[TASK EVENT] ✅ Notification created for user ${userId}`);
        notificationsCreated++;
      }

      this.logger.log('========================================');
      this.logger.log('[TASK EVENT] Task status change notification summary:');
      this.logger.log(`[TASK EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[TASK EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');

      // Special case: When status changes TO WAITING_PRODUCTION, notify PRODUCTION users
      // This acts as a "task created" notification for the production team
      if (event.newStatus === TASK_STATUS.WAITING_PRODUCTION) {
        this.logger.log('[TASK EVENT] Status changed to WAITING_PRODUCTION - notifying production users...');
        await this.notifyProductionUsersTaskReady(event.task, event.changedBy);
      }
    } catch (error) {
      this.logger.error('========================================');
      this.logger.error('[TASK EVENT] ❌ Error handling task status changed event');
      this.logger.error('[TASK EVENT] Error:', error.message);
      this.logger.error('[TASK EVENT] Stack:', error.stack);
      this.logger.error('========================================');
    }
  }

  /**
   * Handle task field update event
   * Notify users based on field type, importance, and role restrictions
   */
  private async handleTaskFieldUpdated(event: TaskFieldUpdatedEvent): Promise<void> {
    try {
      this.logger.log(
        `Task field updated: ${event.task.id} - ${event.fieldName} changed`,
      );

      const config = getFieldConfig(event.fieldName);

      // Skip if field is not configured or disabled
      if (!config || !config.enabled) {
        this.logger.debug(`Skipping notification for unconfigured/disabled field: ${event.fieldName}`);
        return;
      }

      const targetUsers = await this.getTargetUsersForField(event.task, event.fieldName);

      // Format the values for display
      const oldValueFormatted = await this.formatFieldValue(event.fieldName, event.oldValue);
      const newValueFormatted = await this.formatFieldValue(event.fieldName, event.newValue);

      // Determine message type (cleared vs updated)
      const isCleared = event.newValue === null || event.newValue === undefined;
      const messageConfig = isCleared && config.messages.cleared
        ? config.messages.cleared
        : config.messages.updated;

      // Create notifications for all target users
      for (const userId of targetUsers) {
        // Use just the field name to match user preference event type
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.TASK,
          event.fieldName,
        );

        if (channels.length === 0) continue;

        const body = this.interpolateMessage(messageConfig.inApp, {
          taskName: event.task.name,
          serialNumber: event.task.serialNumber || '',
          oldValue: oldValueFormatted,
          newValue: newValueFormatted,
          changedBy: event.updatedBy.name,
        });

        const { actionUrl, metadata } = this.getTaskNotificationMetadata(event.task);
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance: config.importance,
          title: `Tarefa atualizada: ${config.label}`,
          body,
          actionType: NOTIFICATION_ACTION_TYPE.TASK_UPDATED,
          actionUrl,
          relatedEntityId: event.task.id,
          relatedEntityType: 'TASK',
          metadata,
          channel: channels,
        });
      }

      this.logger.log(`Created ${targetUsers.length} notifications for field update: ${event.fieldName}`);
    } catch (error) {
      this.logger.error('Error handling task field updated event:', error);
    }
  }

  /**
   * Handle task field changed event from field tracker
   * Provides detailed handling for file array changes
   * Notify users based on field type, importance, and role restrictions
   */
  private async handleTaskFieldChanged(event: TaskFieldChangedEvent): Promise<void> {
    try {
      this.logger.log(
        `Task field changed: ${event.task.id} - ${event.field} (isFileArray: ${event.isFileArray})`,
      );

      const config = getFieldConfig(event.field);

      // Skip if field is not configured or disabled
      if (!config || !config.enabled) {
        this.logger.debug(`Skipping notification for unconfigured/disabled field: ${event.field}`);
        return;
      }

      const targetUsers = await this.getTargetUsersForField(event.task, event.field);

      // Get the user who made the change
      const changedByUser = await this.prisma.user.findUnique({
        where: { id: event.changedBy },
        select: { name: true },
      });

      const changedByName = changedByUser?.name || 'Sistema';

      // Determine message configuration based on change type
      let messageConfig = config.messages.updated;
      let messageVars: Record<string, string | number> = {
        taskName: event.task.name || '',
        serialNumber: event.task.serialNumber || '',
        changedBy: changedByName,
      };

      if (event.isFileArray && event.fileChange) {
        // Handle file array changes
        const { added, removed } = event.fileChange;

        if (added > 0 && removed === 0 && config.messages.filesAdded) {
          messageConfig = config.messages.filesAdded;
          messageVars.count = added;
        } else if (removed > 0 && added === 0 && config.messages.filesRemoved) {
          messageConfig = config.messages.filesRemoved;
          messageVars.count = removed;
        } else {
          // Mixed changes
          messageVars.count = added + removed;
        }
      } else {
        // Regular field change
        const isCleared = event.newValue === null || event.newValue === undefined;

        if (isCleared && config.messages.cleared) {
          messageConfig = config.messages.cleared;
        }

        const oldValueFormatted = await this.formatFieldValue(event.field, event.oldValue);
        const newValueFormatted = await this.formatFieldValue(event.field, event.newValue);

        messageVars.oldValue = oldValueFormatted;
        messageVars.newValue = newValueFormatted;
      }

      // Create notifications for all target users
      for (const userId of targetUsers) {
        // Use just the field name to match user preference event type
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.TASK,
          event.field,
        );

        if (channels.length === 0) continue;

        const body = this.interpolateMessage(messageConfig.inApp, messageVars);

        const { actionUrl, metadata } = this.getTaskNotificationMetadata(event.task);
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance: config.importance,
          title: `Tarefa atualizada: ${config.label}`,
          body,
          actionType: NOTIFICATION_ACTION_TYPE.TASK_UPDATED,
          actionUrl,
          relatedEntityId: event.task.id,
          relatedEntityType: 'TASK',
          metadata,
          channel: channels,
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

      // Determine channels based on urgency
      const defaultChannels =
        event.daysRemaining <= 1
          ? [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL]
          : [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH];

      // Create notifications for all target users
      for (const userId of targetUsers) {
        // Use 'deadline' to match user preference event type
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.TASK,
          'deadline',
          defaultChannels,
        );

        if (channels.length === 0) continue;

        const { actionUrl, metadata } = this.getTaskNotificationMetadata(event.task);
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance,
          title: 'Prazo da tarefa se aproximando',
          body: `Tarefa "${event.task.name}" tem prazo em ${event.daysRemaining} dia(s)${event.task.serialNumber ? ` (${event.task.serialNumber})` : ''}`,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl,
          relatedEntityId: event.task.id,
          relatedEntityType: 'TASK',
          metadata,
          channel: channels,
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
        // Use 'overdue' to match user preference event type
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.TASK,
          'overdue',
          [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.EMAIL],
        );

        if (channels.length === 0) continue;

        const { actionUrl, metadata } = this.getTaskNotificationMetadata(event.task);
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance: NOTIFICATION_IMPORTANCE.URGENT,
          title: 'Tarefa atrasada',
          body: `Tarefa "${event.task.name}" está atrasada há ${event.daysOverdue} dia(s)${event.task.serialNumber ? ` (${event.task.serialNumber})` : ''}`,
          actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS,
          actionUrl,
          relatedEntityId: event.task.id,
          relatedEntityType: 'TASK',
          metadata,
          channel: channels,
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
   * Returns: sector manager + users with ADMIN, DESIGNER, LOGISTIC, FINANCIAL privileges
   * Note: PRODUCTION users are notified separately when task status changes to WAITING_PRODUCTION
   */
  private async getTargetUsersForTaskCreated(task: any): Promise<string[]> {
    return this.getTargetUsersWithRoleFilter(task, [
      SECTOR_PRIVILEGES.ADMIN,
      SECTOR_PRIVILEGES.DESIGNER,
      SECTOR_PRIVILEGES.LOGISTIC,
      SECTOR_PRIVILEGES.FINANCIAL,
    ]);
  }

  /**
   * Notify PRODUCTION users when a task becomes ready for production (WAITING_PRODUCTION status)
   * This acts as a "task created" notification specifically for the production team
   * Uses the 'created' event type for preference lookup so users can control it via notification preferences
   */
  private async notifyProductionUsersTaskReady(task: any, changedBy: any): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('[TASK EVENT] Notifying PRODUCTION users - Task ready for production');
    this.logger.log(`[TASK EVENT] Task ID: ${task.id}`);
    this.logger.log(`[TASK EVENT] Task Name: ${task.name}`);
    this.logger.log('========================================');

    try {
      // Get only PRODUCTION users
      const productionUsers = await this.getTargetUsersWithRoleFilter(task, [
        SECTOR_PRIVILEGES.PRODUCTION,
      ]);

      this.logger.log(`[TASK EVENT] Found ${productionUsers.length} PRODUCTION user(s) to notify`);

      let notificationsCreated = 0;
      let notificationsSkipped = 0;

      for (const userId of productionUsers) {
        this.logger.log(`[TASK EVENT] Processing PRODUCTION user: ${userId}`);

        // Use 'created' event type so users can control this via their notification preferences
        const channels = await this.getEnabledChannelsForUser(
          userId,
          NOTIFICATION_TYPE.TASK,
          'created',
        );

        this.logger.log(`[TASK EVENT] Enabled channels for PRODUCTION user: [${channels.join(', ')}]`);

        if (channels.length === 0) {
          this.logger.warn(`[TASK EVENT] ⚠️ No enabled channels for PRODUCTION user ${userId} - skipping`);
          notificationsSkipped++;
          continue;
        }

        const { actionUrl, metadata } = this.getTaskNotificationMetadata(task);
        await this.notificationService.createNotification({
          userId,
          type: NOTIFICATION_TYPE.TASK,
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          title: 'Nova tarefa aguardando produção',
          body: `Tarefa "${task.name}" está pronta para produção${task.serialNumber ? ` (${task.serialNumber})` : ''} - alterado por ${changedBy.name}`,
          actionType: NOTIFICATION_ACTION_TYPE.TASK_CREATED,
          actionUrl,
          relatedEntityId: task.id,
          relatedEntityType: 'TASK',
          metadata,
          channel: channels,
        });
        this.logger.log(`[TASK EVENT] ✅ Production notification created for user ${userId}`);
        notificationsCreated++;
      }

      this.logger.log('========================================');
      this.logger.log('[TASK EVENT] PRODUCTION notification summary:');
      this.logger.log(`[TASK EVENT]   ✅ Created: ${notificationsCreated}`);
      this.logger.log(`[TASK EVENT]   ⏭️  Skipped: ${notificationsSkipped}`);
      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('[TASK EVENT] ❌ Error notifying PRODUCTION users:', error.message);
    }
  }

  /**
   * Get target users for a specific field change
   * Filters based on role restrictions from config
   */
  private async getTargetUsersForField(task: any, fieldName: string): Promise<string[]> {
    const allowedRoles = getAllowedRolesForField(fieldName);

    if (allowedRoles.length === 0) {
      this.logger.warn(`No allowed roles configured for field: ${fieldName}`);
      return [];
    }

    return this.getTargetUsersWithRoleFilter(task, allowedRoles);
  }

  /**
   * Get target users for deadline approaching
   * Returns: assigned users + sector manager
   */
  private async getTargetUsersForDeadline(task: any): Promise<string[]> {
    return this.getTargetUsersWithRoleFilter(task, [
      SECTOR_PRIVILEGES.ADMIN,
      SECTOR_PRIVILEGES.PRODUCTION,
    ]);
  }

  /**
   * Get target users for overdue task
   * Returns: assigned users + sector manager + admin users
   */
  private async getTargetUsersForOverdue(task: any): Promise<string[]> {
    return this.getTargetUsersWithRoleFilter(task, [
      SECTOR_PRIVILEGES.ADMIN,
      SECTOR_PRIVILEGES.PRODUCTION,
      SECTOR_PRIVILEGES.FINANCIAL,
    ]);
  }

  /**
   * Get target users filtered by role privileges
   */
  private async getTargetUsersWithRoleFilter(
    task: any,
    allowedRoles: SECTOR_PRIVILEGES[],
  ): Promise<string[]> {
    const userIds = new Set<string>();

    try {
      // Get sector manager if task has a sector
      if (task.sectorId) {
        const sector = await this.prisma.sector.findUnique({
          where: { id: task.sectorId },
          select: {
            managerId: true,
            privileges: true, // Field is 'privileges' (plural)
          },
        });

        if (sector?.managerId) {
          // Check if sector privileges is in allowed roles
          if (allowedRoles.includes(sector.privileges as SECTOR_PRIVILEGES)) {
            userIds.add(sector.managerId);
          }
        }
      }

      // Get users with allowed privileges
      // Note: 'sector' is an optional relation, so we use 'is' to filter on its fields
      // The field is 'privileges' (plural) not 'privilege'
      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          sector: {
            is: {
              privileges: {
                in: allowedRoles,
              },
            },
          },
        },
        select: { id: true },
      });

      users.forEach(user => userIds.add(user.id));
    } catch (error) {
      this.logger.error('Error getting target users with role filter:', error);
    }

    return Array.from(userIds);
  }

  // =====================
  // Helper Methods - Channels
  // =====================

  /**
   * Get enabled channels for a user based on their preferences
   */
  private async getEnabledChannelsForUser(
    userId: string,
    notificationType: NOTIFICATION_TYPE,
    eventType: string,
    defaultChannels?: NOTIFICATION_CHANNEL[],
  ): Promise<NOTIFICATION_CHANNEL[]> {
    try {
      this.logger.debug(`Looking up channels for user ${userId}, type ${notificationType}, event ${eventType}`);

      const channels = await this.preferenceService.getChannelsForEvent(
        userId,
        notificationType,
        eventType,
      );

      this.logger.debug(`Found ${channels.length} channels from preferences: ${channels.join(', ') || 'none'}`);

      // If user has specific preferences, use them
      if (channels.length > 0) {
        return channels;
      }

      // Otherwise, use defaults from config or provided defaults
      if (defaultChannels) {
        return defaultChannels;
      }

      // Fall back to field config defaults
      // eventType is now just the field name (e.g., 'status', 'name', 'created')
      const config = getFieldConfig(eventType);

      return config?.defaultChannels || [NOTIFICATION_CHANNEL.IN_APP];
    } catch (error) {
      this.logger.warn(`Error getting channels for user ${userId}, using defaults:`, error);
      return [NOTIFICATION_CHANNEL.IN_APP];
    }
  }

  // =====================
  // Helper Methods - Value Formatting
  // =====================

  /**
   * Format field value for display in notifications
   */
  private async formatFieldValue(fieldName: string, value: any): Promise<string> {
    if (value === null || value === undefined) {
      return 'N/A';
    }

    const config = getFieldConfig(fieldName);

    try {
      switch (config?.formatter) {
        case 'formatDate':
          return this.formatDate(value);
        case 'formatStatus':
          return TASK_STATUS_LABELS[value] || value;
        case 'formatCommissionStatus':
          return COMMISSION_STATUS_LABELS[value] || value;
        case 'formatSector':
          return await this.formatSector(value);
        case 'formatCustomer':
          return await this.formatCustomer(value);
        case 'formatPaint':
          return await this.formatPaint(value);
        case 'formatContact':
          return this.formatContact(value);
        default:
          return this.formatDefaultValue(value);
      }
    } catch (error) {
      this.logger.warn(`Error formatting field ${fieldName}:`, error);
      return String(value);
    }
  }

  /**
   * Format date value
   */
  private formatDate(value: any): string {
    if (!value) return 'N/A';

    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value);

    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  /**
   * Format sector ID to name
   */
  private async formatSector(sectorId: string): Promise<string> {
    try {
      const sector = await this.prisma.sector.findUnique({
        where: { id: sectorId },
        select: { name: true },
      });
      return sector?.name || sectorId;
    } catch {
      return sectorId;
    }
  }

  /**
   * Format customer ID to name
   */
  private async formatCustomer(customerId: string): Promise<string> {
    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { fantasyName: true, corporateName: true },
      });
      return customer?.fantasyName || customer?.corporateName || customerId;
    } catch {
      return customerId;
    }
  }

  /**
   * Format paint ID to name
   */
  private async formatPaint(paintId: string): Promise<string> {
    try {
      const paint = await this.prisma.paint.findUnique({
        where: { id: paintId },
        select: { name: true, code: true },
      });
      return paint ? `${paint.name} (${paint.code})` : paintId;
    } catch {
      return paintId;
    }
  }

  /**
   * Format negotiating contact
   */
  private formatContact(value: any): string {
    if (typeof value === 'object' && value !== null) {
      const name = value.name || '';
      const phone = value.phone || '';
      return phone ? `${name} (${phone})` : name;
    }
    return String(value);
  }

  /**
   * Format default value (arrays, objects, primitives)
   */
  private formatDefaultValue(value: any): string {
    if (Array.isArray(value)) {
      return `${value.length} item(ns)`;
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    if (typeof value === 'boolean') {
      return value ? 'Sim' : 'Não';
    }

    return String(value);
  }

  /**
   * Interpolate message template with variables
   */
  private interpolateMessage(
    template: string,
    vars: Record<string, string | number>,
  ): string {
    let result = template;

    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
    }

    return result;
  }

  /**
   * Get the correct URL for a task based on its status
   * - PREPARATION → /producao/agenda/detalhes/{id}
   * - WAITING_PRODUCTION or IN_PRODUCTION → /producao/cronograma/detalhes/{id}
   * - COMPLETED → /producao/historico/detalhes/{id}
   */
  private getTaskUrl(task: any): string {
    const taskId = task.id;
    const status = task.status;

    switch (status) {
      case TASK_STATUS.PREPARATION:
        return `/producao/agenda/detalhes/${taskId}`;
      case TASK_STATUS.WAITING_PRODUCTION:
      case TASK_STATUS.IN_PRODUCTION:
        return `/producao/cronograma/detalhes/${taskId}`;
      case TASK_STATUS.COMPLETED:
        return `/producao/historico/detalhes/${taskId}`;
      case TASK_STATUS.CANCELLED:
        return `/producao/historico/detalhes/${taskId}`;
      default:
        // Default to agenda for unknown status
        return `/producao/agenda/detalhes/${taskId}`;
    }
  }

  /**
   * Get task notification metadata including web and mobile deep links
   * Returns actionUrl (web) and metadata with all link types for channel-specific routing
   *
   * Channel routing:
   * - IN_APP, EMAIL, DESKTOP_PUSH → Use webUrl (status-specific routes)
   * - WHATSAPP, MOBILE_PUSH → Use mobileUrl or universalLink
   *
   * @param task - Task object with id
   * @returns Object with actionUrl and metadata containing all link types
   */
  private getTaskNotificationMetadata(task: any): { actionUrl: string; metadata: any } {
    // Get status-specific web URL for backward compatibility
    const webUrl = this.getTaskUrl(task);

    // Generate deep links for mobile and universal linking
    const deepLinks = this.deepLinkService.generateTaskLinks(task.id);

    // Return actionUrl (web) and comprehensive metadata
    return {
      actionUrl: webUrl,
      metadata: {
        webUrl,                        // Status-specific web route
        mobileUrl: deepLinks.mobile,   // Mobile app deep link (custom scheme)
        universalLink: deepLinks.universalLink, // Universal link (HTTPS for mobile)
        taskId: task.id,               // For reference
        taskStatus: task.status,       // For reference
      },
    };
  }
}
