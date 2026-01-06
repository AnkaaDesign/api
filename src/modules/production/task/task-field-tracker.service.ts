import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { Task } from '../../../types';

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
}

/**
 * Fields that should be tracked for changes
 */
const TRACKED_FIELDS = [
  'status',
  'term',
  'forecastDate',
  'sectorId',
  'commission',
  'negotiatingWith',
  'artworks', // array of files
  'budgets', // array of files
  'invoices', // array of files
  'receipts', // array of files
  'priority',
  'details',
  'entryDate',
  'startedAt',
  'finishedAt',
  'customerId',
  'invoiceToId',
  'paintId',
  'serialNumber',
] as const;

/**
 * File array fields that require special handling
 */
const FILE_ARRAY_FIELDS = [
  'artworks',
  'budgets',
  'invoices',
  'receipts',
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

  constructor(@Inject('EventEmitter') private readonly eventEmitter: EventEmitter) {}

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
      const oldValue = (oldTask as any)[field];
      const newValue = (newTask as any)[field];

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

    // Handle objects (like negotiatingWith)
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
      // Get all keys from both objects
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

      // Compare values for each key
      for (const key of oldKeys) {
        if (this.hasChanged(oldObj[key], newObj[key])) {
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

    for (const change of changes) {
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

      if (fileChange.added > 0 && fileChange.removed > 0) {
        return `${fileChange.added} arquivo(s) adicionado(s), ${fileChange.removed} arquivo(s) removido(s)`;
      } else if (fileChange.added > 0) {
        return `${fileChange.added} arquivo(s) adicionado(s)`;
      } else if (fileChange.removed > 0) {
        return `${fileChange.removed} arquivo(s) removido(s)`;
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
      return 'N/A';
    }

    if (Array.isArray(value)) {
      return `${value.length} item(ns)`;
    }

    if (typeof value === 'object') {
      if (value instanceof Date) {
        return value.toLocaleDateString('pt-BR');
      }
      return JSON.stringify(value);
    }

    return String(value);
  }
}
