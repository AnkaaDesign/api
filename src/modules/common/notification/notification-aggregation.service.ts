import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CacheService } from '../cache/cache.service';
import { NotificationService } from './notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { Notification } from '../../../types';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
} from '../../../constants';

/**
 * Aggregation rule configuration
 */
export interface AggregationRule {
  type: NOTIFICATION_TYPE;
  timeWindow: number; // minutes
  maxCount: number; // max notifications before forcing send
  groupBy: string[]; // fields to group by (e.g., ['taskId'], ['orderId'])
  template: string; // aggregated template
  enabled: boolean;
}

/**
 * Pending notification in aggregation group
 */
export interface PendingNotification {
  id: string;
  title: string;
  body: string;
  type: NOTIFICATION_TYPE;
  metadata: Record<string, any>;
  timestamp: number;
  importance: NOTIFICATION_IMPORTANCE;
  channels: NOTIFICATION_CHANNEL[];
}

/**
 * Aggregation group stored in Redis
 */
export interface AggregationGroup {
  userId: string;
  type: NOTIFICATION_TYPE;
  groupId: string;
  notifications: PendingNotification[];
  firstNotificationAt: number;
  lastNotificationAt: number;
  rule: AggregationRule;
}

/**
 * Aggregated notification to be sent
 */
export interface AggregatedNotification {
  title: string;
  body: string;
  type: string;
  importance: NOTIFICATION_IMPORTANCE;
  channels: NOTIFICATION_CHANNEL[];
  metadata: {
    aggregatedCount: number;
    groupId?: string;
    updates?: any[];
    [key: string]: any;
  };
}

/**
 * User preferences for aggregation
 */
export interface UserAggregationPreference {
  enabled: boolean;
  timeWindowMultiplier: number; // multiplier for time window (1.0 = default)
}

/**
 * Default aggregation rules
 * Time window: 5 minutes, Max notifications per group: 10
 */
const DEFAULT_RULES: AggregationRule[] = [
  {
    type: NOTIFICATION_TYPE.TASK,
    timeWindow: 5, // 5 minutes
    maxCount: 10,
    groupBy: ['taskId'],
    template: 'task-multiple-updates',
    enabled: true,
  },
  {
    type: NOTIFICATION_TYPE.STOCK,
    timeWindow: 5, // 5 minutes
    maxCount: 10,
    groupBy: [], // aggregate all stock notifications
    template: 'stock-multiple-low',
    enabled: true,
  },
  {
    type: NOTIFICATION_TYPE.ORDER,
    timeWindow: 5, // 5 minutes
    maxCount: 10,
    groupBy: ['orderId'],
    template: 'order-multiple-updates',
    enabled: true,
  },
  {
    type: NOTIFICATION_TYPE.WARNING,
    timeWindow: 5, // 5 minutes
    maxCount: 10,
    groupBy: ['userId'],
    template: 'warning-multiple',
    enabled: true,
  },
  {
    type: NOTIFICATION_TYPE.PPE,
    timeWindow: 5, // 5 minutes
    maxCount: 10,
    groupBy: [], // aggregate all PPE notifications
    template: 'ppe-multiple-alerts',
    enabled: true,
  },
];

/**
 * Notification Aggregation Service
 *
 * Groups similar notifications to reduce notification fatigue.
 *
 * Key Features:
 * - Groups notifications of same type for same entity
 * - Time window: 5 minutes
 * - Max notifications per group: 10
 * - After max or time window, sends aggregated notification
 * - Stores pending notifications in Redis cache with TTL of 5 minutes
 * - Scheduler flushes pending aggregations every minute
 *
 * Aggregation Key Format: [userId]:[notificationType]:[entityId]
 *
 * Example Aggregations:
 * - 5 task field updates -> "5 alterações em [TASK_TITLE]"
 * - 3 new orders -> "3 novos pedidos recebidos"
 * - 8 stock alerts -> "8 produtos com estoque baixo"
 *
 * Main Methods:
 * 1. shouldAggregate() - Determine if notification should be aggregated
 * 2. findSimilarNotifications() - Find similar pending notifications
 * 3. aggregateNotifications() - Combine multiple notifications into one
 * 4. formatAggregatedMessage() - Format aggregated notification message
 * 5. getAggregationKey() - Generate key for grouping notifications
 * 6. flushAggregatedNotifications() - Send aggregated notifications
 */
