import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Logger,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES, NOTIFICATION_TYPE, NOTIFICATION_CHANNEL } from '../../../constants';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from './notification-queue.service';
import { NotificationAnalyticsService, DateRange } from './notification-analytics.service';
import { NotificationExportService, ExportFormat } from './notification-export.service';
import * as json2csv from 'json2csv';
import { Readable } from 'stream';

/**
 * Interface for notification list filters
 */
interface NotificationListFilters {
  type?: NOTIFICATION_TYPE;
  channel?: NOTIFICATION_CHANNEL;
  status?: 'sent' | 'scheduled' | 'pending';
  deliveryStatus?: 'delivered' | 'failed' | 'pending';
  userId?: string;
  sectorId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
  searchingFor?: string;
}

/**
 * Statistics response interface
 */
interface NotificationStats {
  total: number;
  byType: Record<string, number>;
  byChannel: Record<string, number>;
  deliveryRate: {
    email: { sent: number; delivered: number; failed: number };
    sms: { sent: number; delivered: number; failed: number };
    push: { sent: number; delivered: number; failed: number };
    whatsapp: { sent: number; delivered: number; failed: number };
    inApp: { sent: number; seen: number };
  };
  seenRate: number;
  averageDeliveryTime: number;
  failureReasons: Record<string, number>;
}

/**
 * Delivery report interface
 */
interface DeliveryReport {
  timeSeries: Array<{
    date: string;
    sent: number;
    delivered: number;
    failed: number;
  }>;
  channelPerformance: Array<{
    channel: string;
    sent: number;
    delivered: number;
    failed: number;
    successRate: number;
  }>;
  topFailureReasons: Array<{
    reason: string;
    count: number;
    percentage: number;
  }>;
  userEngagement: {
    totalSent: number;
    totalSeen: number;
    seenRate: number;
    averageSeenTime: number; // in minutes
  };
}

/**
 * User notification history interface
 */
interface UserNotificationHistory {
  user: {
    id: string;
    name: string;
    email: string;
  };
  notifications: Array<{
    id: string;
    title: string;
    body: string;
    type: string;
    importance: string;
    sentAt: Date | null;
    scheduledAt: Date | null;
    deliveries: Array<{
      channel: string;
      status: string;
      sentAt: Date | null;
      deliveredAt: Date | null;
      failedAt: Date | null;
      errorMessage: string | null;
    }>;
    isSeen: boolean;
    seenAt: Date | null;
  }>;
  preferences: Array<{
    notificationType: string;
    enabled: boolean;
    channels: string[];
  }>;
  stats: {
    totalReceived: number;
    totalSeen: number;
    seenRate: number;
  };
}

/**
 * Admin Controller for Notification Tracking and Analytics
 * Provides comprehensive endpoints for monitoring, analyzing, and managing notifications
 *
 * @security Admin-only access - all endpoints require ADMIN privileges
 */
@ApiTags('Admin - Notifications')
@ApiBearerAuth()
@ApiSecurity('admin-role')
@Controller('admin/notifications')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ADMIN)
export class NotificationAdminController {
  private readonly logger = new Logger(NotificationAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationQueueService: NotificationQueueService,
    private readonly analyticsService: NotificationAnalyticsService,
    private readonly exportService: NotificationExportService,
  ) {}

