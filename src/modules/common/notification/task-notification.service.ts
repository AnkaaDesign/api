import { Injectable, Logger } from '@nestjs/common';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationService } from './notification.service';
import { DeepLinkService, DeepLinkEntity } from './deep-link.service';
import { NOTIFICATION_TYPE, NOTIFICATION_IMPORTANCE, NOTIFICATION_CHANNEL, TASK_STATUS } from '../../../constants';
import type { Task } from '../../../types';

/**
 * Interface representing a single field change
 */
export interface TaskFieldChange {
  field: string;
  fieldLabel: string;
  oldValue: any;
  newValue: any;
  formattedOldValue: string;
  formattedNewValue: string;
  changedAt: Date;
}

/**
 * Supported task fields for change tracking
 */
export enum TaskField {
  TITLE = 'name',
  DESCRIPTION = 'details',
  STATUS = 'status',
  PRIORITY = 'priority',
  ASSIGNED_TO = 'sectorId',
  DUE_DATE = 'term',
  TAGS = 'tags',
  ATTACHMENTS = 'artworks',
  COMMENTS = 'observation',
}

/**
 * Portuguese labels for task fields
 */
const FIELD_LABELS: Record<string, string> = {
  name: 'Título',
  details: 'Descrição',
  status: 'Status',
  priority: 'Prioridade',
  sectorId: 'Responsável',
  term: 'Prazo',
  tags: 'Etiquetas',
  artworks: 'Anexos',
  observation: 'Comentários',
  // Additional fields
  commission: 'Comissão',
  serialNumber: 'Número de Série',
  entryDate: 'Data de Entrada',
  startedAt: 'Data de Início',
  finishedAt: 'Data de Conclusão',
  forecastDate: 'Data Prevista',
  paintId: 'Pintura',
  customerId: 'Cliente',
  invoiceToId: 'Faturar Para',
  negotiatingWith: 'Negociando Com',
  budgets: 'Orçamentos',
  invoices: 'Faturas',
  receipts: 'Recibos',
  reimbursements: 'Reembolsos',
  invoiceReimbursements: 'Faturas de Reembolso',
};

/**
 * Task field notification event types
 * Used for user preferences to enable/disable specific field notifications
 */
export const TASK_FIELD_EVENT_TYPES = {
  TITLE_CHANGED: 'task.field.name',
  DESCRIPTION_CHANGED: 'task.field.details',
  STATUS_CHANGED: 'task.field.status',
  PRIORITY_CHANGED: 'task.field.priority',
  ASSIGNED_TO_CHANGED: 'task.field.sectorId',
  DUE_DATE_CHANGED: 'task.field.term',
  TAGS_CHANGED: 'task.field.tags',
  ATTACHMENTS_CHANGED: 'task.field.artworks',
  COMMENTS_CHANGED: 'task.field.observation',
};

/**
 * Aggregation window in milliseconds (e.g., 5 minutes)
 */
const AGGREGATION_WINDOW_MS = 5 * 60 * 1000;

/**
 * Task Notification Service
 *
 * Provides field-level change tracking and notification creation for tasks.
 * Tracks individual field changes, respects user preferences, and can aggregate
 * multiple changes into single notifications.
 */
@Injectable()
export class TaskNotificationService {
  private readonly logger = new Logger(TaskNotificationService.name);

  // In-memory storage for pending aggregations
  // In production, this should use Redis or a database
  private pendingAggregations: Map<
    string,
    {
      taskId: string;
      taskTitle: string;
      taskStatus: string;
      changes: TaskFieldChange[];
      userId: string;
      actorId?: string;
      firstChangeAt: Date;
      timeoutId: NodeJS.Timeout;
    }
  > = new Map();

  constructor(
    private readonly preferenceService: NotificationPreferenceService,
    private readonly notificationService: NotificationService,
    private readonly deepLinkService: DeepLinkService,
  ) {}

  /**
   * Get the correct web URL for a task based on its status
   * - PREPARATION → /producao/agenda/detalhes/{id}
   * - WAITING_PRODUCTION or IN_PRODUCTION → /producao/cronograma/detalhes/{id}
   * - COMPLETED or CANCELLED → /producao/historico/detalhes/{id}
   */
  private getTaskWebPath(taskOrId: Task | string, status?: string): string {
    const taskId = typeof taskOrId === 'string' ? taskOrId : taskOrId.id;
    const taskStatus = status || (typeof taskOrId === 'object' ? taskOrId.status : undefined);

    switch (taskStatus) {
      case TASK_STATUS.PREPARATION:
        return `/producao/agenda/detalhes/${taskId}`;
      case TASK_STATUS.WAITING_PRODUCTION:
      case TASK_STATUS.IN_PRODUCTION:
        return `/producao/cronograma/detalhes/${taskId}`;
      case TASK_STATUS.COMPLETED:
      case TASK_STATUS.CANCELLED:
        return `/producao/historico/detalhes/${taskId}`;
      default:
        // Default to agenda for unknown status
        return `/producao/agenda/detalhes/${taskId}`;
    }
  }