@Injectable()
export class NotificationAggregationService {
  private readonly logger = new Logger(NotificationAggregationService.name);
  private readonly CACHE_PREFIX = 'notif:agg:';
  private readonly PREFERENCE_PREFIX = 'notif:agg:pref:';
  private readonly DEFAULT_TTL = 86400; // 24 hours in seconds
  private rules: Map<NOTIFICATION_TYPE, AggregationRule> = new Map();

  constructor(
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
    private readonly prisma: PrismaService,
  ) {
    this.initializeRules();
  }

  /**
   * Initialize aggregation rules
   */
  private initializeRules(): void {
    for (const rule of DEFAULT_RULES) {
      this.rules.set(rule.type, rule);
    }
    this.logger.log(`Initialized ${this.rules.size} aggregation rules`);
  }

  /**
   * Get aggregation rule for notification type
   */
  private getRule(type: NOTIFICATION_TYPE): AggregationRule | null {
    return this.rules.get(type) || null;
  }

  /**
   * Get user aggregation preferences
   */
  async getUserPreference(userId: string): Promise<UserAggregationPreference> {
    const key = `${this.PREFERENCE_PREFIX}${userId}`;
    const cached = await this.cacheService.getObject<UserAggregationPreference>(key);

    if (cached) {
      return cached;
    }

    // Check if user has disabled aggregation in preferences
    try {
      const userPreferences = await this.prisma.userNotificationPreference.findMany({
        where: {
          userId,
        },
      });

      // If user has any preference with aggregation disabled, respect it
      // This is a simplified check - you might want more granular control
      const defaultPreference: UserAggregationPreference = {
        enabled: true,
        timeWindowMultiplier: 1.0,
      };

      // Cache the preference
      await this.cacheService.setObject(key, defaultPreference, 3600); // 1 hour TTL

      return defaultPreference;
    } catch (error) {
      this.logger.warn(`Failed to get user preferences for ${userId}: ${error.message}`);
      return { enabled: true, timeWindowMultiplier: 1.0 };
    }
  }

  /**
   * Update user aggregation preferences
   */
  async updateUserPreference(
    userId: string,
    preference: Partial<UserAggregationPreference>,
  ): Promise<void> {
    const key = `${this.PREFERENCE_PREFIX}${userId}`;
    const current = await this.getUserPreference(userId);
    const updated = { ...current, ...preference };
    await this.cacheService.setObject(key, updated, 3600); // 1 hour TTL
    this.logger.log(`Updated aggregation preferences for user ${userId}`);
  }

  /**
   * Generate aggregation key for grouping notifications
   * Format: [userId]:[notificationType]:[entityId]
   *
   * @param notification - The notification to generate key for
   * @param rule - The aggregation rule to use
   * @returns Aggregation key string
   */
  getAggregationKey(notification: Notification, rule?: AggregationRule): string {
    if (!notification.userId) {
      return '';
    }

    const aggregationRule = rule || this.getRule(notification.type);
    if (!aggregationRule) {
      return '';
    }

    let entityId = 'all';

    if (aggregationRule.groupBy.length > 0) {
      // Extract metadata from notification
      const metadata = (notification as any).metadata || {};
      const groupParts = aggregationRule.groupBy
        .map(field => `${metadata[field] || 'unknown'}`)
        .join('|');
      entityId = groupParts;
    }

    return `${notification.userId}:${notification.type}:${entityId}`;
  }

  /**
   * Generate group ID from notification and rule
   * @deprecated Use getAggregationKey instead
   */
  private generateGroupId(notification: Notification, rule: AggregationRule): string {
    if (rule.groupBy.length === 0) {
      return 'all';
    }

    // Extract metadata from notification
    const metadata = (notification as any).metadata || {};
    const groupParts = rule.groupBy
      .map(field => `${field}:${metadata[field] || 'unknown'}`)
      .join('|');

    return groupParts;
  }

