import { Cut, Task, User } from '../../../types';
import { CUT_STATUS, CUT_ORIGIN, CUT_REQUEST_REASON, CUT_TYPE } from '../../../constants/enums';

/**
 * Event emitted when a new cut is created
 */
export class CutCreatedEvent {
  constructor(
    public readonly cut: Cut,
    public readonly task: Task | null,
    public readonly createdBy: User,
  ) {}
}

/**
 * Event emitted when a cut starts (status changes to CUTTING)
 */
export class CutStartedEvent {
  constructor(
    public readonly cut: Cut,
    public readonly task: Task | null,
    public readonly startedBy: User,
  ) {}
}

/**
 * Event emitted when a cut is completed (status changes to COMPLETED)
 */
export class CutCompletedEvent {
  constructor(
    public readonly cut: Cut,
    public readonly task: Task | null,
    public readonly completedBy: User,
  ) {}
}

/**
 * Event emitted when a cut request is created (recut due to issues)
 * This happens when origin=REQUEST with a reason set
 */
export class CutRequestCreatedEvent {
  constructor(
    public readonly cut: Cut,
    public readonly task: Task | null,
    public readonly reason: CUT_REQUEST_REASON,
    public readonly parentCut: Cut | null,
    public readonly createdBy: User,
  ) {}
}

/**
 * Event emitted when cuts are added to a task
 */
export class CutsAddedToTaskEvent {
  constructor(
    public readonly task: Task,
    public readonly cuts: Cut[],
    public readonly addedBy: User,
  ) {}
}