  /**
   * GET /admin/notifications
   * List all notifications with advanced filtering and pagination
   *
   * @param filters - Query parameters for filtering notifications
   * @returns Paginated list of notifications with metadata
   */
  @Get()
  @ApiOperation({
    summary: 'List all notifications (Admin)',
    description:
      'Retrieve all notifications with advanced filtering, pagination, and sorting. Admin only.',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: NOTIFICATION_TYPE,
    description: 'Filter by notification type',
  })
  @ApiQuery({
    name: 'channel',
    required: false,
    enum: NOTIFICATION_CHANNEL,
    description: 'Filter by notification channel',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['sent', 'scheduled', 'pending'],
    description: 'Filter by status',
  })
  @ApiQuery({
    name: 'deliveryStatus',
    required: false,
    enum: ['delivered', 'failed', 'pending'],
    description: 'Filter by delivery status',
  })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by user ID' })
  @ApiQuery({ name: 'sectorId', required: false, description: 'Filter by sector ID' })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description: 'Filter notifications from this date (ISO format)',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description: 'Filter notifications to this date (ISO format)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20)',
  })
  @ApiQuery({
    name: 'orderBy',
    required: false,
    description: 'Field to order by (default: createdAt)',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ['asc', 'desc'],
    description: 'Sort order (default: desc)',
  })
  @ApiQuery({
    name: 'searchingFor',
    required: false,
    description: 'Search text in title and body',
  })
  @ApiResponse({
    status: 200,
    description: 'Notifications retrieved successfully',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async listNotifications(@Query() filters: NotificationListFilters) {
    try {
      const {
        type,
        channel,
        status,
        deliveryStatus,
        userId,
        sectorId,
        dateFrom,
        dateTo,
        page = 1,
        limit = 20,
        orderBy = 'createdAt',
        order = 'desc',
        searchingFor,
      } = filters;

      // Build where clause with AND array to combine conditions properly
      const where: any = {};
      const andConditions: any[] = [];

      // Text search in title and body
      if (searchingFor && searchingFor.trim()) {
        const searchTerm = searchingFor.trim();
        andConditions.push({
          OR: [
            { title: { contains: searchTerm, mode: 'insensitive' } },
            { body: { contains: searchTerm, mode: 'insensitive' } },
          ],
        });
      }

      if (type) {
        where.type = type;
      }

      if (channel) {
        where.channel = {
          has: channel,
        };
      }

      if (status) {
        switch (status) {
          case 'sent':
            where.sentAt = { not: null };
            break;
          case 'scheduled':
            where.scheduledAt = { not: null, gt: new Date() };
            where.sentAt = null;
            break;
          case 'pending':
            where.sentAt = null;
            andConditions.push({
              OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
            });
            break;
        }
      }

      // Apply AND conditions if any
      if (andConditions.length > 0) {
        where.AND = andConditions;
      }

      if (userId) {
        where.userId = userId;
      }

      if (sectorId) {
        where.user = {
          sectorId,
        };
      }

      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) {
          where.createdAt.gte = new Date(dateFrom);
        }
        if (dateTo) {
          where.createdAt.lte = new Date(dateTo);
        }
      }

      // Add delivery status filter if specified
      if (deliveryStatus) {
        where.deliveries = {
          some: {
            status: deliveryStatus.toUpperCase(),
          },
        };
      }

      // Calculate pagination
      const skip = (page - 1) * limit;

      // Execute query
      const [notifications, total] = await Promise.all([
        this.prisma.notification.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                sector: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            deliveries: {
              select: {
                id: true,
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
            [orderBy]: order,
          },
          skip,
          take: limit,
        }),
        this.prisma.notification.count({ where }),
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        success: true,
        data: notifications,
        meta: {
          total,
          page,
          limit,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
        message: 'Notificações carregadas com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error listing notifications:', error);
      throw new InternalServerErrorException('Erro ao listar notificações. Tente novamente.');
    }
  }

  /**
   * GET /admin/notifications/:id
   * Get detailed information about a specific notification
   *
   * @param id - Notification ID
   * @returns Detailed notification data including deliveries, seen status, and user info
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get notification details (Admin)',
    description:
      'Retrieve detailed information about a specific notification including deliveries and metrics',
  })
  @ApiParam({ name: 'id', description: 'Notification UUID' })
  @ApiResponse({
    status: 200,
    description: 'Notification details retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Notification not found',
  })
  async getNotificationDetails(@Param('id') id: string) {
    try {
      const notification = await this.prisma.notification.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              sector: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          deliveries: {
            include: {
              notification: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
          seenBy: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
            orderBy: {
              seenAt: 'asc',
            },
          },
        },
      });

      if (!notification) {
        throw new NotFoundException('Notificação não encontrada.');
      }

      // Calculate additional metrics
      const deliveryMetrics = {
        totalDeliveries: notification.deliveries.length,
        deliveredCount: notification.deliveries.filter(d => d.status === 'DELIVERED').length,
        failedCount: notification.deliveries.filter(d => d.status === 'FAILED').length,
        pendingCount: notification.deliveries.filter(d => d.status === 'PENDING').length,
        averageDeliveryTime: this.calculateAverageDeliveryTime(notification.deliveries),
      };

      const seenMetrics = {
        totalSeen: notification.seenBy.length,
        firstSeenAt: notification.seenBy[0]?.seenAt || null,
        lastSeenAt: notification.seenBy[notification.seenBy.length - 1]?.seenAt || null,
      };

      return {
        success: true,
        data: {
          ...notification,
          metrics: {
            delivery: deliveryMetrics,
            seen: seenMetrics,
          },
        },
        message: 'Detalhes da notificação carregados com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error getting notification details for ${id}:`, error);
      throw new InternalServerErrorException(
        'Erro ao buscar detalhes da notificação. Tente novamente.',
      );
    }
  }

  /**
   * GET /admin/notifications/stats
   * Get comprehensive notification statistics
   *
   * @param dateFrom - Start date for stats (optional)
   * @param dateTo - End date for stats (optional)
   * @returns Comprehensive notification statistics
   */
  @Get('stats/overview')
  @ApiOperation({
    summary: 'Get notification statistics (Admin)',
    description:
      'Retrieve comprehensive notification statistics including delivery rates, seen rates, and failure reasons',
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description: 'Start date for statistics (ISO format)',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description: 'End date for statistics (ISO format)',
  })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
  })
  async getNotificationStats(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ): Promise<{ success: boolean; data: NotificationStats; message: string }> {
    try {
      const dateFilter: any = {};
      if (dateFrom) {
        dateFilter.gte = new Date(dateFrom);
      }
      if (dateTo) {
        dateFilter.lte = new Date(dateTo);
      }

      const whereClause = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

      // Get total notifications
      const total = await this.prisma.notification.count({ where: whereClause });

      // Get notifications by type
      const notificationsByType = await this.prisma.notification.groupBy({
        by: ['type'],
        _count: { type: true },
        where: whereClause,
      });

      const byType: Record<string, number> = {};
      notificationsByType.forEach(item => {
        byType[item.type] = item._count.type;
      });

      // Get notifications by channel (this is more complex since channel is an array)
      const allNotifications = await this.prisma.notification.findMany({
        where: whereClause,
        select: { channel: true },
      });

      const byChannel: Record<string, number> = {};
      allNotifications.forEach(notification => {
        notification.channel.forEach(channel => {
          byChannel[channel] = (byChannel[channel] || 0) + 1;
        });
      });

      // Get delivery statistics by channel
      const deliveries = await this.prisma.notificationDelivery.findMany({
        where: {
          notification: whereClause,
        },
        select: {
          channel: true,
          status: true,
          sentAt: true,
          deliveredAt: true,
        },
      });

      const deliveryRate = {
        email: { sent: 0, delivered: 0, failed: 0 },
        sms: { sent: 0, delivered: 0, failed: 0 },
        push: { sent: 0, delivered: 0, failed: 0 },
        whatsapp: { sent: 0, delivered: 0, failed: 0 },
        inApp: { sent: 0, seen: 0 },
      };

      deliveries.forEach(delivery => {
        const channelKey = this.mapChannelToKey(delivery.channel);
        if (channelKey && deliveryRate[channelKey]) {
          deliveryRate[channelKey].sent++;
          if (channelKey !== 'inApp') {
            if (delivery.status === 'DELIVERED') {
              (deliveryRate[channelKey] as any).delivered++;
            } else if (delivery.status === 'FAILED') {
              (deliveryRate[channelKey] as any).failed++;
            }
          }
        }
      });

      // Get seen statistics for in-app notifications
      const seenCount = await this.prisma.seenNotification.count({
        where: {
          notification: whereClause,
        },
      });

      const inAppNotifications = allNotifications.filter(n =>
        n.channel.includes('IN_APP' as any),
      ).length;

      deliveryRate.inApp.sent = inAppNotifications;
      deliveryRate.inApp.seen = seenCount;

      // Calculate overall seen rate
      const totalNotificationsSent = await this.prisma.notification.count({
        where: {
          ...whereClause,
          sentAt: { not: null },
        },
      });

      const seenRate = totalNotificationsSent > 0 ? (seenCount / totalNotificationsSent) * 100 : 0;

      // Calculate average delivery time
      const deliveredNotifications = deliveries.filter(d => d.sentAt && d.deliveredAt);

      const averageDeliveryTime =
        deliveredNotifications.length > 0
          ? deliveredNotifications.reduce((sum, d) => {
              const timeDiff = d.deliveredAt!.getTime() - d.sentAt!.getTime();
              return sum + timeDiff;
            }, 0) / deliveredNotifications.length
          : 0;

      // Get failure reasons
      const failedDeliveries = await this.prisma.notificationDelivery.findMany({
        where: {
          notification: whereClause,
          status: 'FAILED',
        },
        select: {
          errorMessage: true,
        },
      });

      const failureReasons: Record<string, number> = {};
      failedDeliveries.forEach(delivery => {
        const reason = delivery.errorMessage || 'Unknown error';
        failureReasons[reason] = (failureReasons[reason] || 0) + 1;
      });

      return {
        success: true,
        data: {
          total,
          byType,
          byChannel,
          deliveryRate,
          seenRate: Math.round(seenRate * 100) / 100,
          averageDeliveryTime: Math.round(averageDeliveryTime),
          failureReasons,
        },
        message: 'Estatísticas carregadas com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error getting notification stats:', error);
      throw new InternalServerErrorException('Erro ao buscar estatísticas. Tente novamente.');
    }
  }

  /**
   * GET /admin/notifications/delivery-report
   * Get comprehensive delivery report with time series and performance metrics
   *
   * @param dateFrom - Start date for report
   * @param dateTo - End date for report
   * @param groupBy - Group by 'day' or 'hour' (default: day)
   * @returns Detailed delivery report
   */
  @Get('reports/delivery')
  async getDeliveryReport(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('groupBy') groupBy: 'day' | 'hour' = 'day',
  ): Promise<{ success: boolean; data: DeliveryReport; message: string }> {
    try {
      const dateFilter: any = {};
      if (dateFrom) {
        dateFilter.gte = new Date(dateFrom);
      }
      if (dateTo) {
        dateFilter.lte = new Date(dateTo);
      }

      const whereClause = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

      // Get all deliveries in the date range
      const deliveries = await this.prisma.notificationDelivery.findMany({
        where: {
          notification: whereClause,
        },
        select: {
          channel: true,
          status: true,
          sentAt: true,
          deliveredAt: true,
          failedAt: true,
          errorMessage: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      // Generate time series data
      const timeSeries = this.generateTimeSeries(deliveries, groupBy);

      // Calculate channel performance
      const channelStats: Record<string, { sent: number; delivered: number; failed: number }> = {};

      deliveries.forEach(delivery => {
        const channel = delivery.channel;
        if (!channelStats[channel]) {
          channelStats[channel] = { sent: 0, delivered: 0, failed: 0 };
        }
        channelStats[channel].sent++;
        if (delivery.status === 'DELIVERED') {
          channelStats[channel].delivered++;
        } else if (delivery.status === 'FAILED') {
          channelStats[channel].failed++;
        }
      });

      const channelPerformance = Object.entries(channelStats).map(([channel, stats]) => ({
        channel,
        ...stats,
        successRate: stats.sent > 0 ? (stats.delivered / stats.sent) * 100 : 0,
      }));

      // Get top failure reasons
      const failureReasons: Record<string, number> = {};
      deliveries
        .filter(d => d.status === 'FAILED')
        .forEach(delivery => {
          const reason = delivery.errorMessage || 'Unknown error';
          failureReasons[reason] = (failureReasons[reason] || 0) + 1;
        });

      const totalFailures = Object.values(failureReasons).reduce((sum, count) => sum + count, 0);
      const topFailureReasons = Object.entries(failureReasons)
        .map(([reason, count]) => ({
          reason,
          count,
          percentage: totalFailures > 0 ? (count / totalFailures) * 100 : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Calculate user engagement metrics
      const sentNotifications = await this.prisma.notification.count({
        where: {
          ...whereClause,
          sentAt: { not: null },
        },
      });

      const seenNotifications = await this.prisma.seenNotification.findMany({
        where: {
          notification: whereClause,
        },
        include: {
          notification: {
            select: {
              sentAt: true,
            },
          },
        },
      });

      const totalSeen = seenNotifications.length;
      const seenRate = sentNotifications > 0 ? (totalSeen / sentNotifications) * 100 : 0;

      // Calculate average time to see notification (in minutes)
      const seenTimes = seenNotifications
        .filter(sn => sn.notification.sentAt)
        .map(sn => {
          const sentAt = sn.notification.sentAt!.getTime();
          const seenAt = sn.seenAt.getTime();
          return (seenAt - sentAt) / (1000 * 60); // Convert to minutes
        });

      const averageSeenTime =
        seenTimes.length > 0
          ? seenTimes.reduce((sum, time) => sum + time, 0) / seenTimes.length
          : 0;

      const userEngagement = {
        totalSent: sentNotifications,
        totalSeen,
        seenRate: Math.round(seenRate * 100) / 100,
        averageSeenTime: Math.round(averageSeenTime * 100) / 100,
      };

      return {
        success: true,
        data: {
          timeSeries,
          channelPerformance,
          topFailureReasons,
          userEngagement,
        },
        message: 'Relatório de entrega gerado com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error generating delivery report:', error);
      throw new InternalServerErrorException(
        'Erro ao gerar relatório de entrega. Tente novamente.',
      );
    }
  }

  /**
   * GET /admin/notifications/user/:userId
   * Get complete notification history for a specific user
   *
   * @param userId - User ID
   * @returns User's notification history with delivery status and preferences
   */
  @Get('user/:userId')
  async getUserNotificationHistory(
    @Param('userId') userId: string,
  ): Promise<{ success: boolean; data: UserNotificationHistory; message: string }> {
    try {
      // Get user info
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }

      // Get user's notifications
      const notifications = await this.prisma.notification.findMany({
        where: { userId },
        include: {
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
            where: { userId },
            select: {
              seenAt: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Format notifications
      const formattedNotifications = notifications.map(notification => ({
        id: notification.id,
        title: notification.title,
        body: notification.body,
        type: notification.type,
        importance: notification.importance,
        sentAt: notification.sentAt,
        scheduledAt: notification.scheduledAt,
        deliveries: notification.deliveries,
        isSeen: notification.seenBy.length > 0,
        seenAt: notification.seenBy[0]?.seenAt || null,
      }));

      // Get user's notification preferences
      const preferences = await this.prisma.userNotificationPreference.findMany({
        where: { userId },
        select: {
          notificationType: true,
          enabled: true,
          channels: true,
        },
      });

      // Calculate user stats
      const totalReceived = notifications.length;
      const totalSeen = notifications.filter(n => n.seenBy.length > 0).length;
      const seenRate = totalReceived > 0 ? (totalSeen / totalReceived) * 100 : 0;

      return {
        success: true,
        data: {
          user,
          notifications: formattedNotifications,
          preferences,
          stats: {
            totalReceived,
            totalSeen,
            seenRate: Math.round(seenRate * 100) / 100,
          },
        },
        message: 'Histórico de notificações do usuário carregado com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error getting user notification history for ${userId}:`, error);
      throw new InternalServerErrorException(
        'Erro ao buscar histórico de notificações. Tente novamente.',
      );
    }
  }

  /**
   * POST /admin/notifications/resend/:id
   * Resend a failed notification
   *
   * @param id - Notification ID
   * @returns Result of the resend operation
   */
  @Post('resend/:id')
  @ApiOperation({
    summary: 'Resend failed notification (Admin)',
    description: 'Retry sending a notification that previously failed delivery',
  })
  @ApiParam({ name: 'id', description: 'Notification UUID' })
  @ApiResponse({
    status: 200,
    description: 'Notification resend initiated successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Notification not found',
  })
  @ApiResponse({
    status: 400,
    description: 'No failed deliveries to resend',
  })
  async resendFailedNotification(@Param('id') id: string) {
    try {
      // Get notification
      const notification = await this.prisma.notification.findUnique({
        where: { id },
        include: {
          user: true,
          deliveries: {
            where: {
              status: 'FAILED',
            },
          },
        },
      });

      if (!notification) {
        throw new NotFoundException('Notificação não encontrada.');
      }

      if (notification.deliveries.length === 0) {
        throw new BadRequestException('Não há entregas falhadas para reenviar.');
      }

      // Track resend attempts
      const resendResults = [];

      for (const delivery of notification.deliveries) {
        try {
          // Reset delivery status to PENDING
          await this.prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'PENDING',
              errorMessage: null,
              sentAt: null,
              deliveredAt: null,
              failedAt: null,
            },
          });

          // Re-queue the notification job
          const channel = delivery.channel as NOTIFICATION_CHANNEL;
          let jobAdded = false;

          if (notification.user) {
            switch (channel) {
              case NOTIFICATION_CHANNEL.EMAIL:
                if (notification.user.email) {
                  await this.notificationQueueService.addEmailJob(
                    notification.id,
                    notification.user.email,
                    notification.title,
                    notification.body,
                    {
                      actionUrl: notification.actionUrl || undefined,
                      priority: 'high',
                    },
                  );
                  jobAdded = true;
                }
                break;

              case NOTIFICATION_CHANNEL.PUSH:
                // Push notifications would need device tokens
                this.logger.warn(
                  `Push notification resend not yet implemented for delivery ${delivery.id}`,
                );
                break;

              case NOTIFICATION_CHANNEL.IN_APP:
                if (notification.user.id) {
                  await this.notificationQueueService.addInAppJob(
                    notification.id,
                    notification.user.id,
                    notification.title,
                    notification.body,
                    {
                      actionUrl: notification.actionUrl || undefined,
                      priority: 'high',
                    },
                  );
                  jobAdded = true;
                }
                break;
            }
          }

          resendResults.push({
            deliveryId: delivery.id,
            channel: delivery.channel,
            success: jobAdded,
            message: jobAdded ? 'Re-queued successfully' : 'Could not re-queue',
          });
        } catch (error) {
          this.logger.error(`Error resending delivery ${delivery.id}:`, error);
          resendResults.push({
            deliveryId: delivery.id,
            channel: delivery.channel,
            success: false,
            message: error.message,
          });
        }
      }

      const successCount = resendResults.filter(r => r.success).length;
      const totalCount = resendResults.length;

      return {
        success: true,
        data: {
          notificationId: id,
          resendResults,
          summary: {
            total: totalCount,
            succeeded: successCount,
            failed: totalCount - successCount,
          },
        },
        message: `${successCount} de ${totalCount} entregas foram reenviadas com sucesso.`,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error resending notification ${id}:`, error);
      throw new InternalServerErrorException('Erro ao reenviar notificação. Tente novamente.');
    }
  }

  /**
   * GET /admin/notifications/export
   * Export notifications to CSV or Excel
   *
   * @param filters - Same filters as list endpoint
   * @param format - Export format (csv or xlsx)
   * @returns Export file as buffer with metadata
   */
  @Get('export')
  @ApiOperation({
    summary: 'Export notifications (Admin)',
    description: 'Export notifications to CSV or Excel format with filtering support',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['csv', 'xlsx'],
    description: 'Export format (default: csv)',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: NOTIFICATION_TYPE,
    description: 'Filter by notification type',
  })
  @ApiQuery({
    name: 'channel',
    required: false,
    enum: NOTIFICATION_CHANNEL,
    description: 'Filter by notification channel',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['sent', 'scheduled', 'pending'],
    description: 'Filter by status',
  })
  @ApiQuery({
    name: 'deliveryStatus',
    required: false,
    enum: ['delivered', 'failed', 'pending'],
    description: 'Filter by delivery status',
  })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by user ID' })
  @ApiQuery({ name: 'sectorId', required: false, description: 'Filter by sector ID' })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description: 'Filter from this date (ISO format)',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description: 'Filter to this date (ISO format)',
  })
  @ApiResponse({
    status: 200,
    description: 'Export completed successfully',
  })
  async exportNotifications(
    @Query() filters: NotificationListFilters,
    @Query('format') format: ExportFormat = 'csv',
  ) {
    try {
      const exportFilters = {
        type: filters.type,
        channel: filters.channel,
        status: filters.status,
        deliveryStatus: filters.deliveryStatus,
        userId: filters.userId,
        sectorId: filters.sectorId,
        dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
        dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
      };

      let exportBuffer: Buffer;
      if (format === 'csv') {
        exportBuffer = await this.exportService.exportToCSV(exportFilters);
      } else {
        exportBuffer = await this.exportService.exportToExcel(exportFilters);
      }

      const filename = this.exportService.generateExportFilename(format, 'notifications');

      return {
        success: true,
        data: {
          filename,
          content: exportBuffer.toString('base64'),
          size: exportBuffer.length,
          format,
        },
        message: 'Notificações exportadas com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error exporting notifications:', error);
      throw new InternalServerErrorException('Erro ao exportar notificações. Tente novamente.');
    }
  }

  /**
   * GET /admin/notifications/export/analytics
   * Export analytics data to CSV or Excel
   *
   * @param filters - Query filters
   * @param format - Export format (csv or xlsx)
   * @returns Export file as buffer with metadata
   */
  @Get('export/analytics')
  @ApiOperation({
    summary: 'Export analytics data (Admin)',
    description: 'Export notification analytics to CSV or Excel format',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['csv', 'xlsx'],
    description: 'Export format (default: csv)',
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description: 'Filter from this date (ISO format)',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description: 'Filter to this date (ISO format)',
  })
  @ApiResponse({
    status: 200,
    description: 'Analytics export completed successfully',
  })
  async exportNotificationAnalytics(
    @Query() filters: NotificationListFilters,
    @Query('format') format: ExportFormat = 'csv',
  ) {
    try {
      const exportFilters = {
        dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
        dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
      };

      const exportBuffer = await this.exportService.exportAnalytics(exportFilters, format);
      const filename = this.exportService.generateExportFilename(format, 'analytics');

      return {
        success: true,
        data: {
          filename,
          content: exportBuffer.toString('base64'),
          size: exportBuffer.length,
          format,
        },
        message: 'Analytics exportados com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error exporting analytics:', error);
      throw new InternalServerErrorException('Erro ao exportar analytics. Tente novamente.');
    }
  }

  /**
   * GET /admin/notifications/export/stream
   * Stream large exports to avoid memory issues
   *
   * @param filters - Query filters
   * @param format - Export format (csv or xlsx)
   * @returns Streamable file
   */
  @Get('export/stream')
  @ApiOperation({
    summary: 'Stream export for large datasets (Admin)',
    description: 'Stream notification export for large datasets to avoid memory issues',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['csv', 'xlsx'],
    description: 'Export format (default: csv)',
  })
  @ApiResponse({
    status: 200,
    description: 'Export stream started successfully',
  })
  async streamNotificationExport(
    @Query() filters: NotificationListFilters,
    @Query('format') format: ExportFormat = 'csv',
  ): Promise<StreamableFile> {
    try {
      const exportFilters = {
        type: filters.type,
        channel: filters.channel,
        status: filters.status,
        deliveryStatus: filters.deliveryStatus,
        userId: filters.userId,
        sectorId: filters.sectorId,
        dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
        dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
      };

      const stream = await this.exportService.streamExport(exportFilters, format);
      const filename = this.exportService.generateExportFilename(format, 'notifications');

      return new StreamableFile(stream, {
        type:
          format === 'csv'
            ? 'text/csv'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        disposition: `attachment; filename="${filename}"`,
      });
    } catch (error) {
      this.logger.error('Error streaming export:', error);
      throw new InternalServerErrorException('Erro ao fazer streaming da exportação.');
    }
  }

  /**
   * GET /admin/notifications/analytics/overview
   * Get comprehensive overview analytics
   *
   * @param dateFrom - Start date for analytics
   * @param dateTo - End date for analytics
   * @returns Overall statistics including delivery and seen rates
   */
  @Get('analytics/overview')
  async getAnalyticsOverview(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    try {
      const dateRange = this.parseDateRange(dateFrom, dateTo);
      const stats = await this.analyticsService.getOverallStats(dateRange);

      return {
        success: true,
        data: stats,
        message: 'Estatísticas gerais carregadas com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error getting analytics overview:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar estatísticas gerais. Tente novamente.',
      );
    }
  }

  /**
   * GET /admin/notifications/analytics/delivery
   * Get delivery statistics by channel
   *
   * @param dateFrom - Start date for analytics
   * @param dateTo - End date for analytics
   * @returns Delivery statistics broken down by channel
   */
  @Get('analytics/delivery')
  async getAnalyticsDelivery(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    try {
      const dateRange = this.parseDateRange(dateFrom, dateTo);
      const stats = await this.analyticsService.getDeliveryStats(dateRange);

      return {
        success: true,
        data: stats,
        message: 'Estatísticas de entrega carregadas com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error getting delivery analytics:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar estatísticas de entrega. Tente novamente.',
      );
    }
  }

  /**
   * GET /admin/notifications/analytics/time-series
   * Get time series data for trend analysis
   *
   * @param dateFrom - Start date (required)
   * @param dateTo - End date (required)
   * @param interval - Time interval ('hour' or 'day')
   * @returns Time series data points
   */
  @Get('analytics/time-series')
  async getAnalyticsTimeSeries(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('interval') interval: 'hour' | 'day' = 'day',
  ) {
    try {
      if (!dateFrom || !dateTo) {
        throw new BadRequestException('dateFrom and dateTo are required for time series');
      }

      const dateRange: DateRange = {
        start: new Date(dateFrom),
        end: new Date(dateTo),
      };

      const timeSeries = await this.analyticsService.getTimeSeries(dateRange, interval);

      return {
        success: true,
        data: timeSeries,
        message: 'Série temporal carregada com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error getting time series analytics:', error);
      throw new InternalServerErrorException('Erro ao buscar série temporal. Tente novamente.');
    }
  }

  /**
   * GET /admin/notifications/analytics/failures
   * Get top failure reasons
   *
   * @param dateFrom - Start date for analytics
   * @param dateTo - End date for analytics
   * @returns Top 10 failure reasons with counts
   */
  @Get('analytics/failures')
  async getAnalyticsFailures(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    try {
      const dateRange = this.parseDateRange(dateFrom, dateTo);
      const failures = await this.analyticsService.getFailureReasons(dateRange);

      return {
        success: true,
        data: failures,
        message: 'Motivos de falha carregados com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error getting failure analytics:', error);
      throw new InternalServerErrorException('Erro ao buscar motivos de falha. Tente novamente.');
    }
  }

  /**
   * GET /admin/notifications/analytics/users/:id
   * Get engagement analytics for a specific user
   *
   * @param id - User ID
   * @param dateFrom - Start date for analytics
   * @param dateTo - End date for analytics
   * @returns User engagement metrics
   */
  @Get('analytics/users/:id')
  async getUserAnalytics(
    @Param('id') id: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    try {
      const dateRange = this.parseDateRange(dateFrom, dateTo);
      const engagement = await this.analyticsService.getUserEngagement(id, dateRange);

      return {
        success: true,
        data: engagement,
        message: 'Métricas de engajamento do usuário carregadas com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error getting user analytics for ${id}:`, error);
      throw new InternalServerErrorException(
        'Erro ao buscar métricas de engajamento. Tente novamente.',
      );
    }
  }

  /**
   * GET /admin/notifications/analytics/top-users
   * Get top users by a specific metric
   *
   * @param metric - Metric to rank by ('received', 'seen', or 'engaged')
   * @param limit - Number of top users to return
   * @returns Top users with counts
   */
  @Get('analytics/top-users')
  async getTopUsers(
    @Query('metric') metric: 'received' | 'seen' | 'engaged' = 'received',
    @Query('limit') limit: number = 10,
  ) {
    try {
      const topUsers = await this.analyticsService.getTopUsers(metric, limit);

      return {
        success: true,
        data: topUsers,
        message: 'Top usuários carregados com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error getting top users:', error);
      throw new InternalServerErrorException('Erro ao buscar top usuários. Tente novamente.');
    }
  }

  /**
   * GET /admin/notifications/analytics/export
   * Export analytics data to CSV
   *
   * @param filters - Query parameters for filtering
   * @returns CSV buffer
   */
  @Get('analytics/export')
  async exportAnalytics(@Query() filters: NotificationListFilters) {
    try {
      const where = this.buildWhereClause(filters);
      const csvBuffer = await this.analyticsService.exportToCSV(where);

      return {
        success: true,
        data: {
          csv: csvBuffer.toString(),
          size: csvBuffer.length,
        },
        message: 'Dados exportados com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error exporting analytics:', error);
      throw new InternalServerErrorException('Erro ao exportar dados. Tente novamente.');
    }
  }

  // =====================
  // Helper Methods
  // =====================

  /**
   * Parse date range from query parameters
   */
  private parseDateRange(dateFrom?: string, dateTo?: string): DateRange | undefined {
    if (!dateFrom && !dateTo) {
      return undefined;
    }

    return {
      start: dateFrom ? new Date(dateFrom) : new Date(0),
      end: dateTo ? new Date(dateTo) : new Date(),
    };
  }

  /**
   * Build where clause from filters
   */
  private buildWhereClause(filters: NotificationListFilters): any {
    const where: any = {};

    if (filters.type) {
      where.type = filters.type;
    }

    if (filters.channel) {
      where.channel = { has: filters.channel };
    }

    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.sectorId) {
      where.user = { sectorId: filters.sectorId };
    }

    if (filters.status) {
      switch (filters.status) {
        case 'sent':
          where.sentAt = { not: null };
          break;
        case 'scheduled':
          where.scheduledAt = { not: null, gt: new Date() };
          where.sentAt = null;
          break;
        case 'pending':
          where.sentAt = null;
          break;
      }
    }

    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) {
        where.createdAt.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        where.createdAt.lte = new Date(filters.dateTo);
      }
    }

    return where;
  }

  /**
   * Calculate average delivery time from deliveries
   */
  private calculateAverageDeliveryTime(deliveries: any[]): number {
    const deliveredItems = deliveries.filter(d => d.sentAt && d.deliveredAt);

    if (deliveredItems.length === 0) {
      return 0;
    }

    const totalTime = deliveredItems.reduce((sum, delivery) => {
      const timeDiff = delivery.deliveredAt.getTime() - delivery.sentAt.getTime();
      return sum + timeDiff;
    }, 0);

    return Math.round(totalTime / deliveredItems.length);
  }

  /**
   * Map channel enum to stats key
   */
  private mapChannelToKey(channel: string): keyof NotificationStats['deliveryRate'] | null {
    const mapping: Record<string, keyof NotificationStats['deliveryRate']> = {
      EMAIL: 'email',
      PUSH: 'push',
      WHATSAPP: 'whatsapp',
      IN_APP: 'inApp',
    };

    return mapping[channel] || null;
  }

  /**
   * Generate time series data for delivery report
   */
  private generateTimeSeries(
    deliveries: any[],
    groupBy: 'day' | 'hour',
  ): Array<{ date: string; sent: number; delivered: number; failed: number }> {
    const timeSeriesMap: Map<string, { sent: number; delivered: number; failed: number }> =
      new Map();

    deliveries.forEach(delivery => {
      const date = delivery.createdAt;
      let key: string;

      if (groupBy === 'day') {
        key = date.toISOString().split('T')[0]; // YYYY-MM-DD
      } else {
        const hour = date.getHours().toString().padStart(2, '0');
        key = `${date.toISOString().split('T')[0]}T${hour}:00:00`; // YYYY-MM-DDTHH:00:00
      }

      if (!timeSeriesMap.has(key)) {
        timeSeriesMap.set(key, { sent: 0, delivered: 0, failed: 0 });
      }

      const stats = timeSeriesMap.get(key)!;
      stats.sent++;
      if (delivery.status === 'DELIVERED') {
        stats.delivered++;
      } else if (delivery.status === 'FAILED') {
        stats.failed++;
      }
    });

    return Array.from(timeSeriesMap.entries())
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get overall delivery status from multiple deliveries
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