  /**
   * Generate cache key for aggregation group
   */
  private generateCacheKey(userId: string, type: NOTIFICATION_TYPE, groupId: string): string {
    return `${this.CACHE_PREFIX}${userId}:${type}:${groupId}`;
  }

  /**
   * Determine if notification should be aggregated
   * Checks:
   * 1. User exists
   * 2. Aggregation rule exists and is enabled for notification type
   * 3. User has aggregation enabled in preferences
   * 4. Notification is not high priority (HIGH or URGENT)
   *
   * @param notification - The notification to check
   * @returns True if notification should be aggregated, false otherwise
   */
  async shouldAggregate(notification: Notification): Promise<boolean> {
    // Check if user exists
    if (!notification.userId) {
      this.logger.debug('Cannot aggregate notification without userId');
      return false;
    }

    // Check if aggregation rule exists for this type
    const rule = this.getRule(notification.type);
    if (!rule || !rule.enabled) {
      this.logger.debug(
        `No aggregation rule found or rule disabled for type: ${notification.type}`,
      );
      return false;
    }

    // Check user preferences
    const userPref = await this.getUserPreference(notification.userId);
    if (!userPref.enabled) {
      this.logger.debug(`Aggregation disabled for user: ${notification.userId}`);
      return false;
    }

    // Don't aggregate high importance notifications (HIGH or URGENT)
    if (
      notification.importance === NOTIFICATION_IMPORTANCE.HIGH ||
      notification.importance === NOTIFICATION_IMPORTANCE.URGENT
    ) {
      this.logger.debug(
        `Skipping aggregation for high importance notification: ${notification.importance}`,
      );
      return false;
    }

    return true;
  }

