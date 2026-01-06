import { Task, User } from '../../../types';
import { TASK_STATUS } from '../../../constants/enums';

/**
 * Event emitted when a new task is created
 */
export class TaskCreatedEvent {
  constructor(
    public readonly task: Task,
    public readonly createdBy: User,
  ) {}
}

/**
 * Event emitted when task status changes
 */
export class TaskStatusChangedEvent {
  constructor(
    public readonly task: Task,
    public readonly oldStatus: TASK_STATUS,
    public readonly newStatus: TASK_STATUS,
    public readonly changedBy: User,
  ) {}
}

/**
 * Event emitted when any task field is updated
 */
export class TaskFieldUpdatedEvent {
  constructor(
    public readonly task: Task,
    public readonly fieldName: string,
    public readonly oldValue: any,
    public readonly newValue: any,
    public readonly updatedBy: User,
  ) {}
}

/**
 * Event emitted when task field changes are detected by field tracker
 * Includes detailed information about file array changes
 */
export class TaskFieldChangedEvent {
  constructor(
    public readonly task: Task,
    public readonly field: string,
    public readonly oldValue: any,
    public readonly newValue: any,
    public readonly changedBy: string,
    public readonly isFileArray?: boolean,
    public readonly fileChange?: {
      field: string;
      added: number;
      removed: number;
      addedFiles?: any[];
      removedFiles?: any[];
      changedAt: Date;
      changedBy: string;
    },
  ) {}
}

/**
 * Event emitted when task deadline is approaching
 */
export class TaskDeadlineApproachingEvent {
  constructor(
    public readonly task: Task,
    public readonly daysRemaining: number,
  ) {}
}

/**
 * Event emitted when task is overdue
 */
export class TaskOverdueEvent {
  constructor(
    public readonly task: Task,
    public readonly daysOverdue: number,
  ) {}
}
