import {
  Injectable,
  Logger,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { stringify } from 'csv-stringify/sync';
import { NOTIFICATION_CHANNEL, NOTIFICATION_TYPE } from '../../../constants';

/**
 * Date range interface for filtering analytics data
 */
export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Overall notification statistics
 */
export interface OverallStats {
  total: number;
  delivered: number;
  failed: number;
  seen: number;
  deliveryRate: number;
  seenRate: number;
  byType: Record<string, number>;
  byChannel: Record<string, number>;
}

/**
 * Delivery statistics by channel
 */
export interface DeliveryStats {
  email: { sent: number; delivered: number; failed: number };
  sms: { sent: number; delivered: number; failed: number };
  push: { sent: number; delivered: number; failed: number };
  whatsapp: { sent: number; delivered: number; failed: number };
  inApp: { sent: number; delivered: number };
}

/**
 * Time series data point
 */
export interface TimeSeriesPoint {
  time: Date;
  count: number;
}

/**
 * Failure reason statistics
 */
export interface FailureReason {
  reason: string | null;
  count: number;
}

/**
 * User engagement metrics
 */
export interface UserEngagement {
  received: number;
  seen: number;
  clicked: number;
  seenRate: number;
  clickRate: number;
  avgTimeToSee: number; // in minutes
}

/**
 * Top user metric
 */
export interface TopUser {
  userId: string;
  userName: string;
  userEmail: string | null;
  count: number;
}

/**
 * Notification Analytics Service
 * Provides comprehensive analytics and reporting for notification system
 *
 * Features:
 * - Overall statistics with delivery and seen rates
 * - Delivery statistics by channel
 * - Time series analysis (hourly/daily)
 * - Failure analysis with top reasons
 * - User engagement metrics
 * - Top users by various metrics
 * - CSV export functionality
 * - Performance optimized with caching
 */
@Injectable()
export class NotificationAnalyticsService {
  private readonly logger = new Logger(NotificationAnalyticsService.name);
  private readonly CACHE_TTL = 300; // 5 minutes cache

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Get overall notification statistics (alias for getNotificationStats)
   * Includes total counts, delivery rates, and breakdowns by type and channel
   *
   * @param dateRange - Optional date range for filtering
   * @returns Overall statistics object
   */
  async getOverallStats(dateRange?: DateRange): Promise<OverallStats> {
    return this.getNotificationStats(dateRange);
  }

  /**
   * Get notification statistics with detailed metrics
   * Includes total counts, delivery rates, and breakdowns by type and channel
   *
   * @param dateRange - Optional date range for filtering
   * @returns Overall statistics object
   */
  async getNotificationStats(dateRange?: DateRange): Promise<OverallStats> {
    try {
      const cacheKey = `analytics:overall:${dateRange?.start.toISOString() || 'all'}:${dateRange?.end.toISOString() || 'all'}`;
      const cached = await this.cacheService.get<OverallStats>(cacheKey);

      if (cached) {
        return cached;
      }

      const dateFilter = this.buildDateFilter(dateRange);

      const [total, delivered, failed, seen, byType, byChannel] = await Promise.all([
        this.countTotal(dateRange),
        this.countDelivered(dateRange),
        this.countFailed(dateRange),
        this.countSeen(dateRange),
        this.groupByType(dateRange),
        this.groupByChannel(dateRange),
      ]);

      const stats: OverallStats = {
        total,
        delivered,
        failed,
        seen,
        deliveryRate: total > 0 ? (delivered / total) * 100 : 0,
        seenRate: delivered > 0 ? (seen / delivered) * 100 : 0,
        byType,
        byChannel,
      };

      // Cache for 5 minutes
      await this.cacheService.set(cacheKey, stats, this.CACHE_TTL);

      return stats;
    } catch (error) {
      this.logger.error('Error getting notification stats:', error);
      throw new InternalServerErrorException('Failed to get notification statistics');
    }
  }

  /**
   * Get delivery statistics by channel (alias for getChannelStats)
   * Shows sent, delivered, and failed counts for each channel
   *
   * @param dateRange - Optional date range for filtering
   * @returns Delivery statistics by channel
   */
  async getDeliveryStats(dateRange?: DateRange): Promise<DeliveryStats> {
    return this.getChannelStats(dateRange);
  }

  /**
   * Get statistics per channel (EMAIL, PUSH, WHATSAPP, IN_APP)
   * Shows sent, delivered, and failed counts for each channel
   *
   * @param dateRange - Optional date range for filtering
   * @returns Delivery statistics by channel
   */
  async getChannelStats(dateRange?: DateRange): Promise<DeliveryStats> {
    try {
      const cacheKey = `analytics:delivery:${dateRange?.start.toISOString() || 'all'}:${dateRange?.end.toISOString() || 'all'}`;
      const cached = await this.cacheService.get<DeliveryStats>(cacheKey);

      if (cached) {
        return cached;
      }

      const dateFilter = this.buildDateFilter(dateRange);

      const deliveries = await this.prisma.notificationDelivery.groupBy({
        by: ['channel', 'status'],
        where: {
          notification: dateFilter,
        },
        _count: true,
      });

      const stats: DeliveryStats = {
        email: { sent: 0, delivered: 0, failed: 0 },
        sms: { sent: 0, delivered: 0, failed: 0 },
        push: { sent: 0, delivered: 0, failed: 0 },
        whatsapp: { sent: 0, delivered: 0, failed: 0 },
        inApp: { sent: 0, delivered: 0 },
      };

      for (const delivery of deliveries) {
        const channelKey = this.mapChannelToKey(delivery.channel);
        if (!channelKey || !stats[channelKey]) continue;

        const statusKey = delivery.status.toLowerCase();

        // Map status to appropriate field
        if (statusKey === 'delivered') {
          (stats[channelKey] as any).delivered = delivery._count;
          stats[channelKey].sent += delivery._count;
        } else if (statusKey === 'failed') {
          (stats[channelKey] as any).failed = delivery._count;
          stats[channelKey].sent += delivery._count;
        } else if (statusKey === 'pending' || statusKey === 'processing') {
          stats[channelKey].sent += delivery._count;
        }
      }

      // Cache for 5 minutes
      await this.cacheService.set(cacheKey, stats, this.CACHE_TTL);

      return stats;
    } catch (error) {
      this.logger.error('Error getting channel stats:', error);
      throw new InternalServerErrorException('Failed to get channel statistics');
    }
  }

  /**
   * Get statistics per notification type
   * Shows counts and metrics for each notification type
   *
   * @param dateRange - Optional date range for filtering
   * @returns Statistics by notification type
   */
  async getTypeStats(dateRange?: DateRange): Promise<Record<string, any>> {
    try {
      const cacheKey = `analytics:type-stats:${dateRange?.start.toISOString() || 'all'}:${dateRange?.end.toISOString() || 'all'}`;
      const cached = await this.cacheService.get<Record<string, any>>(cacheKey);

      if (cached) {
        return cached;
      }

      // Get delivery stats by type using proper Prisma query
      let deliveryByType: Array<{
        type: string;
        total: bigint;
        delivered: bigint;
        failed: bigint;
        seen: bigint;
      }>;

      if (dateRange) {
        deliveryByType = await this.prisma.$queryRaw`
          SELECT
            n.type,
            COUNT(DISTINCT n.id) as total,
            COUNT(DISTINCT CASE WHEN nd.status = 'DELIVERED' THEN nd.id END) as delivered,
            COUNT(DISTINCT CASE WHEN nd.status = 'FAILED' THEN nd.id END) as failed,
            COUNT(DISTINCT sn.id) as seen
          FROM "Notification" n
          LEFT JOIN "NotificationDelivery" nd ON nd."notificationId" = n.id
          LEFT JOIN "SeenNotification" sn ON sn."notificationId" = n.id
          WHERE n."createdAt" >= ${dateRange.start} AND n."createdAt" <= ${dateRange.end}
          GROUP BY n.type
        `;
      } else {
        deliveryByType = await this.prisma.$queryRaw`
          SELECT
            n.type,
            COUNT(DISTINCT n.id) as total,
            COUNT(DISTINCT CASE WHEN nd.status = 'DELIVERED' THEN nd.id END) as delivered,
            COUNT(DISTINCT CASE WHEN nd.status = 'FAILED' THEN nd.id END) as failed,
            COUNT(DISTINCT sn.id) as seen
          FROM "Notification" n
          LEFT JOIN "NotificationDelivery" nd ON nd."notificationId" = n.id
          LEFT JOIN "SeenNotification" sn ON sn."notificationId" = n.id
          GROUP BY n.type
        `;
      }

      const typeStats: Record<string, any> = {};

      for (const item of deliveryByType) {
        const total = Number(item.total);
        const delivered = Number(item.delivered);
        const failed = Number(item.failed);
        const seen = Number(item.seen);

        typeStats[item.type] = {
          total,
          delivered,
          failed,
          seen,
          deliveryRate: total > 0 ? (delivered / total) * 100 : 0,
          seenRate: delivered > 0 ? (seen / delivered) * 100 : 0,
          failureRate: total > 0 ? (failed / total) * 100 : 0,
        };
      }

      // Cache for 5 minutes
      await this.cacheService.set(cacheKey, typeStats, this.CACHE_TTL);

      return typeStats;
    } catch (error) {
      this.logger.error('Error getting type stats:', error);
      throw new InternalServerErrorException('Failed to get type statistics');
    }
  }

  /**
   * Calculate delivery success rate
   *
   * @param dateRange - Optional date range for filtering
   * @returns Delivery rate percentage
   */
  async getDeliveryRate(dateRange?: DateRange): Promise<number> {
    try {
      const [total, delivered] = await Promise.all([
        this.countTotal(dateRange),
        this.countDelivered(dateRange),
      ]);

      return total > 0 ? (delivered / total) * 100 : 0;
    } catch (error) {
      this.logger.error('Error calculating delivery rate:', error);
      throw new InternalServerErrorException('Failed to calculate delivery rate');
    }
  }

  /**
   * Calculate seen/read rate
   *
   * @param dateRange - Optional date range for filtering
   * @returns Seen rate percentage
   */
  async getSeenRate(dateRange?: DateRange): Promise<number> {
    try {
      const [delivered, seen] = await Promise.all([
        this.countDelivered(dateRange),
        this.countSeen(dateRange),
      ]);

      return delivered > 0 ? (seen / delivered) * 100 : 0;
    } catch (error) {
      this.logger.error('Error calculating seen rate:', error);
      throw new InternalServerErrorException('Failed to calculate seen rate');
    }
  }

  /**
   * Analyze failure reasons with detailed breakdown
   *
   * @param dateRange - Optional date range for filtering
   * @returns Failure analysis with reasons and counts
   */
  async getFailureAnalysis(dateRange?: DateRange): Promise<{
    totalFailures: number;
    failureRate: number;
    byReason: FailureReason[];
    byChannel: Record<string, number>;
  }> {
    try {
      const cacheKey = `analytics:failure-analysis:${dateRange?.start.toISOString() || 'all'}:${dateRange?.end.toISOString() || 'all'}`;
      const cached = await this.cacheService.get<any>(cacheKey);

      if (cached) {
        return cached;
      }

      const dateFilter = this.buildDateFilter(dateRange);

      const [total, failed, byReason, byChannelData] = await Promise.all([
        this.countTotal(dateRange),
        this.countFailed(dateRange),
        this.getFailureReasons(dateRange),
        this.prisma.notificationDelivery.groupBy({
          by: ['channel'],
          where: {
            status: 'FAILED',
            notification: dateFilter,
          },
          _count: true,
        }),
      ]);

      const byChannel: Record<string, number> = {};
      byChannelData.forEach(item => {
        byChannel[item.channel] = item._count;
      });

      const analysis = {
        totalFailures: failed,
        failureRate: total > 0 ? (failed / total) * 100 : 0,
        byReason,
        byChannel,
      };

      // Cache for 5 minutes
      await this.cacheService.set(cacheKey, analysis, this.CACHE_TTL);

      return analysis;
    } catch (error) {
      this.logger.error('Error analyzing failures:', error);
      throw new InternalServerErrorException('Failed to analyze failures');
    }
  }

  /**
   * Get time series data showing notification counts over time (alias)
   * Useful for trend analysis and identifying patterns
   *
   * @param dateRange - Date range for analysis
   * @param interval - Time interval ('hour' or 'day')
   * @returns Array of time series data points
   */
  async getTimeSeries(
    dateRange: DateRange,
    interval: 'hour' | 'day' = 'day',
  ): Promise<TimeSeriesPoint[]> {
    const data = await this.getTimeSeriesData(dateRange, interval);
    // The data already has time and count properties, so it satisfies TimeSeriesPoint interface
    return data as TimeSeriesPoint[];
  }

  /**
   * Get notification data over time for charts
   * Includes counts, delivery stats, and seen stats per time period
   *
   * @param dateRange - Date range for analysis
   * @param interval - Time interval ('hour' or 'day')
   * @returns Array of time series data points with detailed metrics
   */
  async getTimeSeriesData(
    dateRange: DateRange,
    interval: 'hour' | 'day' = 'day',
  ): Promise<
    Array<{
      time: Date;
      count: number;
      total: number;
      delivered: number;
      failed: number;
      seen: number;
      deliveryRate: number;
      seenRate: number;
    }>
  > {
    try {
      const cacheKey = `analytics:timeseries:${interval}:${dateRange.start.toISOString()}:${dateRange.end.toISOString()}`;
      const cached = await this.cacheService.get<any[]>(cacheKey);

      if (cached) {
        return cached;
      }

      // Use Prisma.sql for safe parameterized queries
      const truncFunction = interval === 'hour' ? 'hour' : 'day';

      const result = await this.prisma.$queryRawUnsafe<
        Array<{
          time: Date;
          total: bigint;
          delivered: bigint;
          failed: bigint;
          seen: bigint;
        }>
      >(
        `
          SELECT
            DATE_TRUNC('${truncFunction}', n."createdAt") as time,
            COUNT(DISTINCT n.id) as total,
            COUNT(DISTINCT CASE WHEN nd.status = 'DELIVERED' THEN nd.id END) as delivered,
            COUNT(DISTINCT CASE WHEN nd.status = 'FAILED' THEN nd.id END) as failed,
            COUNT(DISTINCT sn.id) as seen
          FROM "Notification" n
          LEFT JOIN "NotificationDelivery" nd ON nd."notificationId" = n.id
          LEFT JOIN "SeenNotification" sn ON sn."notificationId" = n.id
          WHERE n."createdAt" >= $1 AND n."createdAt" <= $2
          GROUP BY time
          ORDER BY time ASC
        `,
        dateRange.start,
        dateRange.end,
      );

      const timeSeries = result.map(row => {
        const total = Number(row.total);
        const delivered = Number(row.delivered);
        const failed = Number(row.failed);
        const seen = Number(row.seen);

        return {
          time: row.time,
          count: total,
          total,
          delivered,
          failed,
          seen,
          deliveryRate: total > 0 ? (delivered / total) * 100 : 0,
          seenRate: delivered > 0 ? (seen / delivered) * 100 : 0,
        };
      });

      // Cache for 5 minutes
      await this.cacheService.set(cacheKey, timeSeries, this.CACHE_TTL);

      return timeSeries;
    } catch (error) {
      this.logger.error('Error getting time series data:', error);
      throw new InternalServerErrorException('Failed to get time series data');
    }
  }

  /**
   * Get top failure reasons with counts
   * Helps identify common issues in notification delivery
   *
   * @param dateRange - Optional date range for filtering
   * @returns Array of failure reasons with counts
   */
  async getFailureReasons(dateRange?: DateRange): Promise<FailureReason[]> {
    try {
      const cacheKey = `analytics:failures:${dateRange?.start.toISOString() || 'all'}:${dateRange?.end.toISOString() || 'all'}`;
      const cached = await this.cacheService.get<FailureReason[]>(cacheKey);

      if (cached) {
        return cached;
      }

      const dateFilter = this.buildDateFilter(dateRange);

      const failures = await this.prisma.notificationDelivery.groupBy({
        by: ['errorMessage'],
        where: {
          status: 'FAILED',
          notification: dateFilter,
        },
        _count: true,
        orderBy: {
          _count: {
            errorMessage: 'desc',
          },
        },
        take: 10,
      });

      const reasons: FailureReason[] = failures.map(f => ({
        reason: f.errorMessage,
        count: f._count,
      }));

      // Cache for 5 minutes
      await this.cacheService.set(cacheKey, reasons, this.CACHE_TTL);

      return reasons;
    } catch (error) {
      this.logger.error('Error getting failure reasons:', error);
      throw new InternalServerErrorException('Failed to get failure reasons');
    }
  }

  /**
   * Get user engagement metrics
   * Shows how a specific user interacts with notifications
   *
   * @param userId - User ID to analyze
   * @param dateRange - Optional date range for filtering
   * @returns User engagement metrics
   */
  async getUserEngagement(userId: string, dateRange?: DateRange): Promise<UserEngagement> {
    try {
      const cacheKey = `analytics:user:${userId}:${dateRange?.start.toISOString() || 'all'}:${dateRange?.end.toISOString() || 'all'}`;
      const cached = await this.cacheService.get<UserEngagement>(cacheKey);

      if (cached) {
        return cached;
      }

      const dateFilter = this.buildDateFilter(dateRange);

      const [received, seen, clicked, avgTimeToSee] = await Promise.all([
        this.countUserNotifications(userId, dateRange),
        this.countUserSeenNotifications(userId, dateRange),
        this.countUserClickedNotifications(userId, dateRange),
        this.getAverageTimeToSee(userId, dateRange),
      ]);

      const engagement: UserEngagement = {
        received,
        seen,
        clicked,
        seenRate: received > 0 ? (seen / received) * 100 : 0,
        clickRate: received > 0 ? (clicked / received) * 100 : 0,
        avgTimeToSee,
      };

      // Cache for 5 minutes
      await this.cacheService.set(cacheKey, engagement, this.CACHE_TTL);

      return engagement;
    } catch (error) {
      this.logger.error(`Error getting user engagement for ${userId}:`, error);
      throw new InternalServerErrorException('Failed to get user engagement metrics');
    }
  }

  /**
   * Get top users by a specific metric
   * Useful for identifying most engaged or active users
   *
   * @param metric - Metric to rank by ('received', 'seen', or 'engaged')
   * @param limit - Number of top users to return (default: 10)
   * @returns Array of top users with counts
   */
  async getTopUsers(
    metric: 'received' | 'seen' | 'engaged' = 'received',
    limit: number = 10,
  ): Promise<TopUser[]> {
    try {
      const cacheKey = `analytics:topusers:${metric}:${limit}`;
      const cached = await this.cacheService.get<TopUser[]>(cacheKey);

      if (cached) {
        return cached;
      }

      let topUsers: TopUser[] = [];

      if (metric === 'received') {
        // Top users by received notifications
        const result = await this.prisma.notification.groupBy({
          by: ['userId'],
          _count: true,
          orderBy: {
            _count: {
              userId: 'desc',
            },
          },
          take: limit,
          where: {
            userId: {
              not: null,
            },
          },
        });

        const userIds = result.map(r => r.userId).filter((id): id is string => id !== null);
        const users = await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        });

        const userMap = new Map(users.map(u => [u.id, u]));

        topUsers = result.map(r => {
          const user = userMap.get(r.userId!);
          return {
            userId: r.userId!,
            userName: user?.name || 'Unknown',
            userEmail: user?.email || null,
            count: r._count,
          };
        });
      } else if (metric === 'seen') {
        // Top users by seen notifications
        const result = await this.prisma.seenNotification.groupBy({
          by: ['userId'],
          _count: true,
          orderBy: {
            _count: {
              userId: 'desc',
            },
          },
          take: limit,
        });

        const userIds = result.map(r => r.userId);
        const users = await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        });

        const userMap = new Map(users.map(u => [u.id, u]));

        topUsers = result.map(r => {
          const user = userMap.get(r.userId);
          return {
            userId: r.userId,
            userName: user?.name || 'Unknown',
            userEmail: user?.email || null,
            count: r._count,
          };
        });
      } else if (metric === 'engaged') {
        // Top users by engagement (notifications with actions taken)
        const result = await this.prisma.$queryRaw<
          Array<{
            userId: string;
            count: bigint;
          }>
        >`
          SELECT
            n."userId",
            COUNT(DISTINCT n.id) as count
          FROM "Notification" n
          INNER JOIN "SeenNotification" sn ON sn."notificationId" = n.id
          WHERE n."userId" IS NOT NULL
          GROUP BY n."userId"
          ORDER BY count DESC
          LIMIT ${limit}
        `;

        const userIds = result.map(r => r.userId);
        const users = await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        });

        const userMap = new Map(users.map(u => [u.id, u]));

        topUsers = result.map(r => {
          const user = userMap.get(r.userId);
          return {
            userId: r.userId,
            userName: user?.name || 'Unknown',
            userEmail: user?.email || null,
            count: Number(r.count),
          };
        });
      }

      // Cache for 10 minutes
      await this.cacheService.set(cacheKey, topUsers, 600);

      return topUsers;
    } catch (error) {
      this.logger.error(`Error getting top users for metric ${metric}:`, error);
      throw new InternalServerErrorException('Failed to get top users');
    }
  }

  /**
   * Export notifications to CSV format (alias)
   * Includes all relevant fields for reporting
   *
   * @param filters - Query filters for notifications
   * @returns CSV buffer
   */
  async exportToCSV(filters: any): Promise<Buffer> {
    return this.exportAnalytics(filters, 'csv');
  }

  /**
   * Export analytics data in various formats
   * Includes all relevant fields for reporting and analysis
   *
   * @param filters - Query filters for notifications
   * @param format - Export format ('csv' or 'json')
   * @param dateRange - Optional date range for filtering
   * @returns Exported data as Buffer (CSV) or JSON object
   */
  async exportAnalytics(
    filters: any = {},
    format: 'csv' | 'json' = 'csv',
    dateRange?: DateRange,
  ): Promise<Buffer | any> {
    try {
      // Merge filters with date range
      const whereClause = {
        ...filters,
        ...(dateRange ? this.buildDateFilter(dateRange) : {}),
      };

      const notifications = await this.prisma.notification.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          deliveries: {
            select: {
              channel: true,
              status: true,
              sentAt: true,
              deliveredAt: true,
              failedAt: true,
              errorMessage: true,
            },
          },
          seenBy: {
            select: {
              userId: true,
              seenAt: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 10000, // Limit for performance
      });

      const exportData = notifications.map(notification => {
        // Calculate time metrics
        const timeToDelivery =
          notification.sentAt && notification.deliveredAt
            ? Math.round(
                (notification.deliveredAt.getTime() - notification.sentAt.getTime()) / 1000,
              )
            : null;

        const timeToSeen =
          notification.deliveredAt && notification.seenBy[0]?.seenAt
            ? Math.round(
                (notification.seenBy[0].seenAt.getTime() - notification.deliveredAt.getTime()) /
                  1000 /
                  60,
              )
            : null;

        return {
          id: notification.id,
          title: notification.title,
          body: notification.body,
          type: notification.type,
          importance: notification.importance,
          userId: notification.userId || '',
          userName: notification.user?.name || '',
          userEmail: notification.user?.email || '',
          scheduledAt: notification.scheduledAt?.toISOString() || '',
          sentAt: notification.sentAt?.toISOString() || '',
          deliveredAt: notification.deliveredAt?.toISOString() || '',
          seenAt: notification.seenBy[0]?.seenAt?.toISOString() || '',
          seenCount: notification.seenBy.length,
          channels: notification.channel.join(', '),
          deliveredChannels: notification.deliveredChannels.join(', '),
          failedChannels: notification.failedChannels.join(', '),
          deliveryStatus: this.getOverallDeliveryStatus(notification.deliveries),
          retryCount: notification.retryCount,
          timeToDeliverySeconds: timeToDelivery,
          timeToSeenMinutes: timeToSeen,
          actionType: notification.actionType || '',
          actionUrl: notification.actionUrl || '',
          relatedEntityType: notification.relatedEntityType || '',
          relatedEntityId: notification.relatedEntityId || '',
          isMandatory: notification.isMandatory,
          createdAt: notification.createdAt.toISOString(),
          updatedAt: notification.updatedAt.toISOString(),
        };
      });

      if (format === 'json') {
        return exportData;
      }

      // CSV format
      const csv = stringify(exportData, {
        header: true,
        columns: [
          'id',
          'title',
          'body',
          'type',
          'importance',
          'userId',
          'userName',
          'userEmail',
          'scheduledAt',
          'sentAt',
          'deliveredAt',
          'seenAt',
          'seenCount',
          'channels',
          'deliveredChannels',
          'failedChannels',
          'deliveryStatus',
          'retryCount',
          'timeToDeliverySeconds',
          'timeToSeenMinutes',
          'actionType',
          'actionUrl',
          'relatedEntityType',
          'relatedEntityId',
          'isMandatory',
          'createdAt',
          'updatedAt',
        ],
      });

      return Buffer.from(csv);
    } catch (error) {
      this.logger.error('Error exporting analytics:', error);
      throw new InternalServerErrorException('Failed to export analytics data');
    }
  }

  // =====================
  // Private Helper Methods
  // =====================

  /**
   * Build date filter for Prisma queries
   */
  private buildDateFilter(dateRange?: DateRange): any {
    if (!dateRange) return {};

    return {
      createdAt: {
        gte: dateRange.start,
        lte: dateRange.end,
      },
    };
  }

  /**
   * Calculate average time to delivery in seconds
   */
  private async getAverageTimeToDelivery(dateRange?: DateRange): Promise<number> {
    const deliveries = await this.prisma.notificationDelivery.findMany({
      where: {
        status: 'DELIVERED',
        sentAt: { not: null },
        deliveredAt: { not: null },
        notification: this.buildDateFilter(dateRange),
      },
      select: {
        sentAt: true,
        deliveredAt: true,
      },
    });

    if (deliveries.length === 0) return 0;

    const times = deliveries
      .filter(d => d.sentAt && d.deliveredAt)
      .map(d => {
        const sentAt = d.sentAt!.getTime();
        const deliveredAt = d.deliveredAt!.getTime();
        return (deliveredAt - sentAt) / 1000; // Convert to seconds
      });

    return times.reduce((sum, time) => sum + time, 0) / times.length;
  }

  /**
   * Calculate average time from delivery to seen in minutes
   */
  private async getAverageTimeFromDeliveryToSeen(dateRange?: DateRange): Promise<number> {
    const seenNotifications = await this.prisma.seenNotification.findMany({
      where: {
        notification: this.buildDateFilter(dateRange),
      },
      include: {
        notification: {
          select: {
            deliveredAt: true,
          },
        },
      },
    });

    if (seenNotifications.length === 0) return 0;

    const times = seenNotifications
      .filter(sn => sn.notification.deliveredAt)
      .map(sn => {
        const deliveredAt = sn.notification.deliveredAt!.getTime();
        const seenAt = sn.seenAt.getTime();
        return (seenAt - deliveredAt) / (1000 * 60); // Convert to minutes
      });

    return times.reduce((sum, time) => sum + time, 0) / times.length;
  }

  /**
   * Count total notifications
   */
  private async countTotal(dateRange?: DateRange): Promise<number> {
    return this.prisma.notification.count({
      where: this.buildDateFilter(dateRange),
    });
  }

  /**
   * Count delivered notifications
   */
  private async countDelivered(dateRange?: DateRange): Promise<number> {
    return this.prisma.notificationDelivery.count({
      where: {
        status: 'DELIVERED',
        notification: this.buildDateFilter(dateRange),
      },
    });
  }

  /**
   * Count failed notifications
   */
  private async countFailed(dateRange?: DateRange): Promise<number> {
    return this.prisma.notificationDelivery.count({
      where: {
        status: 'FAILED',
        notification: this.buildDateFilter(dateRange),
      },
    });
  }

  /**
   * Count seen notifications
   */
  private async countSeen(dateRange?: DateRange): Promise<number> {
    return this.prisma.seenNotification.count({
      where: {
        notification: this.buildDateFilter(dateRange),
      },
    });
  }

  /**
   * Group notifications by type
   */
  private async groupByType(dateRange?: DateRange): Promise<Record<string, number>> {
    const result = await this.prisma.notification.groupBy({
      by: ['type'],
      where: this.buildDateFilter(dateRange),
      _count: true,
    });

    const byType: Record<string, number> = {};
    result.forEach(item => {
      byType[item.type] = item._count;
    });

    return byType;
  }

  /**
   * Group notifications by channel
   */
  private async groupByChannel(dateRange?: DateRange): Promise<Record<string, number>> {
    const notifications = await this.prisma.notification.findMany({
      where: this.buildDateFilter(dateRange),
      select: { channel: true },
    });

    const byChannel: Record<string, number> = {};
    notifications.forEach(notification => {
      notification.channel.forEach(channel => {
        byChannel[channel] = (byChannel[channel] || 0) + 1;
      });
    });

    return byChannel;
  }

  /**
   * Count user notifications
   */
  private async countUserNotifications(userId: string, dateRange?: DateRange): Promise<number> {
    return this.prisma.notification.count({
      where: {
        userId,
        ...this.buildDateFilter(dateRange),
      },
    });
  }

  /**
   * Count user seen notifications
   */
  private async countUserSeenNotifications(userId: string, dateRange?: DateRange): Promise<number> {
    return this.prisma.seenNotification.count({
      where: {
        userId,
        notification: this.buildDateFilter(dateRange),
      },
    });
  }

  /**
   * Count user clicked notifications (notifications with actions)
   */
  private async countUserClickedNotifications(
    userId: string,
    dateRange?: DateRange,
  ): Promise<number> {
    // Count notifications where user has seen them and they have an action URL
    return this.prisma.seenNotification.count({
      where: {
        userId,
        notification: {
          actionUrl: { not: null },
          ...this.buildDateFilter(dateRange),
        },
      },
    });
  }

  /**
   * Get average time to see notification in minutes
   */
  private async getAverageTimeToSee(userId: string, dateRange?: DateRange): Promise<number> {
    const seenNotifications = await this.prisma.seenNotification.findMany({
      where: {
        userId,
        notification: this.buildDateFilter(dateRange),
      },
      include: {
        notification: {
          select: {
            sentAt: true,
          },
        },
      },
    });

    const times = seenNotifications
      .filter(sn => sn.notification.sentAt)
      .map(sn => {
        const sentAt = sn.notification.sentAt!.getTime();
        const seenAt = sn.seenAt.getTime();
        return (seenAt - sentAt) / (1000 * 60); // Convert to minutes
      });

    if (times.length === 0) return 0;

    return times.reduce((sum, time) => sum + time, 0) / times.length;
  }

  /**
   * Map channel enum to delivery stats key
   */
  private mapChannelToKey(channel: string): keyof DeliveryStats | null {
    const mapping: Record<string, keyof DeliveryStats> = {
      EMAIL: 'email',
      PUSH: 'push',
      WHATSAPP: 'whatsapp',
      IN_APP: 'inApp',
    };

    return mapping[channel] || null;
  }

  /**
   * Get overall delivery status from deliveries
   */
  private getOverallDeliveryStatus(deliveries: any[]): string {
    if (deliveries.length === 0) return 'No deliveries';

    const hasDelivered = deliveries.some(d => d.status === 'DELIVERED');
    const hasFailed = deliveries.some(d => d.status === 'FAILED');
    const hasPending = deliveries.some(d => d.status === 'PENDING');

    if (hasDelivered && !hasFailed && !hasPending) return 'All delivered';
    if (hasFailed && !hasDelivered && !hasPending) return 'All failed';
    if (hasDelivered && hasFailed) return 'Partially delivered';
    if (hasPending) return 'Pending';

    return 'Unknown';
  }
}