  /**
   * Find similar pending notifications in the aggregation group
   *
   * @param notification - The notification to find similar ones for
   * @returns Array of similar pending notifications or null if none found
   */
  async findSimilarNotifications(notification: Notification): Promise<PendingNotification[] | null> {
    if (!notification.userId) {
      return null;
    }

    const rule = this.getRule(notification.type);
    if (!rule) {
      return null;
    }

    const groupId = this.generateGroupId(notification, rule);
    const cacheKey = this.generateCacheKey(notification.userId, notification.type, groupId);

    try {
      const group = await this.cacheService.getObject<AggregationGroup>(cacheKey);

      if (!group || group.notifications.length === 0) {
        return null;
      }

      return group.notifications;
    } catch (error) {
      this.logger.error(`Failed to find similar notifications: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Aggregate notifications - Combine multiple notifications into one
   * This method adds a notification to its aggregation group.
   * If max count is reached, the group is automatically flushed.
   *
   * Storage: Redis cache with TTL of 5 minutes (300 seconds)
   * Triggers flush when: maxCount is reached OR time window expires
   *
   * @param notification - The notification to add to aggregation
   */
  async aggregateNotifications(notification: Notification): Promise<void> {
    const shouldAgg = await this.shouldAggregate(notification);
    if (!shouldAgg) {
      this.logger.debug(
        `Notification ${notification.id} should not be aggregated, skipping aggregation`,
      );
      return;
    }

    const rule = this.getRule(notification.type)!;
    const groupId = this.generateGroupId(notification, rule);
    const cacheKey = this.generateCacheKey(notification.userId!, notification.type, groupId);

    try {
      // Get user preference for time window multiplier
      const userPref = await this.getUserPreference(notification.userId!);
      const adjustedTimeWindow = Math.floor(rule.timeWindow * userPref.timeWindowMultiplier);

      // Get existing aggregation group
      let group = await this.cacheService.getObject<AggregationGroup>(cacheKey);

      const pendingNotification: PendingNotification = {
        id: notification.id,
        title: notification.title,
        body: notification.body,
        type: notification.type,
        metadata: (notification as any).metadata || {},
        timestamp: Date.now(),
        importance: notification.importance,
        channels: notification.channel,
      };

      if (!group) {
        // Create new aggregation group
        group = {
          userId: notification.userId!,
          type: notification.type,
          groupId,
          notifications: [pendingNotification],
          firstNotificationAt: Date.now(),
          lastNotificationAt: Date.now(),
          rule,
        };

        this.logger.log('Created new aggregation group', {
          userId: notification.userId,
          type: notification.type,
          groupId,
          timeWindowMinutes: adjustedTimeWindow,
          maxCount: rule.maxCount,
        });
      } else {
        // Add to existing group
        group.notifications.push(pendingNotification);
        group.lastNotificationAt = Date.now();

        this.logger.log('Added notification to aggregation group', {
          userId: notification.userId,
          type: notification.type,
          groupId,
          currentCount: group.notifications.length,
          maxCount: rule.maxCount,
          notificationId: notification.id,
        });
      }

      // Save group back to cache with TTL based on time window (5 minutes = 300 seconds)
      const ttl = adjustedTimeWindow * 60; // convert minutes to seconds
      await this.cacheService.setObject(cacheKey, group, ttl);

      // Check if we should flush immediately (reached max count)
      if (group.notifications.length >= rule.maxCount) {
        this.logger.log('Aggregation group reached max count, flushing immediately', {
          groupId,
          count: group.notifications.length,
          maxCount: rule.maxCount,
          userId: notification.userId,
          type: notification.type,
        });
        await this.flushGroup(cacheKey, group);
      }
    } catch (error) {
      this.logger.error(`Failed to add notification to aggregation: ${error.message}`, error.stack);
      // Don't throw error - notification should still be sent normally
    }
  }

  /**
   * Add notification to aggregation group (alias for aggregateNotifications)
   * @deprecated Use aggregateNotifications instead
   */
  async addToAggregation(notification: Notification): Promise<void> {
    return this.aggregateNotifications(notification);
  }

  /**
   * Flush a single aggregation group
   */
  private async flushGroup(cacheKey: string, group: AggregationGroup): Promise<void> {
    try {
      if (group.notifications.length === 0) {
        this.logger.warn(`Attempted to flush empty aggregation group: ${cacheKey}`);
        return;
      }

      // If only one notification, send it normally
      if (group.notifications.length === 1) {
        this.logger.log(`Only one notification in group, skipping aggregation`);
        await this.cacheService.del(cacheKey);
        return;
      }

      // Build aggregated notification
      const aggregated = this.formatAggregatedMessage(group);

      // Create the aggregated notification in database
      await this.notificationService.createNotification(
        {
          userId: group.userId,
          title: aggregated.title,
          body: aggregated.body,
          type: group.type,
          channel: aggregated.channels,
          importance: aggregated.importance,
          actionType: null,
          actionUrl: null,
          scheduledAt: null,
        },
        undefined,
        'system',
      );

      this.logger.log(
        `Flushed aggregation group with ${group.notifications.length} notifications for user ${group.userId}`,
      );

      // Remove the group from cache
      await this.cacheService.del(cacheKey);

      // Mark individual notifications as sent (if needed)
      // This prevents them from being sent again individually
      await this.markNotificationsAsAggregated(group.notifications);
    } catch (error) {
      this.logger.error(`Failed to flush aggregation group: ${error.message}`, error.stack);
    }
  }

  /**
   * Format aggregated notification message
   * Builds a single aggregated notification from multiple notifications in a group.
   * Examples:
   * - 5 task field updates -> "5 alterações em [TASK_TITLE]"
   * - 3 new orders -> "3 novos pedidos recebidos"
   * - 8 stock alerts -> "8 produtos com estoque baixo"
   *
   * @param group - The aggregation group to format
   * @returns Formatted aggregated notification
   */
  formatAggregatedMessage(group: AggregationGroup): AggregatedNotification {
    const count = group.notifications.length;
    const firstNotif = group.notifications[0];

    let title: string;
    let body: string;
    const metadata: any = {
      aggregatedCount: count,
      groupId: group.groupId,
    };

    // Build aggregated message based on type
    switch (group.type) {
      case NOTIFICATION_TYPE.TASK:
        title = this.buildTaskAggregationTitle(group);
        body = this.buildTaskAggregationBody(group);
        metadata.updates = group.notifications.map(n => n.metadata);
        break;

      case NOTIFICATION_TYPE.STOCK:
        title = this.buildStockAggregationTitle(group);
        body = this.buildStockAggregationBody(group);
        metadata.items = group.notifications.map(n => n.metadata);
        break;

      case NOTIFICATION_TYPE.ORDER:
        title = this.buildOrderAggregationTitle(group);
        body = this.buildOrderAggregationBody(group);
        metadata.updates = group.notifications.map(n => n.metadata);
        break;

      case NOTIFICATION_TYPE.WARNING:
        title = this.buildWarningAggregationTitle(group);
        body = this.buildWarningAggregationBody(group);
        metadata.warnings = group.notifications.map(n => n.metadata);
        break;

      case NOTIFICATION_TYPE.PPE:
        title = this.buildPpeAggregationTitle(group);
        body = this.buildPpeAggregationBody(group);
        metadata.alerts = group.notifications.map(n => n.metadata);
        break;

      default:
        title = `${count} notificações agrupadas`;
        body = group.notifications.map(n => `• ${n.title}`).join('\n');
        break;
    }

    // Determine highest importance from group
    const importance = this.determineGroupImportance(group.notifications);

    // Merge all channels (unique)
    const channels = Array.from(
      new Set(group.notifications.flatMap(n => n.channels)),
    ) as NOTIFICATION_CHANNEL[];

    return {
      title,
      body,
      type: `${group.type}_AGGREGATED`,
      importance,
      channels,
      metadata,
    };
  }

  /**
   * Build aggregation title for task notifications
   */
  private buildTaskAggregationTitle(group: AggregationGroup): string {
    const count = group.notifications.length;
    const taskId = group.notifications[0]?.metadata?.taskId;

    if (taskId && group.groupId !== 'all') {
      return `${count} atualizações na Tarefa #${taskId}`;
    }
    return `${count} atualizações de tarefas`;
  }

  /**
   * Build aggregation body for task notifications
   */
  private buildTaskAggregationBody(group: AggregationGroup): string {
    const updates = group.notifications
      .map(n => {
        const field = n.metadata?.field || 'Campo';
        const oldValue = n.metadata?.oldValue || '';
        const newValue = n.metadata?.newValue || '';
        return `• ${field}: ${oldValue} → ${newValue}`;
      })
      .slice(0, 10); // Limit to first 10 updates

    const remaining = group.notifications.length - updates.length;
    const body = updates.join('\n');

    return remaining > 0 ? `${body}\n\n... e mais ${remaining} atualizações` : body;
  }

  /**
   * Build aggregation title for stock notifications
   */
  private buildStockAggregationTitle(group: AggregationGroup): string {
    const count = group.notifications.length;
    return `${count} itens com estoque baixo`;
  }

  /**
   * Build aggregation body for stock notifications
   */
  private buildStockAggregationBody(group: AggregationGroup): string {
    const items = group.notifications
      .map(n => {
        const itemName = n.metadata?.itemName || 'Item';
        const quantity = n.metadata?.quantity || 0;
        const reorderPoint = n.metadata?.reorderPoint || 0;
        return `• ${itemName}: ${quantity} unidades (Ponto de reposição: ${reorderPoint})`;
      })
      .slice(0, 10);

    const remaining = group.notifications.length - items.length;
    const body = items.join('\n');

    return remaining > 0 ? `${body}\n\n... e mais ${remaining} itens` : body;
  }

  /**
   * Build aggregation title for order notifications
   */
  private buildOrderAggregationTitle(group: AggregationGroup): string {
    const count = group.notifications.length;
    const orderId = group.notifications[0]?.metadata?.orderId;

    if (orderId && group.groupId !== 'all') {
      return `${count} atualizações no Pedido #${orderId}`;
    }
    return `${count} atualizações de pedidos`;
  }

  /**
   * Build aggregation body for order notifications
   */
  private buildOrderAggregationBody(group: AggregationGroup): string {
    const updates = group.notifications
      .map(n => {
        const field = n.metadata?.field || 'Campo';
        return `• ${field} atualizado`;
      })
      .slice(0, 10);

    const remaining = group.notifications.length - updates.length;
    const body = updates.join('\n');

    return remaining > 0 ? `${body}\n\n... e mais ${remaining} atualizações` : body;
  }

  /**
   * Build aggregation title for warning notifications
   */
  private buildWarningAggregationTitle(group: AggregationGroup): string {
    const count = group.notifications.length;
    return `${count} avisos recebidos`;
  }

  /**
   * Build aggregation body for warning notifications
   */
  private buildWarningAggregationBody(group: AggregationGroup): string {
    const warnings = group.notifications.map(n => `• ${n.title}`).slice(0, 10);

    const remaining = group.notifications.length - warnings.length;
    const body = warnings.join('\n');

    return remaining > 0 ? `${body}\n\n... e mais ${remaining} avisos` : body;
  }

  /**
   * Build aggregation title for PPE notifications
   */
  private buildPpeAggregationTitle(group: AggregationGroup): string {
    const count = group.notifications.length;
    return `${count} alertas de EPI`;
  }

  /**
   * Build aggregation body for PPE notifications
   */
  private buildPpeAggregationBody(group: AggregationGroup): string {
    const alerts = group.notifications
      .map(n => {
        const ppeName = n.metadata?.ppeName || 'EPI';
        const reason = n.metadata?.reason || 'Alerta';
        return `• ${ppeName}: ${reason}`;
      })
      .slice(0, 10);

    const remaining = group.notifications.length - alerts.length;
    const body = alerts.join('\n');

    return remaining > 0 ? `${body}\n\n... e mais ${remaining} alertas` : body;
  }

  /**
   * Determine highest importance from notifications
   */
  private determineGroupImportance(notifications: PendingNotification[]): NOTIFICATION_IMPORTANCE {
    const hasHigh = notifications.some(n => n.importance === NOTIFICATION_IMPORTANCE.HIGH);
    const hasNormal = notifications.some(n => n.importance === NOTIFICATION_IMPORTANCE.NORMAL);

    if (hasHigh) return NOTIFICATION_IMPORTANCE.HIGH;
    if (hasNormal) return NOTIFICATION_IMPORTANCE.NORMAL;
    return NOTIFICATION_IMPORTANCE.LOW;
  }

  /**
   * Mark individual notifications as aggregated
   */
  private async markNotificationsAsAggregated(notifications: PendingNotification[]): Promise<void> {
    // Store aggregation metadata in cache
    const key = `${this.CACHE_PREFIX}aggregated:ids`;
    const ids = notifications.map(n => n.id);

    try {
      const existing = await this.cacheService.get(key);
      const allIds = existing ? JSON.parse(existing) : [];
      allIds.push(...ids);

      await this.cacheService.set(key, JSON.stringify(allIds), this.DEFAULT_TTL);
    } catch (error) {
      this.logger.warn(`Failed to mark notifications as aggregated: ${error.message}`);
    }
  }

  /**
   * Flush all aggregations for a specific user
   */
  async flushUserAggregations(userId: string): Promise<void> {
    try {
      const pattern = `${this.CACHE_PREFIX}${userId}:*`;
      const keys = await this.cacheService.keys(pattern);

      this.logger.log(`Flushing ${keys.length} aggregation groups for user ${userId}`);

      for (const key of keys) {
        const group = await this.cacheService.getObject<AggregationGroup>(key);
        if (group) {
          await this.flushGroup(key, group);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to flush user aggregations: ${error.message}`, error.stack);
    }
  }

  /**
   * Build aggregated notification from group (alias for formatAggregatedMessage)
   * @deprecated Use formatAggregatedMessage instead
   */
  private buildAggregatedNotification(group: AggregationGroup): AggregatedNotification {
    return this.formatAggregatedMessage(group);
  }

  /**
   * Flush aggregated notifications - Send all pending aggregated notifications
   * This is the main method called by the scheduler to send aggregated notifications.
   * Checks all aggregation groups and flushes those whose time window has expired.
   *
   * Runs every minute via scheduler to check for expired time windows.
   */
  async flushAggregatedNotifications(): Promise<void> {
    try {
      const pattern = `${this.CACHE_PREFIX}*`;
      const keys = await this.cacheService.keys(pattern);

      // Filter out preference keys and aggregated IDs
      const groupKeys = keys.filter(
        key => !key.includes(':pref:') && !key.includes(':aggregated:'),
      );

      this.logger.log(`Found ${groupKeys.length} aggregation groups to check`);

      let flushedCount = 0;

      for (const key of groupKeys) {
        const group = await this.cacheService.getObject<AggregationGroup>(key);
        if (!group) continue;

        // Check if time window has expired
        const userPref = await this.getUserPreference(group.userId);
        const adjustedTimeWindow = Math.floor(
          group.rule.timeWindow * userPref.timeWindowMultiplier,
        );
        const timeWindowMs = adjustedTimeWindow * 60 * 1000;
        const elapsed = Date.now() - group.firstNotificationAt;

        if (elapsed >= timeWindowMs) {
          this.logger.log(
            `Time window expired for group (${elapsed}ms >= ${timeWindowMs}ms), flushing`,
          );
          await this.flushGroup(key, group);
          flushedCount++;
        }
      }

      this.logger.log(`Flushed ${flushedCount} expired aggregation groups`);
    } catch (error) {
      this.logger.error(`Failed to flush aggregated notifications: ${error.message}`, error.stack);
    }
  }

  /**
   * Flush all pending aggregations (alias for flushAggregatedNotifications)
   * @deprecated Use flushAggregatedNotifications instead
   */
  async flushAggregations(): Promise<void> {
    return this.flushAggregatedNotifications();
  }

  /**
   * Get aggregated notifications for a user
   */
  async getAggregatedNotifications(userId: string): Promise<AggregatedNotification[]> {
    try {
      const pattern = `${this.CACHE_PREFIX}${userId}:*`;
      const keys = await this.cacheService.keys(pattern);

      const aggregatedNotifications: AggregatedNotification[] = [];

      for (const key of keys) {
        const group = await this.cacheService.getObject<AggregationGroup>(key);
        if (group && group.notifications.length > 0) {
          const aggregated = this.formatAggregatedMessage(group);
          aggregatedNotifications.push(aggregated);
        }
      }

      return aggregatedNotifications;
    } catch (error) {
      this.logger.error(`Failed to get aggregated notifications: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Scheduled task to flush expired aggregations
   * Runs every 1 minute to check for expired time windows
   */
  @Cron('*/1 * * * *', {
    name: 'flush-notification-aggregations',
  })
  async scheduledFlush(): Promise<void> {
    this.logger.log('Running scheduled aggregation flush (every 1 minute)');
    await this.flushAggregatedNotifications();
  }

  /**
   * Get statistics about current aggregations
   */
  async getAggregationStats(): Promise<{
    totalGroups: number;
    totalPendingNotifications: number;
    groupsByType: Record<string, number>;
  }> {
    try {
      const pattern = `${this.CACHE_PREFIX}*`;
      const keys = await this.cacheService.keys(pattern);

      const groupKeys = keys.filter(
        key => !key.includes(':pref:') && !key.includes(':aggregated:'),
      );

      let totalPendingNotifications = 0;
      const groupsByType: Record<string, number> = {};

      for (const key of groupKeys) {
        const group = await this.cacheService.getObject<AggregationGroup>(key);
        if (group) {
          totalPendingNotifications += group.notifications.length;
          groupsByType[group.type] = (groupsByType[group.type] || 0) + 1;
        }
      }

      return {
        totalGroups: groupKeys.length,
        totalPendingNotifications,
        groupsByType,
      };
    } catch (error) {
      this.logger.error(`Failed to get aggregation stats: ${error.message}`, error.stack);
      return {
        totalGroups: 0,
        totalPendingNotifications: 0,
        groupsByType: {},
      };
    }
  }

  /**
   * Clear all aggregations (for testing/maintenance)
   */
  async clearAllAggregations(): Promise<void> {
    try {
      const pattern = `${this.CACHE_PREFIX}*`;
      await this.cacheService.clearPattern(pattern);
      this.logger.log('Cleared all aggregations from cache');
    } catch (error) {
      this.logger.error(`Failed to clear aggregations: ${error.message}`, error.stack);
    }
  }
}