  /**
   * Generate notification metadata with proper deep links for a task
   * Includes webUrl, mobileUrl, universalLink, entityType, and entityId
   * This ensures mobile app can properly navigate to the task
   */
  private getTaskNotificationMetadata(taskOrId: Task | string, status?: string): {
    actionUrl: string;
    metadata: {
      webUrl: string;
      mobileUrl: string;
      universalLink: string;
      entityType: string;
      entityId: string;
    };
  } {
    const taskId = typeof taskOrId === 'string' ? taskOrId : taskOrId.id;

    // Generate deep links using DeepLinkService
    const deepLinks = this.deepLinkService.generateTaskLinks(taskId);

    // Get the status-specific web path (for backward compatibility)
    const webPath = this.getTaskWebPath(taskOrId, status);

    return {
      actionUrl: webPath, // Web path for backward compatibility
      metadata: {
        webUrl: deepLinks.web,              // Full web URL
        mobileUrl: deepLinks.mobile,         // Mobile deep link (ankaadesign://task/UUID)
        universalLink: deepLinks.universalLink || '', // Universal link
        entityType: 'Task',                  // Entity type for mobile navigation
        entityId: taskId,                    // Entity ID for mobile navigation
      },
    };
  }

  /**
   * Track changes between old and new task states
   * Detects which fields have changed and returns detailed change information
   *
   * @param oldTask - Previous task state
   * @param newTask - New task state
   * @returns Array of detected field changes
   */
  trackTaskChanges(oldTask: Task, newTask: Task): TaskFieldChange[] {
    const changes: TaskFieldChange[] = [];
    const now = new Date();

    // Get all tracked fields
    const trackedFields = Object.keys(FIELD_LABELS);

    this.logger.debug(`Tracking changes for task ${newTask.id}`);

    for (const field of trackedFields) {
      const oldValue = (oldTask as any)?.[field];
      const newValue = (newTask as any)?.[field];

      // Check if value has changed
      if (this.hasValueChanged(oldValue, newValue, field)) {
        const fieldLabel = this.getFieldLabel(field);
        const formattedOldValue = this.formatFieldValue(field, oldValue);
        const formattedNewValue = this.formatFieldValue(field, newValue);

        changes.push({
          field,
          fieldLabel,
          oldValue,
          newValue,
          formattedOldValue,
          formattedNewValue,
          changedAt: now,
        });

        this.logger.debug(
          `Field "${fieldLabel}" changed: "${formattedOldValue}" → "${formattedNewValue}"`,
        );
      }
    }

    this.logger.log(`Detected ${changes.length} field changes for task ${newTask.id}`);

    return changes;
  }

