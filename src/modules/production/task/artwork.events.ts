import { Artwork, Task, User } from '../../../types';

/**
 * Event emitted when an artwork status changes to APPROVED
 */
export class ArtworkApprovedEvent {
  constructor(
    public readonly artwork: Artwork,
    public readonly task: Task | null,
    public readonly approvedBy: User,
  ) {}
}

/**
 * Event emitted when an artwork status changes to REPROVED (rejected)
 */
export class ArtworkReprovedEvent {
  constructor(
    public readonly artwork: Artwork,
    public readonly task: Task | null,
    public readonly reprovedBy: User,
    public readonly reason?: string,
  ) {}
}

/**
 * Event emitted when an artwork is pending approval for too long (reminder)
 * This can be triggered by a cron job
 */
export class ArtworkPendingApprovalReminderEvent {
  constructor(
    public readonly artwork: Artwork,
    public readonly task: Task | null,
    public readonly daysPending: number,
  ) {}
}
