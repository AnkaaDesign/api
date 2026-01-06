/**
 * Test Utilities for Notification Aggregation Service
 *
 * This file provides helper functions and mock data for testing
 * the notification aggregation functionality.
 */

import {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
} from '../../../../constants';
import { Notification } from '../../../../types';

/**
 * Create a mock notification for testing
 */
export function createMockNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: `notif-${Date.now()}-${Math.random()}`,
    userId: overrides.userId || 'test-user-123',
    title: overrides.title || 'Test Notification',
    body: overrides.body || 'This is a test notification',
    type: overrides.type || NOTIFICATION_TYPE.TASK,
    channel: overrides.channel || [NOTIFICATION_CHANNEL.IN_APP],
    importance: overrides.importance || NOTIFICATION_IMPORTANCE.MEDIUM,
    actionType: overrides.actionType || null,
    actionUrl: overrides.actionUrl || '/test',
    scheduledAt: overrides.scheduledAt || null,
    sentAt: overrides.sentAt || null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Notification;
}

/**
 * Create multiple mock notifications for the same task
 */
export function createTaskNotificationBatch(
  taskId: string,
  userId: string,
  count: number,
): Notification[] {
  const fields = ['status', 'priority', 'deadline', 'assignee', 'description', 'tags'];
  const notifications: Notification[] = [];

  for (let i = 0; i < count; i++) {
    const field = fields[i % fields.length];
    notifications.push(
      createMockNotification({
        userId,
        title: `Tarefa #${taskId} atualizada`,
        body: `${field} foi atualizado`,
        type: NOTIFICATION_TYPE.TASK,
        importance: NOTIFICATION_IMPORTANCE.LOW,
        actionUrl: `/tasks/${taskId}`,
      }),
    );
  }

  return notifications;
}

/**
 * Create multiple mock notifications for different stock items
 */
export function createStockNotificationBatch(userId: string, count: number): Notification[] {
  const notifications: Notification[] = [];

  for (let i = 0; i < count; i++) {
    const itemId = `item-${i}`;
    const itemName = `Item ${String.fromCharCode(65 + i)}`; // Item A, Item B, etc.
    const quantity = Math.floor(Math.random() * 10);
    const reorderPoint = 20;

    notifications.push(
      createMockNotification({
        userId,
        title: `Estoque baixo: ${itemName}`,
        body: `${itemName} está com estoque baixo (${quantity} unidades)`,
        type: NOTIFICATION_TYPE.STOCK,
        importance: quantity === 0 ? NOTIFICATION_IMPORTANCE.HIGH : NOTIFICATION_IMPORTANCE.MEDIUM,
        actionUrl: `/inventory/items/${itemId}`,
      }),
    );
  }

  return notifications;
}

/**
 * Create multiple mock notifications for different orders
 */
export function createOrderNotificationBatch(userId: string, count: number): Notification[] {
  const notifications: Notification[] = [];

  for (let i = 0; i < count; i++) {
    const orderId = `order-${i}`;

    notifications.push(
      createMockNotification({
        userId,
        title: `Pedido #${orderId} atualizado`,
        body: 'O status do seu pedido foi atualizado',
        type: NOTIFICATION_TYPE.ORDER,
        importance: NOTIFICATION_IMPORTANCE.MEDIUM,
        actionUrl: `/orders/${orderId}`,
      }),
    );
  }

  return notifications;
}

/**
 * Wait for a specified duration (for testing time windows)
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Mock aggregation group for testing
 */
export function createMockAggregationGroup(
  userId: string,
  type: NOTIFICATION_TYPE,
  notificationCount: number,
) {
  const notifications = [];
  const now = Date.now();

  for (let i = 0; i < notificationCount; i++) {
    notifications.push({
      id: `notif-${i}`,
      title: `Notification ${i}`,
      body: `Body ${i}`,
      type,
      metadata: { index: i },
      timestamp: now - (notificationCount - i) * 1000,
      importance: NOTIFICATION_IMPORTANCE.MEDIUM,
      channels: [NOTIFICATION_CHANNEL.IN_APP],
    });
  }

  return {
    userId,
    type,
    groupId: 'test-group',
    notifications,
    firstNotificationAt: now - notificationCount * 1000,
    lastNotificationAt: now,
    rule: {
      type,
      timeWindow: 30,
      maxCount: 10,
      groupBy: [],
      template: 'test-template',
      enabled: true,
    },
  };
}

/**
 * Test data scenarios
 */
