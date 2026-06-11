import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { Task } from '../../../types';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';

/**
 * Interface representing a single field change
 */
export interface FieldChange {
  field: string;
  oldValue: any;
  newValue: any;
  changedAt: Date;
  changedBy: string;
}

/**
 * Interface for file array change details
 */
export interface FileArrayChange {
  field: string;
  added: number;
  removed: number;
  addedFiles?: any[];
  removedFiles?: any[];
  changedAt: Date;
  changedBy: string;
}

/**
 * Event payload for task field changes
 */
export interface TaskFieldChangedEvent {
  task: Task;
  field: string;
  oldValue: any;
  newValue: any;
  changedBy: string;
  isFileArray?: boolean;
  fileChange?: FileArrayChange;
  /**
   * Present only on the synthetic 'truck.layout' consolidated event. Human-readable
   * PT-BR summary listing which truck sides had their layout changed.
   */
  layoutChangeSummary?: string;
}

/**
 * Fields that should be tracked for changes
 * NOTE: 'status' field is excluded because it has its own dedicated
 * event handler (task.status.changed) in task.service.ts that provides
 * richer context and better notification formatting. Including it here
 * would cause duplicate notifications.
 */
const TRACKED_FIELDS = [
  // 'status', // EXCLUDED - Has dedicated task.status.changed event handler
  'name',
  'term',
  'forecastDate',
  'sectorId',
  'bonification',
  'responsibles',
  'artworks', // array of files
  'budgets', // array of files
  'invoices', // array of files
  'receipts', // array of files
  'bankSlips', // array of files
  'baseFiles', // array of files
  'logoPaints', // array of files/paints
  'reimbursements', // array of files
  'invoiceReimbursements', // array of files
  'details',
  'observation',
  'entryDate',
  'startedAt',
  'finishedAt',
  'customerId',
  'paintId',
  'serialNumber',
  // Truck fields (will be tracked when truck is updated as part of task)
  'truck.plate',
  'truck.chassisNumber',
  'truck.category',
  'truck.implementType',
  'truck.spot',
  // Truck layout references (tracks when layouts are assigned/changed)
  'truck.leftSideLayoutId',
  'truck.rightSideLayoutId',
  'truck.backSideLayoutId',
] as const;

/**
 * Truck layout side fields. When more than one of these change in the same task
 * update, they are collapsed into a single synthetic 'truck.layout' field so that
 * only ONE consolidated notification is emitted (instead of one per side).
 */
const TRUCK_LAYOUT_SIDE_FIELDS: Record<string, string> = {
  'truck.leftSideLayoutId': 'Motorista',
  'truck.rightSideLayoutId': 'Sapo',
  'truck.backSideLayoutId': 'Traseira',
};

/**
 * File array fields that require special handling
 */
const FILE_ARRAY_FIELDS = [
  'artworks',
  'budgets',
  'invoices',
  'receipts',
  'bankSlips',
  'baseFiles',
  'logoPaints',
  'reimbursements',
  'invoiceReimbursements',
] as const;

/**
 * Task Field Tracker Service
 *
 * Provides efficient field-level change detection and tracking for tasks.
 * Handles primitive values, objects, and arrays (especially file arrays).
 */
@Injectable()
export class TaskFieldTrackerService {
  private readonly logger = new Logger(TaskFieldTrackerService.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly notificationDispatch: NotificationDispatchService,
  ) {}