  /**
   * Create individual notification for each changed field
   * Respects user preferences for each field type
   *
   * @param task - Updated task
   * @param changes - Array of field changes
   * @param userId - User to notify
   * @param changedBy - User who made the changes (display name)
   * @param actorId - ID of the user who performed the action (for self-action filtering)
   * @returns Array of created notification IDs
   */
  async createFieldChangeNotifications(
    task: Task,
    changes: TaskFieldChange[],
    userId: string,
    changedBy: string,
    actorId?: string,
  ): Promise<string[]> {
    const notificationIds: string[] = [];

    this.logger.debug(
      `Creating field change notifications for task ${task.id}, user ${userId}`,
    );

    for (const change of changes) {
      // Check if user wants notifications for this field
      const shouldNotify = await this.shouldNotifyField(userId, change.field);

      if (!shouldNotify) {
        this.logger.debug(
          `Skipping notification for field "${change.fieldLabel}" - disabled in user preferences`,
        );
        continue;
      }

      try {
        // Format notification message
        const message = this.formatFieldChange(task.name, change);

        // Get user's preferred channels for this field
        const eventType = this.getFieldEventType(change.field);
        const channels = await this.preferenceService.getChannelsForEvent(
          userId,
          NOTIFICATION_TYPE.TASK,
          eventType,
        );

        // Generate proper deep links and metadata for the task
        const { actionUrl, metadata: linkMetadata } = this.getTaskNotificationMetadata(task);

        // Create notification with proper deep links
        const notification = await this.notificationService.createNotification({
          type: NOTIFICATION_TYPE.TASK,
          title: `Alteração em tarefa: ${task.name}`,
          body: message,
          importance: this.determineFieldImportance(change.field),
          userId,
          actionUrl,
          metadata: {
            ...linkMetadata, // Include webUrl, mobileUrl, universalLink, entityType, entityId
            field: change.field,
            fieldLabel: change.fieldLabel,
            oldValue: change.formattedOldValue,
            newValue: change.formattedNewValue,
            changedBy,
            actorId: actorId || undefined, // User who performed the action (for filtering)
          },
        });

        notificationIds.push(notification.data.id);

        this.logger.debug(
          `Created notification ${notification.data.id} for field "${change.fieldLabel}"`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to create notification for field "${change.fieldLabel}"`,
          error,
        );
      }
    }

    this.logger.log(
      `Created ${notificationIds.length} field change notifications for task ${task.id}`,
    );

    return notificationIds;
  }

  /**
   * Format a field change into a user-friendly message
   *
   * @param taskTitle - Title of the task
   * @param change - Field change details
   * @returns Formatted message string
   */
  formatFieldChange(taskTitle: string, change: TaskFieldChange): string {
    return `Campo ${change.fieldLabel} alterado em ${taskTitle}: ${change.formattedOldValue} → ${change.formattedNewValue}`;
  }

  /**
   * Get Portuguese label for a field name
   *
   * @param fieldName - Field name to lookup
   * @returns Portuguese label or capitalized field name if not found
   */
  getFieldLabel(fieldName: string): string {
    return FIELD_LABELS[fieldName] || this.capitalizeFirst(fieldName);
  }

  /**
   * Check if user wants notifications for a specific field
   * Checks user's notification preferences
   *
   * @param userId - User ID to check preferences for
   * @param fieldName - Field name to check
   * @returns True if user wants notifications for this field
   */
  async shouldNotifyField(userId: string, fieldName: string): Promise<boolean> {
    try {
      // Get event type for this field
      const eventType = this.getFieldEventType(fieldName);

      // Get user's channels for this event
      const channels = await this.preferenceService.getChannelsForEvent(
        userId,
        NOTIFICATION_TYPE.TASK,
        eventType,
      );

      // User wants notifications if they have at least one channel enabled
      return channels.length > 0;
    } catch (error) {
      this.logger.error(
        `Failed to check notification preference for field "${fieldName}", user ${userId}`,
        error,
      );
      // Default to true if we can't check preferences
      return true;
    }
  }

  /**
   * Aggregate multiple field changes into a single notification
   * Groups changes within a time window to avoid notification spam
   *
   * @param task - Updated task
   * @param changes - Array of field changes
   * @param userId - User to notify
   * @param changedBy - User who made the changes (display name)
   * @param actorId - ID of the user who performed the action (for self-action filtering)
   * @param immediate - If true, send immediately; otherwise wait for aggregation window
   */
  async aggregateFieldChanges(
    task: Task,
    changes: TaskFieldChange[],
    userId: string,
    changedBy: string,
    actorId?: string,
    immediate: boolean = false,
  ): Promise<void> {
    const aggregationKey = `${task.id}-${userId}`;

    // Filter changes based on user preferences
    const filteredChanges: TaskFieldChange[] = [];
    for (const change of changes) {
      if (await this.shouldNotifyField(userId, change.field)) {
        filteredChanges.push(change);
      }
    }

    if (filteredChanges.length === 0) {
      this.logger.debug(`No changes to notify for user ${userId}`);
      return;
    }

    // Check if there's already a pending aggregation
    const existing = this.pendingAggregations.get(aggregationKey);

    if (existing) {
      // Add new changes to existing aggregation
      existing.changes.push(...filteredChanges);

      // Clear existing timeout if sending immediately
      if (immediate) {
        clearTimeout(existing.timeoutId);
        await this.sendAggregatedNotification(aggregationKey);
      }

      this.logger.debug(
        `Added ${filteredChanges.length} changes to existing aggregation for task ${task.id}, user ${userId}`,
      );
    } else {
      // Create new aggregation
      const timeoutId = immediate
        ? setTimeout(() => {}, 0) // Dummy timeout for immediate send
        : setTimeout(() => {
            this.sendAggregatedNotification(aggregationKey);
          }, AGGREGATION_WINDOW_MS);

      this.pendingAggregations.set(aggregationKey, {
        taskId: task.id,
        taskTitle: task.name,
        taskStatus: task.status,
        changes: filteredChanges,
        userId,
        actorId,
        firstChangeAt: new Date(),
        timeoutId,
      });

      this.logger.debug(
        `Created new aggregation for task ${task.id}, user ${userId} with ${filteredChanges.length} changes`,
      );

      // Send immediately if requested
      if (immediate) {
        await this.sendAggregatedNotification(aggregationKey);
      }
    }
  }

  /**
   * Send an aggregated notification for all pending changes
   *
   * @param aggregationKey - Key identifying the aggregation
   */
  private async sendAggregatedNotification(aggregationKey: string): Promise<void> {
    const aggregation = this.pendingAggregations.get(aggregationKey);

    if (!aggregation) {
      this.logger.warn(`No aggregation found for key ${aggregationKey}`);
      return;
    }

    // Remove from pending
    this.pendingAggregations.delete(aggregationKey);
    clearTimeout(aggregation.timeoutId);

    try {
      // Build aggregated message
      const changeCount = aggregation.changes.length;
      const uniqueFields = new Set(aggregation.changes.map(c => c.fieldLabel));
      const fieldList = Array.from(uniqueFields).join(', ');

      const title = `${changeCount} alterações em tarefa: ${aggregation.taskTitle}`;
      const message = `Campos alterados: ${fieldList}`;

      // Build detailed change list for metadata
      const changeDetails = aggregation.changes.map(c => ({
        field: c.field,
        fieldLabel: c.fieldLabel,
        oldValue: c.formattedOldValue,
        newValue: c.formattedNewValue,
      }));

      // Get user's preferred channels
      const channels = await this.preferenceService.getChannelsForEvent(
        aggregation.userId,
        NOTIFICATION_TYPE.TASK,
        'task.field.multiple', // Special event type for aggregated changes
      );

      // Generate proper deep links and metadata for the task
      const { actionUrl, metadata: linkMetadata } = this.getTaskNotificationMetadata(
        aggregation.taskId,
        aggregation.taskStatus,
      );

      // Create aggregated notification with proper deep links
      const notification = await this.notificationService.createNotification({
        type: NOTIFICATION_TYPE.TASK,
        title,
        body: message,
        importance: NOTIFICATION_IMPORTANCE.NORMAL,
        userId: aggregation.userId,
        actionUrl,
        metadata: {
          ...linkMetadata, // Include webUrl, mobileUrl, universalLink, entityType, entityId
          aggregated: true,
          changeCount,
          changes: changeDetails,
          firstChangeAt: aggregation.firstChangeAt,
          sentAt: new Date(),
          actorId: aggregation.actorId || undefined, // User who performed the action (for filtering)
        },
      });

      this.logger.log(
        `Sent aggregated notification ${notification.data.id} with ${changeCount} changes for task ${aggregation.taskId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send aggregated notification for task ${aggregation.taskId}`,
        error,
      );
    }
  }

  /**
   * Determine if a field value has changed
   * Handles primitives, objects, arrays, and null/undefined
   *
   * @param oldValue - Previous value
   * @param newValue - New value
   * @param fieldName - Field name for context
   * @returns True if values are different
   */
  private hasValueChanged(oldValue: any, newValue: any, fieldName?: string): boolean {
    // Handle null/undefined cases
    if (oldValue === undefined && newValue === undefined) return false;
    if (oldValue === null && newValue === null) return false;
    if (oldValue === undefined || oldValue === null)
      return newValue !== undefined && newValue !== null;
    if (newValue === undefined || newValue === null)
      return oldValue !== undefined && oldValue !== null;

    // Handle arrays
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      return this.hasArrayChanged(oldValue, newValue);
    }

    if (Array.isArray(oldValue) || Array.isArray(newValue)) {
      return true;
    }

    // Handle Date objects
    if (oldValue instanceof Date && newValue instanceof Date) {
      return oldValue.getTime() !== newValue.getTime();
    }

    if (oldValue instanceof Date || newValue instanceof Date) {
      const oldDate = new Date(oldValue);
      const newDate = new Date(newValue);
      return oldDate.getTime() !== newDate.getTime();
    }

    // Handle objects
    if (typeof oldValue === 'object' && typeof newValue === 'object') {
      return this.hasObjectChanged(oldValue, newValue);
    }

    if (typeof oldValue === 'object' || typeof newValue === 'object') {
      return true;
    }

    // Primitive comparison
    return oldValue !== newValue;
  }

  /**
   * Check if arrays have changed
   *
   * @param oldArray - Previous array
   * @param newArray - New array
   * @returns True if arrays are different
   */
  private hasArrayChanged(oldArray: any[], newArray: any[]): boolean {
    if (oldArray.length !== newArray.length) {
      return true;
    }

    if (oldArray.length === 0) {
      return false;
    }

    // For arrays of objects with IDs (like files), compare by ID
    if (oldArray[0]?.id !== undefined && newArray[0]?.id !== undefined) {
      const oldIds = oldArray.map(item => item.id).sort();
      const newIds = newArray.map(item => item.id).sort();
      return !oldIds.every((id, index) => id === newIds[index]);
    }

    // Deep comparison for other arrays
    try {
      return JSON.stringify(oldArray) !== JSON.stringify(newArray);
    } catch (error) {
      this.logger.warn('Failed to compare arrays, falling back to true');
      return true;
    }
  }

  /**
   * Check if objects have changed
   *
   * @param oldObj - Previous object
   * @param newObj - New object
   * @returns True if objects are different
   */
  private hasObjectChanged(oldObj: any, newObj: any): boolean {
    try {
      const oldKeys = Object.keys(oldObj || {}).sort();
      const newKeys = Object.keys(newObj || {}).sort();

      if (oldKeys.length !== newKeys.length) {
        return true;
      }

      if (!oldKeys.every((key, index) => key === newKeys[index])) {
        return true;
      }

      for (const key of oldKeys) {
        if (this.hasValueChanged(oldObj[key], newObj[key])) {
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.warn('Failed to compare objects, falling back to JSON comparison');
      return JSON.stringify(oldObj) !== JSON.stringify(newObj);
    }
  }

  /**
   * Format a field value for display
   *
   * @param fieldName - Field name for context
   * @param value - Value to format
   * @returns Formatted string
   */
  private formatFieldValue(fieldName: string, value: any): string {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return 'N/A';
    }

    // Handle arrays
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return 'Nenhum';
      }
      return `${value.length} item(ns)`;
    }

    // Handle dates
    if (value instanceof Date) {
      return value.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    }

    // Try to parse as date string
    if (typeof value === 'string' && this.isDateString(value)) {
      const date = new Date(value);
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    }

    // Handle objects
    if (typeof value === 'object') {
      // Special handling for negotiatingWith
      if (fieldName === 'negotiatingWith' && value.name) {
        return `${value.name}${value.phone ? ` (${value.phone})` : ''}`;
      }
      return JSON.stringify(value);
    }

    // Handle booleans
    if (typeof value === 'boolean') {
      return value ? 'Sim' : 'Não';
    }

    // Return as string
    return String(value);
  }

  /**
   * Check if a string looks like a date
   *
   * @param value - String to check
   * @returns True if string can be parsed as date
   */
  private isDateString(value: string): boolean {
    const date = new Date(value);
    return !isNaN(date.getTime()) && value.includes('-');
  }

  /**
   * Get event type for a field name
   * Used for checking user preferences
   *
   * @param fieldName - Field name
   * @returns Event type string
   */
  private getFieldEventType(fieldName: string): string {
    return `task.field.${fieldName}`;
  }

  /**
   * Determine notification importance based on field type
   *
   * @param fieldName - Field name
   * @returns Importance level
   */
  private determineFieldImportance(fieldName: string): NOTIFICATION_IMPORTANCE {
    // High importance fields
    const highImportanceFields = ['status', 'term', 'sectorId'];
    if (highImportanceFields.includes(fieldName)) {
      return NOTIFICATION_IMPORTANCE.HIGH;
    }

    // Normal importance for everything else
    return NOTIFICATION_IMPORTANCE.NORMAL;
  }

  /**
   * Capitalize first letter of a string
   *
   * @param str - String to capitalize
   * @returns Capitalized string
   */
  private capitalizeFirst(str: string): string {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Clean up any pending aggregations (useful for testing and shutdown)
   */
  async cleanup(): Promise<void> {
    const entries = Array.from(this.pendingAggregations.entries());
    for (const [key, aggregation] of entries) {
      clearTimeout(aggregation.timeoutId);
      await this.sendAggregatedNotification(key);
    }
    this.pendingAggregations.clear();
    this.logger.log('Cleaned up all pending aggregations');
  }
}
