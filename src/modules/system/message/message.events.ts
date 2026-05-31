import type { Message } from '@prisma/client';

/**
 * Event emitted when a system-announcement Message is published
 * (created already-active, or a DRAFT transitions to ACTIVE for the first time).
 *
 * targetUserIds: resolved MessageTarget user IDs.
 *   Empty array = ALL active users (config target rule covers all sectors).
 * createdBy: the actor (user id) that published the message; used as triggeringUserId.
 */
export class MessagePublishedEvent {
  constructor(
    public readonly message: Message,
    public readonly targetUserIds: string[],
    public readonly createdBy: string,
  ) {}
}
