import { PpeDelivery, User, Item } from '../../../types';
import { PPE_DELIVERY_STATUS } from '../../../constants/enums';

/**
 * Event emitted when a PPE delivery is requested by a user
 * Recipients: ADMIN, HUMAN_RESOURCES
 */
export class PpeRequestedEvent {
  constructor(
    public readonly delivery: PpeDelivery,
    public readonly item: Item,
    public readonly requestedBy: User,
  ) {}
}

/**
 * Event emitted when a PPE request is approved
 * Recipients: The user who requested + WAREHOUSE (to prepare for delivery)
 */
export class PpeApprovedEvent {
  constructor(
    public readonly delivery: PpeDelivery,
    public readonly item: Item,
    public readonly requestedBy: User,
    public readonly approvedBy: User,
  ) {}
}

/**
 * Event emitted when a PPE request is rejected
 * Recipients: The user who requested
 */
export class PpeRejectedEvent {
  constructor(
    public readonly delivery: PpeDelivery,
    public readonly item: Item,
    public readonly requestedBy: User,
    public readonly rejectedBy: User,
    public readonly reason?: string,
  ) {}
}

/**
 * Event emitted when a PPE is delivered to the user
 * Recipients: The user who receives the PPE
 */
export class PpeDeliveredEvent {
  constructor(
    public readonly delivery: PpeDelivery,
    public readonly item: Item,
    public readonly deliveredTo: User,
    public readonly deliveredBy: User,
  ) {}
}

/**
 * Event emitted when a PPE delivery status changes
 * Generic event for any status change
 */
export class PpeStatusChangedEvent {
  constructor(
    public readonly delivery: PpeDelivery,
    public readonly item: Item,
    public readonly user: User,
    public readonly oldStatus: PPE_DELIVERY_STATUS,
    public readonly newStatus: PPE_DELIVERY_STATUS,
    public readonly changedBy: User,
  ) {}
}

/**
 * Event emitted when multiple PPE deliveries are marked as delivered in batch
 * Used to trigger batch signature workflow (one signature per user)
 */
export class PpeBatchDeliveredEvent {
  constructor(
    public readonly deliveryIds: string[],
    public readonly deliveredBy: User,
  ) {}
}
