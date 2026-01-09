/**
 * Example: Integrating Notification Aggregation with Existing Services
 *
 * This file demonstrates how to integrate the aggregation service
 * into your existing notification workflow.
 */

import { Injectable, Logger } from '@nestjs/common';
import { NotificationService } from '../notification.service';
import { NotificationAggregationService } from '../notification-aggregation.service';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
} from '../../../../constants';

/**
 * Example 1: Task Service Integration
 */
@Injectable()
export class TaskServiceExample {
  private readonly logger = new Logger(TaskServiceExample.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly aggregationService: NotificationAggregationService,
  ) {}

  async updateTaskStatus(taskId: string, userId: string, oldStatus: string, newStatus: string) {
    try {
      // Create notification
      const notification = await this.notificationService.createNotification({
        userId,
        title: `Tarefa #${taskId} atualizada`,
        body: `Status alterado de ${oldStatus} para ${newStatus}`,
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        importance: NOTIFICATION_IMPORTANCE.NORMAL,
        actionUrl: `/tasks/${taskId}`,
        actionType: 'VIEW_TASK',
      });

      // Add to aggregation - will automatically group similar task notifications
      await this.aggregationService.addToAggregation(notification.data);

      this.logger.log(
        `Task notification created and queued for aggregation: ${notification.data.id}`,
      );
    } catch (error) {
      this.logger.error(`Failed to create task notification: ${error.message}`, error.stack);
      // Notification was still created, aggregation just failed gracefully
    }
  }

  async updateTaskMultipleFields(
    taskId: string,
    userId: string,
    updates: Array<{ field: string; oldValue: any; newValue: any }>,
  ) {
    // Create multiple notifications for different field updates
    for (const update of updates) {
      const notification = await this.notificationService.createNotification({
        userId,
        title: `Tarefa #${taskId} - ${update.field} atualizado`,
        body: `${update.field}: ${update.oldValue} → ${update.newValue}`,
        type: NOTIFICATION_TYPE.TASK,
        channel: [NOTIFICATION_CHANNEL.IN_APP],
        importance: NOTIFICATION_IMPORTANCE.LOW,
        actionUrl: `/tasks/${taskId}`,
      });

      // All these will be grouped into a single aggregated notification
      // e.g., "10 updates to Task #123"
      await this.aggregationService.addToAggregation(notification.data);
    }
  }
}

/**
 * Example 2: Stock Monitoring Integration
 */
@Injectable()
export class StockMonitoringExample {
  private readonly logger = new Logger(StockMonitoringExample.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly aggregationService: NotificationAggregationService,
  ) {}

  async checkLowStockItems() {
    // Assume we have 50 items with low stock
    const lowStockItems = await this.getLowStockItems();

    // Create individual notifications for each item
    for (const item of lowStockItems) {
      const notification = await this.notificationService.createNotification({
        userId: null, // Will be sent to all warehouse managers
        title: `Estoque baixo: ${item.name}`,
        body: `${item.name} está com estoque baixo (${item.quantity} unidades)`,
        type: NOTIFICATION_TYPE.STOCK,
        channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        importance:
          item.quantity === 0 ? NOTIFICATION_IMPORTANCE.HIGH : NOTIFICATION_IMPORTANCE.NORMAL,
        actionUrl: `/inventory/items/${item.id}`,
      });

      // These will be aggregated into a single notification:
      // "50 items with low stock" with a list of items
      if (notification.data.importance !== NOTIFICATION_IMPORTANCE.HIGH) {
        await this.aggregationService.addToAggregation(notification.data);
      }
      // HIGH importance notifications are never aggregated (sent immediately)
    }
  }

  private async getLowStockItems(): Promise<any[]> {
    // Mock implementation
    return [];
  }
}

/**
 * Example 3: User Preference Management
 */
@Injectable()
export class UserPreferenceExample {
  constructor(private readonly aggregationService: NotificationAggregationService) {}

  async enableQuietMode(userId: string) {
    // User wants longer aggregation windows for less interruptions
    await this.aggregationService.updateUserPreference(userId, {
      enabled: true,
      timeWindowMultiplier: 3.0, // 3x longer time windows
    });
  }

  async disableAggregation(userId: string) {
    // User wants all notifications immediately
    await this.aggregationService.updateUserPreference(userId, {
      enabled: false,
    });
  }

  async customizeForPowerUser(userId: string) {
    // Power user wants shorter windows to stay updated
    await this.aggregationService.updateUserPreference(userId, {
      enabled: true,
      timeWindowMultiplier: 0.5, // 50% shorter time windows
    });
  }
}

/**
 * Example 4: Admin Dashboard Integration
 */
@Injectable()
export class AdminDashboardExample {
  constructor(private readonly aggregationService: NotificationAggregationService) {}

  async getAggregationMetrics() {
    const stats = await this.aggregationService.getAggregationStats();

    return {
      overview: {
        activeGroups: stats.totalGroups,
        pendingNotifications: stats.totalPendingNotifications,
        avgNotificationsPerGroup:
          stats.totalGroups > 0 ? stats.totalPendingNotifications / stats.totalGroups : 0,
      },
      byType: stats.groupsByType,
      health: {
        status: stats.totalGroups > 100 ? 'warning' : 'healthy',
        message:
          stats.totalGroups > 100
            ? 'High number of aggregation groups - check scheduler'
            : 'All systems normal',
      },
    };
  }

  async forceFlushAll() {
    // Emergency flush of all pending aggregations
    await this.aggregationService.flushAggregations();
  }

  async clearCache() {
    // Clear all aggregations (maintenance/testing)
    await this.aggregationService.clearAllAggregations();
  }
}

