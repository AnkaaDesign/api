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
 * Supports both day-based and hour-based notifications
 */
export class TaskDeadlineApproachingEvent {
  constructor(
    public readonly task: Task,
    public readonly daysRemaining: number,
    public readonly hoursRemaining?: number, // Optional: for hour-based notifications (e.g., 4 hours)
  ) {}

  /**
   * Get a human-readable time remaining string
   */
  getTimeRemainingLabel(): string {
    if (this.hoursRemaining !== undefined && this.hoursRemaining < 24) {
      return `${this.hoursRemaining} hora(s)`;
    }
    return `${this.daysRemaining} dia(s)`;
  }

  /**
   * Check if this is an urgent (hours-based) notification
   */
  isUrgent(): boolean {
    return this.hoursRemaining !== undefined && this.hoursRemaining <= 4;
  }
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

/**
 * Event emitted when task forecast date is approaching
 * Used for preparation tasks (status PREPARATION/WAITING_PRODUCTION)
 */
export class TaskForecastApproachingEvent {
  constructor(
    public readonly task: Task,
    public readonly daysRemaining: number,
    public readonly hasIncompleteOrders: boolean,
    public readonly incompleteOrderTypes: string[],
  ) {}

  /**
   * Get a human-readable time remaining string
   */
  getTimeRemainingLabel(): string {
    if (this.daysRemaining === 0) {
      return 'hoje';
    }
    return `${this.daysRemaining} dia(s)`;
  }

  /**
   * Check if this is urgent (today or has incomplete orders)
   */
  isUrgent(): boolean {
    return this.daysRemaining === 0 || (this.daysRemaining <= 1 && this.hasIncompleteOrders);
  }
}

/**
 * Event emitted when task forecast date is overdue
 */
export class TaskForecastOverdueEvent {
  constructor(
    public readonly task: Task,
    public readonly daysOverdue: number,
    public readonly hasIncompleteOrders: boolean,
    public readonly incompleteOrderTypes: string[],
  ) {}
}

/**
 * Event emitted when task status changes to WAITING_PRODUCTION
 * Indicates task is ready for production
 */
export class TaskWaitingProductionEvent {
  constructor(
    public readonly task: Task,
    public readonly changedBy: User,
  ) {}
}