export const testScenarios = {
  /**
   * Scenario: Single task with multiple updates
   */
  taskMultipleUpdates: {
    taskId: 'task-123',
    userId: 'user-123',
    updates: [
      { field: 'status', oldValue: 'PENDING', newValue: 'IN_PROGRESS' },
      { field: 'priority', oldValue: 'MEDIUM', newValue: 'HIGH' },
      { field: 'deadline', oldValue: '2024-01-01', newValue: '2024-01-05' },
      { field: 'assignee', oldValue: 'John', newValue: 'Jane' },
      { field: 'description', oldValue: 'Old description', newValue: 'New description' },
    ],
  },

  /**
   * Scenario: Multiple items with low stock
   */
  stockMultipleLow: {
    userId: 'warehouse-manager-123',
    items: [
      { id: 'item-1', name: 'Parafuso M6', quantity: 5, reorderPoint: 50 },
      { id: 'item-2', name: 'Cola Branca', quantity: 2, reorderPoint: 20 },
      { id: 'item-3', name: 'Tinta Azul', quantity: 0, reorderPoint: 10 },
      { id: 'item-4', name: 'Verniz', quantity: 3, reorderPoint: 15 },
      { id: 'item-5', name: 'Lixa 80', quantity: 1, reorderPoint: 30 },
    ],
  },

  /**
   * Scenario: Order with multiple status changes
   */
  orderMultipleUpdates: {
    orderId: 'order-456',
    userId: 'user-456',
    updates: [
      { field: 'status', oldValue: 'CREATED', newValue: 'PROCESSING' },
      { field: 'status', oldValue: 'PROCESSING', newValue: 'SHIPPED' },
      { field: 'trackingNumber', oldValue: null, newValue: 'BR123456789' },
      { field: 'estimatedDelivery', oldValue: '2024-01-10', newValue: '2024-01-08' },
    ],
  },

  /**
   * Scenario: User preferences variations
   */
  userPreferences: {
    disabled: {
      enabled: false,
      timeWindowMultiplier: 1.0,
    },
    standard: {
      enabled: true,
      timeWindowMultiplier: 1.0,
    },
    extended: {
      enabled: true,
      timeWindowMultiplier: 2.0,
    },
    immediate: {
      enabled: true,
      timeWindowMultiplier: 0.5,
    },
  },
};

/**
 * Assert helpers for testing
 */
export const assertHelpers = {
  /**
   * Assert aggregation group has expected structure
   */
  assertValidAggregationGroup(group: any) {
    expect(group).toHaveProperty('userId');
    expect(group).toHaveProperty('type');
    expect(group).toHaveProperty('groupId');
    expect(group).toHaveProperty('notifications');
    expect(group).toHaveProperty('firstNotificationAt');
    expect(group).toHaveProperty('lastNotificationAt');
    expect(group).toHaveProperty('rule');
    expect(Array.isArray(group.notifications)).toBe(true);
  },

  /**
   * Assert aggregated notification has expected structure
   */
  assertValidAggregatedNotification(notification: any) {
    expect(notification).toHaveProperty('title');
    expect(notification).toHaveProperty('body');
    expect(notification).toHaveProperty('type');
    expect(notification).toHaveProperty('importance');
    expect(notification).toHaveProperty('channels');
    expect(notification).toHaveProperty('metadata');
    expect(notification.metadata).toHaveProperty('aggregatedCount');
  },

  /**
   * Assert aggregation stats have expected structure
   */
  assertValidAggregationStats(stats: any) {
    expect(stats).toHaveProperty('totalGroups');
    expect(stats).toHaveProperty('totalPendingNotifications');
    expect(stats).toHaveProperty('groupsByType');
    expect(typeof stats.totalGroups).toBe('number');
    expect(typeof stats.totalPendingNotifications).toBe('number');
    expect(typeof stats.groupsByType).toBe('object');
  },
};

/**
 * Mock services for testing
 */
export class MockCacheService {
  private cache: Map<string, any> = new Map();

  async get(key: string): Promise<string | null> {
    return this.cache.get(key) || null;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    this.cache.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async getObject<T>(key: string): Promise<T | null> {
    const value = this.cache.get(key);
    return value ? JSON.parse(value) : null;
  }

  async setObject<T>(key: string, value: T, ttl?: number): Promise<void> {
    this.cache.set(key, JSON.stringify(value));
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return Array.from(this.cache.keys()).filter(key => regex.test(key));
  }

  async clearPattern(pattern: string): Promise<void> {
    const keys = await this.keys(pattern);
    keys.forEach(key => this.cache.delete(key));
  }

  clear() {
    this.cache.clear();
  }
}

export class MockNotificationService {
  async createNotification(data: any): Promise<any> {
    return {
      success: true,
      data: {
        id: `notif-${Date.now()}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  }
}

export class MockPrismaService {
  userNotificationPreference = {
    findMany: jest.fn().mockResolvedValue([]),
  };
}

/**
 * Integration test helper
 */
export class AggregationTestHelper {
  constructor(
    private readonly aggregationService: any,
    private readonly cacheService: MockCacheService,
  ) {}

  async setupCleanState() {
    this.cacheService.clear();
  }

  async createNotificationsAndWait(
    userId: string,
    type: NOTIFICATION_TYPE,
    count: number,
    waitMs: number = 0,
  ) {
    const notifications = [];
    for (let i = 0; i < count; i++) {
      const notif = createMockNotification({ userId, type });
      notifications.push(notif);
      await this.aggregationService.addToAggregation(notif);
    }

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    return notifications;
  }

  async getPendingCount(userId: string): Promise<number> {
    const aggregations = await this.aggregationService.getAggregatedNotifications(userId);
    return aggregations.reduce((sum: number, agg: any) => sum + agg.metadata.aggregatedCount, 0);
  }

  async verifyAggregation(userId: string, expectedCount: number, expectedType: NOTIFICATION_TYPE) {
    const aggregations = await this.aggregationService.getAggregatedNotifications(userId);
    expect(aggregations).toHaveLength(1);
    expect(aggregations[0].metadata.aggregatedCount).toBe(expectedCount);
    expect(aggregations[0].type).toContain(expectedType);
  }
}