/**
 * Example 5: Event Listener Integration
 */
@Injectable()
export class NotificationEventListenerExample {
  private readonly logger = new Logger(NotificationEventListenerExample.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly aggregationService: NotificationAggregationService,
  ) {}

  async handleTaskUpdatedEvent(event: {
    taskId: string;
    userId: string;
    field: string;
    oldValue: any;
    newValue: any;
  }) {
    // Create notification from event
    const notification = await this.notificationService.createNotification({
      userId: event.userId,
      title: `Tarefa #${event.taskId} atualizada`,
      body: `${event.field} alterado de ${event.oldValue} para ${event.newValue}`,
      type: NOTIFICATION_TYPE.TASK,
      channel: [NOTIFICATION_CHANNEL.IN_APP],
      importance: NOTIFICATION_IMPORTANCE.LOW,
      actionUrl: `/tasks/${event.taskId}`,
    });

    // Add to aggregation
    await this.aggregationService.addToAggregation(notification.data);
  }

  async handleBulkOrderUpdate(events: Array<{ orderId: string; userId: string }>) {
    // Create multiple notifications
    const notifications = await Promise.all(
      events.map(event =>
        this.notificationService.createNotification({
          userId: event.userId,
          title: `Pedido #${event.orderId} atualizado`,
          body: 'O status do seu pedido foi atualizado',
          type: NOTIFICATION_TYPE.ORDER,
          channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
          importance: NOTIFICATION_IMPORTANCE.NORMAL,
          actionUrl: `/orders/${event.orderId}`,
        }),
      ),
    );

    // Add all to aggregation
    for (const notification of notifications) {
      await this.aggregationService.addToAggregation(notification.data);
    }

    this.logger.log(`Queued ${notifications.length} order notifications for aggregation`);
  }
}

/**
 * Example 6: Scheduled Maintenance
 */
@Injectable()
export class AggregationMaintenanceExample {
  private readonly logger = new Logger(AggregationMaintenanceExample.name);

  constructor(private readonly aggregationService: NotificationAggregationService) {}

  // Run daily cleanup at 3 AM
  async dailyMaintenance() {
    this.logger.log('Starting aggregation maintenance');

    // Get stats before cleanup
    const statsBefore = await this.aggregationService.getAggregationStats();
    this.logger.log(
      `Before cleanup: ${statsBefore.totalGroups} groups, ${statsBefore.totalPendingNotifications} notifications`,
    );

    // Flush all pending aggregations
    await this.aggregationService.flushAggregations();

    // Get stats after cleanup
    const statsAfter = await this.aggregationService.getAggregationStats();
    this.logger.log(
      `After cleanup: ${statsAfter.totalGroups} groups, ${statsAfter.totalPendingNotifications} notifications`,
    );

    // Log summary
    const flushedGroups = statsBefore.totalGroups - statsAfter.totalGroups;
    const flushedNotifications =
      statsBefore.totalPendingNotifications - statsAfter.totalPendingNotifications;

    this.logger.log(
      `Maintenance complete: Flushed ${flushedGroups} groups containing ${flushedNotifications} notifications`,
    );
  }
}

/**
 * Example 7: Testing Helpers
 */
export class AggregationTestingHelpers {
  constructor(private readonly aggregationService: NotificationAggregationService) {}

  async setupTestUser(userId: string) {
    // Configure user for predictable test behavior
    await this.aggregationService.updateUserPreference(userId, {
      enabled: true,
      timeWindowMultiplier: 1.0,
    });
  }

  async cleanupTestData(userId: string) {
    // Clean up test aggregations
    await this.aggregationService.flushUserAggregations(userId);
  }

  async getPendingCount(userId: string): Promise<number> {
    const aggregations = await this.aggregationService.getAggregatedNotifications(userId);
    return aggregations.reduce((sum, agg) => sum + agg.metadata.aggregatedCount, 0);
  }

  async waitForTimeWindow(minutes: number) {
    // Helper to wait for time window expiration in tests
    return new Promise(resolve => setTimeout(resolve, minutes * 60 * 1000));
  }
}

/**
 * Example 8: Custom Aggregation Logic
 */
@Injectable()
export class CustomAggregationExample {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly aggregationService: NotificationAggregationService,
  ) {}

  async createHighPriorityNotification(userId: string, data: any) {
    // High priority notifications should NEVER be aggregated
    // They are sent immediately
    const notification = await this.notificationService.createNotification({
      userId,
      title: 'URGENT: System Alert',
      body: data.message,
      type: NOTIFICATION_TYPE.SYSTEM,
      channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.SMS],
      importance: NOTIFICATION_IMPORTANCE.HIGH, // This prevents aggregation
      actionUrl: data.url,
    });

    // Don't add to aggregation - HIGH importance is never aggregated
    // Notification will be sent immediately through normal channels
  }

  async createBatchNotificationsWithManualControl(userId: string, items: any[]) {
    // Create notifications but control aggregation manually
    for (const item of items) {
      const notification = await this.notificationService.createNotification({
        userId,
        title: `Item ${item.name} updated`,
        body: item.description,
        type: NOTIFICATION_TYPE.STOCK,
        channel: [NOTIFICATION_CHANNEL.IN_APP],
        importance: NOTIFICATION_IMPORTANCE.LOW,
        actionUrl: `/items/${item.id}`,
      });

      // Only aggregate if more than 5 items
      if (items.length > 5) {
        await this.aggregationService.addToAggregation(notification.data);
      }
      // Otherwise, let them send individually
    }

    // Optionally flush immediately if we want users to get the notification now
    if (items.length > 10) {
      await this.aggregationService.flushUserAggregations(userId);
    }
  }
}