  /**
   * Extract the set of responsible user IDs from a responsibles field value.
   * Handles both arrays of user objects ({ id }) and arrays of raw id strings.
   */
  private extractResponsibleIds(value: any): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((r: any) => (r && typeof r === 'object' ? r.id : r))
      .filter((id: any): id is string => typeof id === 'string' && id.length > 0);
  }

  /**
   * NEW key: task.assigned — targeted notification to the collaborators who were
   * NEWLY ADDED as responsibles for a task. Mirrors the deep-link convention used
   * by the other task field-change notifications. The broadcast
   * 'task.field.responsibles' event continues to fire separately (handled by the
   * caller / task.listener.ts); this only adds the targeted "you were assigned" ping.
   *
   * Wrapped so a dispatch failure never breaks the field-change flow.
   */
  private async dispatchTaskAssigned(
    task: Task,
    oldValue: any,
    newValue: any,
    changedBy: string,
  ): Promise<void> {
    try {
      const oldIds = new Set(this.extractResponsibleIds(oldValue));
      const newIds = this.extractResponsibleIds(newValue);
      const addedIds = newIds.filter(id => !oldIds.has(id));

      if (addedIds.length === 0) {
        return;
      }

      const taskName = (task as any)?.name || 'Tarefa';

      this.logger.log(
        `[task.assigned] Dispatching to ${addedIds.length} newly added responsible(s) for task ${task.id}`,
      );

      await this.notificationDispatch.dispatchByConfigurationToUsers(
        'task.assigned',
        changedBy || 'system',
        {
          entityType: 'Task',
          entityId: task.id,
          action: 'assigned',
          data: {
            taskId: task.id,
            taskName,
            serialNumber: (task as any)?.serialNumber,
            taskSectorId: (task as any)?.sectorId || null,
          },
          overrides: {
            title: 'Você foi adicionado(a) a uma tarefa',
            body: `Você foi adicionado(a) como responsável pela tarefa "${taskName}".`,
            webUrl: `/producao/cronograma/detalhes/${task.id}`,
            mobileUrl: `/(tabs)/producao/cronograma/detalhes/${task.id}`,
            relatedEntityType: 'Task',
          },
        },
        addedIds,
      );
    } catch (error) {
      this.logger.error(
        `[task.assigned] Failed to dispatch task.assigned notification for task ${task.id}:`,
        error,
      );
    }
  }

  /**
   * Track all field changes between old and new task states
   *
   * @param taskId - The task ID
   * @param oldTask - Previous task state
   * @param newTask - New task state
   * @param userId - User making the changes
   * @returns Array of detected changes
   */
  async trackChanges(
    taskId: string,
    oldTask: Task,
    newTask: Task,
    userId: string,
  ): Promise<FieldChange[]> {
    const changes: FieldChange[] = [];
    const now = new Date();

    this.logger.debug(`Tracking changes for task ${taskId} by user ${userId}`);

    for (const field of TRACKED_FIELDS) {
      // Handle nested fields (e.g., 'truck.plate')
      let oldValue: any;
      let newValue: any;

      if (field.includes('.')) {
        const [parent, child] = field.split('.');
        oldValue = (oldTask as any)[parent]?.[child];
        newValue = (newTask as any)[parent]?.[child];
      } else {
        oldValue = (oldTask as any)[field];
        newValue = (newTask as any)[field];
      }

      if (this.hasChanged(oldValue, newValue, field)) {
        changes.push({
          field,
          oldValue,
          newValue,
          changedAt: now,
          changedBy: userId,
        });

        this.logger.debug(
          `Field changed: ${field} | Old: ${JSON.stringify(oldValue)} | New: ${JSON.stringify(newValue)}`,
        );
      }
    }

    this.logger.log(`Detected ${changes.length} field changes for task ${taskId}`);

    return changes;
  }

  /**
   * Determine if a field value has changed
   * Handles primitives, objects, arrays, and null/undefined values
   *
   * @param oldValue - Previous value
   * @param newValue - New value
   * @param fieldName - Name of the field (for special handling)
   * @returns true if values are different
   */
  private hasChanged(oldValue: any, newValue: any, fieldName?: string): boolean {
    // Bonification field normalization: treat null/undefined as NO_BONIFICATION
    // This prevents false positive changes when both display as "Sem Bonificação"
    if (fieldName === 'bonification') {
      const normalizedOld =
        oldValue === null || oldValue === undefined ? 'NO_BONIFICATION' : oldValue;
      const normalizedNew =
        newValue === null || newValue === undefined ? 'NO_BONIFICATION' : newValue;
      return normalizedOld !== normalizedNew;
    }

    // Handle null/undefined cases
    if (oldValue === undefined && newValue === undefined) return false;
    if (oldValue === null && newValue === null) return false;
    if (oldValue === undefined || oldValue === null)
      return newValue !== undefined && newValue !== null;
    if (newValue === undefined || newValue === null)
      return oldValue !== undefined && oldValue !== null;

    // Handle arrays (especially file arrays)
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      return this.hasArrayChanged(oldValue, newValue, fieldName);
    }

    // Handle arrays where one is array and other isn't
    if (Array.isArray(oldValue) || Array.isArray(newValue)) {
      return true;
    }

    // Handle Date objects
    if (oldValue instanceof Date && newValue instanceof Date) {
      return oldValue.getTime() !== newValue.getTime();
    }

    if (oldValue instanceof Date || newValue instanceof Date) {
      // Convert both to date for comparison
      const oldDate = new Date(oldValue);
      const newDate = new Date(newValue);
      return oldDate.getTime() !== newDate.getTime();
    }

    // Handle objects
    if (typeof oldValue === 'object' && typeof newValue === 'object') {
      return this.hasObjectChanged(oldValue, newValue);
    }

    // Handle objects where one is object and other isn't
    if (typeof oldValue === 'object' || typeof newValue === 'object') {
      return true;
    }

    // Primitive comparison
    return oldValue !== newValue;
  }

  /**
   * Detect changes in arrays with optimized comparison
   *
   * @param oldArray - Previous array
   * @param newArray - New array
   * @param fieldName - Field name for context
   * @returns true if arrays are different
   */
  private hasArrayChanged(oldArray: any[], newArray: any[], fieldName?: string): boolean {
    // Quick length check
    if (oldArray.length !== newArray.length) {
      return true;
    }

    // Empty arrays are equal
    if (oldArray.length === 0) {
      return false;
    }

    // For file arrays, compare by ID if available
    if (fieldName && this.isFileArrayField(fieldName)) {
      return this.hasFileArrayChanged(oldArray, newArray);
    }

    // Deep comparison for other arrays
    try {
      return JSON.stringify(oldArray) !== JSON.stringify(newArray);
    } catch (error) {
      this.logger.warn(
        `Failed to compare arrays for field ${fieldName}, falling back to reference comparison`,
      );
      return true;
    }
  }

  /**
   * Specialized comparison for file arrays
   * Compares based on file IDs for efficiency
   *
   * @param oldFiles - Previous files
   * @param newFiles - New files
   * @returns true if file arrays differ
   */
  private hasFileArrayChanged(oldFiles: any[], newFiles: any[]): boolean {
    if (oldFiles.length !== newFiles.length) {
      return true;
    }

    // Extract and sort IDs for comparison
    const oldIds = oldFiles
      .map(f => f?.id || f)
      .filter(Boolean)
      .sort();
    const newIds = newFiles
      .map(f => f?.id || f)
      .filter(Boolean)
      .sort();

    if (oldIds.length !== newIds.length) {
      return true;
    }

    return !oldIds.every((id, index) => id === newIds[index]);
  }

  /**
   * Deep comparison for objects
   *
   * @param oldObj - Previous object
   * @param newObj - New object
   * @returns true if objects are different
   */
  private hasObjectChanged(oldObj: any, newObj: any): boolean {
    try {
      // Check if object has only null/undefined values (treat as empty)
      const isEmptyObject = (obj: any): boolean => {
        if (!obj || typeof obj !== 'object') return true;
        const values = Object.values(obj);
        // Empty object {} has no values, so every returns true - treat as empty
        if (values.length === 0) return true;
        return values.every(v => v === null || v === undefined);
      };

      const oldIsEmpty = !oldObj || isEmptyObject(oldObj);
      const newIsEmpty = !newObj || isEmptyObject(newObj);

      // Both empty = no change
      if (oldIsEmpty && newIsEmpty) {
        this.logger.debug('Both objects empty - no change detected');
        return false;
      }

      // One empty and other not = changed
      if (oldIsEmpty !== newIsEmpty) {
        this.logger.debug('One object empty, other not - change detected');
        return true;
      }

      // Use stable JSON comparison to avoid false positives from object instance differences
      const sortedOldJson = JSON.stringify(oldObj, Object.keys(oldObj || {}).sort());
      const sortedNewJson = JSON.stringify(newObj, Object.keys(newObj || {}).sort());

      const hasChanged = sortedOldJson !== sortedNewJson;
      if (hasChanged) {
        this.logger.debug(
          `Object content changed - oldJson: ${sortedOldJson}, newJson: ${sortedNewJson}`,
        );
      }

      return hasChanged;
    } catch (error) {
      this.logger.warn('Failed to compare objects with JSON stringify, comparing values directly');

      try {
        // Fallback: compare key by key
        const oldKeys = Object.keys(oldObj || {}).sort();
        const newKeys = Object.keys(newObj || {}).sort();

        // Different number of keys = changed
        if (oldKeys.length !== newKeys.length) {
          return true;
        }

        // Check if all keys are the same
        if (!oldKeys.every((key, index) => key === newKeys[index])) {
          return true;
        }

        // Compare values for each key using strict equality
        for (const key of oldKeys) {
          if (oldObj[key] !== newObj[key]) {
            return true;
          }
        }

        return false;
      } catch (fallbackError) {
        this.logger.error('Both JSON and direct comparison failed, assuming changed');
        return true; // If all else fails, assume changed
      }
    }
  }

  /**
   * Analyze file array changes to detect additions and removals
   *
   * @param oldFiles - Previous files
   * @param newFiles - New files
   * @returns Details about added and removed files
   */
  analyzeFileArrayChange(oldFiles: any[], newFiles: any[]): FileArrayChange {
    const oldIds = new Set(oldFiles.map(f => f?.id || f).filter(Boolean));
    const newIds = new Set(newFiles.map(f => f?.id || f).filter(Boolean));

    const addedIds = Array.from(newIds).filter(id => !oldIds.has(id));
    const removedIds = Array.from(oldIds).filter(id => !newIds.has(id));

    const addedFiles = newFiles.filter(f => addedIds.includes(f?.id || f));
    const removedFiles = oldFiles.filter(f => removedIds.includes(f?.id || f));

    return {
      field: '', // Will be set by caller
      added: addedIds.length,
      removed: removedIds.length,
      addedFiles,
      removedFiles,
      changedAt: new Date(),
      changedBy: '', // Will be set by caller
    };
  }

  /**
   * Check if a field is a file array field
   *
   * @param fieldName - Field name to check
   * @returns true if field contains file arrays
   */
  private isFileArrayField(fieldName: string): boolean {
    return FILE_ARRAY_FIELDS.includes(fieldName as any);
  }

  /**
   * Emit field change events for all detected changes
   * Handles file arrays specially to provide detailed change information
   *
   * @param task - Updated task
   * @param changes - Array of field changes
   * @param oldTask - Previous task state (for file array analysis)
   */
  async emitFieldChangeEvents(task: Task, changes: FieldChange[], oldTask?: Task): Promise<void> {
    this.logger.debug(`Emitting ${changes.length} field change events for task ${task.id}`);

    // Detect truck layout side changes. When MORE THAN ONE side changed in the same
    // update, collapse them into a single synthetic 'truck.layout' event so only ONE
    // consolidated notification fires instead of one per side.
    // Collapse whenever ANY layout side changed (one OR more) so the legacy per-side
    // configs (task.field.truck.*SideLayoutId) go fully dormant and we always emit the
    // consolidated 'truck.layout' event instead.
    const layoutSideChanges = changes.filter(c => TRUCK_LAYOUT_SIDE_FIELDS[c.field]);
    const shouldCollapseLayout = layoutSideChanges.length >= 1;

    let remainingChanges = changes;
    if (shouldCollapseLayout) {
      const changedSideLabels = layoutSideChanges.map(c => TRUCK_LAYOUT_SIDE_FIELDS[c.field]);
      const layoutChangeSummary = changedSideLabels.join(', ');

      this.logger.log(
        `Collapsing ${layoutSideChanges.length} truck layout side changes into a single 'truck.layout' event (${layoutChangeSummary})`,
      );

      // Emit one consolidated event for the truck layout
      const layoutEvent: TaskFieldChangedEvent = {
        task,
        field: 'truck.layout',
        oldValue: null,
        newValue: null,
        changedBy: layoutSideChanges[0].changedBy,
        isFileArray: false,
        layoutChangeSummary,
      };
      this.eventEmitter.emit('task.field.changed', layoutEvent);
      this.logger.debug(`Emitted consolidated task.field.changed event for field: truck.layout`);

      // Remove the per-side changes so they don't each emit their own notification
      remainingChanges = changes.filter(c => !TRUCK_LAYOUT_SIDE_FIELDS[c.field]);
    }

    for (const change of remainingChanges) {
      let fileChange: FileArrayChange | undefined;
      let isFileArray = false;

      // Check if this is a file array field
      if (this.isFileArrayField(change.field)) {
        isFileArray = true;

        // Analyze file array changes
        const oldFiles = change.oldValue || [];
        const newFiles = change.newValue || [];
        fileChange = this.analyzeFileArrayChange(oldFiles, newFiles);
        fileChange.field = change.field;
        fileChange.changedBy = change.changedBy;
        fileChange.changedAt = change.changedAt;

        this.logger.debug(
          `File array change detected for ${change.field}: +${fileChange.added} -${fileChange.removed}`,
        );
      }

      // Emit the event
      const event: TaskFieldChangedEvent = {
        task,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedBy: change.changedBy,
        isFileArray,
        fileChange,
      };

      this.eventEmitter.emit('task.field.changed', event);

      this.logger.debug(`Emitted task.field.changed event for field: ${change.field}`);

      // NEW key: task.assigned — in addition to the broadcast 'task.field.responsibles'
      // notification emitted above, ping the collaborators who were NEWLY ADDED as
      // responsibles for this task (diff old vs new). Fire-and-forget; never blocks.
      if (change.field === 'responsibles') {
        await this.dispatchTaskAssigned(task, change.oldValue, change.newValue, change.changedBy);
      }
    }

    this.logger.log(`Successfully emitted all field change events for task ${task.id}`);
  }

  /**
   * Get a human-readable description of the change
   * Useful for logging and notifications
   *
   * @param change - Field change object
   * @returns Human-readable description
   */
  getChangeDescription(change: FieldChange): string {
    if (this.isFileArrayField(change.field)) {
      const fileChange = this.analyzeFileArrayChange(change.oldValue || [], change.newValue || []);
      const parts: string[] = [];

      if (fileChange.added > 0) {
        parts.push(
          fileChange.added === 1
            ? '1 arquivo adicionado'
            : `${fileChange.added} arquivos adicionados`,
        );
      }

      if (fileChange.removed > 0) {
        parts.push(
          fileChange.removed === 1
            ? '1 arquivo removido'
            : `${fileChange.removed} arquivos removidos`,
        );
      }

      if (parts.length > 0) {
        return parts.join(' e ');
      }
    }

    return `Alterado de "${this.formatValue(change.oldValue)}" para "${this.formatValue(change.newValue)}"`;
  }

  /**
   * Format a value for display
   *
   * @param value - Value to format
   * @returns Formatted string
   */
  private formatValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    // Handle Date objects
    if (value instanceof Date) {
      return this.formatDatePtBR(value);
    }

    // Handle date strings (ISO format)
    if (typeof value === 'string' && this.isISODateString(value)) {
      return this.formatDatePtBR(new Date(value));
    }

    // Handle arrays
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return 'nenhum';
      }
      return value.length === 1 ? '1 item' : `${value.length} itens`;
    }

    // Handle objects with name property
    if (typeof value === 'object') {
      if (value.name) {
        return String(value.name);
      }
      if (value.fantasyName) {
        return String(value.fantasyName);
      }
      // Don't stringify complex objects
      return '';
    }

    // Handle booleans
    if (typeof value === 'boolean') {
      return value ? 'Sim' : 'Não';
    }

    return String(value);
  }

  /**
   * Format a Date to Brazilian Portuguese format
   */
  private formatDatePtBR(date: Date): string {
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  }

  /**
   * Check if a string looks like an ISO date
   */
  private isISODateString(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(value);
  }
}
