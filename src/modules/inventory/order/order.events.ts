import { Order, User, OrderItem } from '../../../types';
import { ORDER_STATUS } from '../../../constants/enums';

/**
 * Event emitted when a new order is created
 */
export class OrderCreatedEvent {
  constructor(
    public readonly order: Order,
    public readonly createdBy: User,
  ) {}
}

/**
 * Event emitted when an order's status changes
 */
export class OrderStatusChangedEvent {
  constructor(
    public readonly order: Order,
    public readonly oldStatus: ORDER_STATUS,
    public readonly newStatus: ORDER_STATUS,
    public readonly changedBy: User,
  ) {}
}

/**
 * Event emitted when an order becomes overdue
 */
export class OrderOverdueEvent {
  constructor(
    public readonly order: Order,
    public readonly daysOverdue: number,
  ) {}
}

/**
 * Event emitted when an order item is received
 */
export class OrderItemReceivedEvent {
  constructor(
    public readonly order: Order,
    public readonly item: OrderItem,
    public readonly quantity: number,
  ) {}
}

/**
 * Event emitted when an order is cancelled
 */
export class OrderCancelledEvent {
  constructor(
    public readonly order: Order,
    public readonly cancelledBy: User,
    public readonly reason?: string,
  ) {}
}
