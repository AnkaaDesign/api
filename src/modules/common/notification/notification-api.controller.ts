import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserId, User } from '../auth/decorators/user.decorator';
import { NotificationService } from './notification.service';
import { NotificationTrackingService } from './notification-tracking.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationAnalyticsService } from './notification-analytics.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { SECTOR_PRIVILEGES, NOTIFICATION_CHANNEL } from '../../../constants';
import {
  GetNotificationsFilterDto,
  MarkNotificationsReadDto,
  MarkNotificationDeliveredDto,
  SetNotificationReminderDto,
  SendNotificationDto,
  UpdateNotificationPreferencesDto,
  BulkUpdateNotificationPreferencesDto,
  AnalyticsQueryDto,
} from './dto/notification-api.dto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Main Notification API Controller
 * Handles user-facing notification endpoints
 */
@ApiTags('Notifications API')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationApiController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly trackingService: NotificationTrackingService,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly analyticsService: NotificationAnalyticsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /notifications
   * List notifications for current user with filtering
   */
  @Get()
  @ApiOperation({
    summary: 'Get notifications for current user',
    description:
      'Retrieve notifications for the authenticated user with optional filtering by type, status, and channel',
  })
  @ApiResponse({ status: 200, description: 'Notifications retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getNotifications(
    @UserId() userId: string,
    @User() user: any,
    @Query() filters: GetNotificationsFilterDto,
  ) {
    const { type, status, channel, page = 1, limit = 20 } = filters;

    // Build where clause based on filters
    const where: any = {
      userId,
    };

    // Filter by type
    if (type) {
      where.type = type;
    }

    // Filter by channel
    if (channel) {
      where.channel = {
        has: channel,
      };
    }

    // Filter by read status
    if (status === 'read') {
      where.seenBy = {
        some: {
          userId,
        },
      };
    } else if (status === 'unread') {
      where.seenBy = {
        none: {
          userId,
        },
      };
    }

    // Get notifications
    const result = await this.notificationService.getNotifications({
      where,
      page,
      limit,
      orderBy: { createdAt: 'desc' },
      include: {
        seenBy: true,
      },
    });

    // Add isRead flag to each notification
    const notificationsWithReadStatus = result.data.map(notification => ({
      ...notification,
      isRead: notification.seenBy.some(seen => seen.userId === userId),
    }));

    return {
      success: true,
      data: notificationsWithReadStatus,
      meta: result.meta,
      message: 'Notificações carregadas com sucesso.',
    };
  }

  /**
   * GET /notifications/:id
   * Get notification details
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get notification by ID',
    description: 'Retrieve detailed information about a specific notification',
  })
  @ApiParam({ name: 'id', description: 'Notification UUID' })
  @ApiResponse({ status: 200, description: 'Notification retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async getNotificationById(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    const notification = await this.notificationService.getNotificationById(id, {
      user: true,
      seenBy: true,
    });

    // Check if user has access to this notification
    if (notification.data.userId && notification.data.userId !== userId) {
      throw new BadRequestException('Você não tem permissão para acessar esta notificação.');
    }

    // Add isRead flag
    const isRead = notification.data.seenBy.some(seen => seen.userId === userId);

    return {
      success: true,
      data: {
        ...notification.data,
        isRead,
      },
      message: 'Notificação carregada com sucesso.',
    };
  }

  /**
   * POST /notifications/mark-read
   * Mark notifications as read
   */
  @Post('mark-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark notifications as read',
    description: 'Mark one or more notifications as read for the current user',
  })
  @ApiBody({ type: MarkNotificationsReadDto })
  @ApiResponse({ status: 200, description: 'Notifications marked as read successfully' })
  async markNotificationsRead(@Body() dto: MarkNotificationsReadDto, @UserId() userId: string) {
    const results = [];

    for (const notificationId of dto.notificationIds) {
      try {
        await this.trackingService.markAsSeen(notificationId, userId);
        results.push({
          notificationId,
          success: true,
        });
      } catch (error) {
        results.push({
          notificationId,
          success: false,
          error: error.message,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    return {
      success: true,
      data: {
        results,
        summary: {
          total: totalCount,
          succeeded: successCount,
          failed: totalCount - successCount,
        },
      },
      message: `${successCount} de ${totalCount} notificações marcadas como lidas.`,
    };
  }

  /**
   * POST /notifications/mark-all-as-read
   * Mark all notifications as read for current user
   */
  @Post('mark-all-as-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark all notifications as read',
    description: 'Mark all notifications as read for the current user',
  })
  @ApiResponse({ status: 200, description: 'All notifications marked as read successfully' })
  async markAllNotificationsAsRead(@UserId() userId: string) {
    const result = await this.notificationService.markAllAsRead(userId);

    return {
      success: true,
      data: {
        count: result.count,
      },
      message: `${result.count} notificações marcadas como lidas.`,
    };
  }

  /**
   * POST /notifications/mark-delivered
   * Mark notifications as delivered (internal use)
   */
  @Post('mark-delivered')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark notification as delivered',
    description:
      'Mark a notification as delivered on a specific channel (typically called by delivery systems)',
  })
  @ApiBody({ type: MarkNotificationDeliveredDto })
  @ApiResponse({ status: 200, description: 'Notification marked as delivered successfully' })
  async markNotificationDelivered(@Body() dto: MarkNotificationDeliveredDto) {
    await this.trackingService.markAsDelivered(dto.notificationId, dto.channel);

    return {
      success: true,
      message: 'Notificação marcada como entregue com sucesso.',
      data: {
        notificationId: dto.notificationId,
        channel: dto.channel,
        deliveredAt: new Date(),
      },
    };
  }

  /**
   * POST /notifications/:id/remind-later
   * Set reminder for notification
   */
  @Post(':id/remind-later')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set reminder for notification',
    description: 'Schedule a reminder for a notification at a specific time',
  })
  @ApiParam({ name: 'id', description: 'Notification UUID' })
  @ApiBody({ type: SetNotificationReminderDto })
  @ApiResponse({ status: 200, description: 'Reminder set successfully' })
  async setNotificationReminder(
    @Param('id', ParseUUIDPipe) notificationId: string,
    @Body() dto: SetNotificationReminderDto,
    @UserId() userId: string,
  ) {
    const remindAt = new Date(dto.remindAt);

    // Validate remind date is in the future
    if (remindAt <= new Date()) {
      throw new BadRequestException('A data do lembrete deve estar no futuro.');
    }

    await this.trackingService.setReminder(notificationId, userId, remindAt);

    return {
      success: true,
      message: 'Lembrete definido com sucesso.',
      data: {
        notificationId,
        remindAt: remindAt.toISOString(),
      },
    };
  }

  /**
   * GET /notifications/stats
   * Get notification statistics for current user
   */
  @Get('stats')
  @ApiOperation({
    summary: 'Get notification statistics',
    description: 'Retrieve notification statistics for the current user',
  })
  @ApiResponse({ status: 200, description: 'Statistics retrieved successfully' })
  async getNotificationStats(@UserId() userId: string) {
    const stats = await this.trackingService.getUserNotificationStats(userId);

    return {
      success: true,
      data: stats,
      message: 'Estatísticas carregadas com sucesso.',
    };
  }

  /**
   * GET /notifications/preferences
   * Get notification preferences for current user
   */
  @Get('preferences')
  @ApiOperation({
    summary: 'Get notification preferences',
    description: 'Retrieve notification preferences for the current user',
  })
  @ApiResponse({ status: 200, description: 'Preferences retrieved successfully' })
  async getNotificationPreferences(@UserId() userId: string) {
    const preferences = await this.preferenceService.getUserPreferences(userId);

    return {
      success: true,
      data: preferences,
      message: 'Preferências carregadas com sucesso.',
    };
  }

  /**
   * POST /notifications/preferences
   * Update notification preferences
   */
  @Post('preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update notification preferences',
    description: 'Update notification preferences for the current user',
  })
  @ApiBody({ type: BulkUpdateNotificationPreferencesDto })
  @ApiResponse({ status: 200, description: 'Preferences updated successfully' })
  async updateNotificationPreferences(
    @Body() dto: BulkUpdateNotificationPreferencesDto,
    @UserId() userId: string,
  ) {
    const results = [];

    for (const pref of dto.preferences) {
      try {
        const updated = await this.preferenceService.updatePreference(
          userId,
          pref.notificationType,
          pref.eventType || '',
          pref.channels,
          userId,
          false,
        );

        results.push({
          notificationType: pref.notificationType,
          eventType: pref.eventType,
          success: true,
          data: updated,
        });
      } catch (error) {
        results.push({
          notificationType: pref.notificationType,
          eventType: pref.eventType,
          success: false,
          error: error.message,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    return {
      success: true,
      data: {
        results,
        summary: {
          total: totalCount,
          succeeded: successCount,
          failed: totalCount - successCount,
        },
      },
      message: `${successCount} de ${totalCount} preferências atualizadas com sucesso.`,
    };
  }
}

/**
 * Admin Notification API Controller
 * Handles admin-only notification endpoints
 */
@ApiTags('Admin - Notifications API')
@ApiBearerAuth()
@Controller('admin/notifications')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ADMIN)
export class NotificationAdminApiController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly analyticsService: NotificationAnalyticsService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /admin/notifications/send
   * Send notification (admin only)
   */
  @Post('send')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Send notification (Admin)',
    description: 'Send a notification to specific user(s) or sectors. Admin only.',
  })
  @ApiBody({ type: SendNotificationDto })
  @ApiResponse({ status: 201, description: 'Notification sent successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async sendNotification(@Body() dto: SendNotificationDto, @UserId() adminUserId: string) {
    // If targeting specific user
    if (dto.userId) {
      const notification = await this.notificationService.createNotification(
        {
          userId: dto.userId,
          title: dto.title,
          body: dto.body,
          type: dto.type,
          channel: dto.channel,
          importance: dto.importance || 'NORMAL',
          actionUrl: dto.actionUrl,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        },
        {
          user: true,
        },
        adminUserId,
      );

      // Dispatch immediately if not scheduled
      if (!dto.scheduledAt) {
        await this.dispatchService.dispatchNotification(notification.data.id);
      }

      return {
        success: true,
        data: notification.data,
        message: dto.scheduledAt
          ? 'Notificação agendada com sucesso.'
          : 'Notificação enviada com sucesso.',
      };
    }

    // If targeting sectors - create notifications for all users in those sectors
    if (dto.targetSectors && dto.targetSectors.length > 0) {
      const users = await this.prisma.user.findMany({
        where: {
          sector: {
            privileges: {
              in: dto.targetSectors as any,
            },
          },
        },
        select: {
          id: true,
        },
      });

      const notifications = [];
      for (const user of users) {
        const notification = await this.notificationService.createNotification(
          {
            userId: user.id,
            title: dto.title,
            body: dto.body,
            type: dto.type,
            channel: dto.channel,
            importance: dto.importance || 'NORMAL',
            actionUrl: dto.actionUrl,
            scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
          },
          undefined,
          adminUserId,
        );

        notifications.push(notification.data);

        // Dispatch immediately if not scheduled
        if (!dto.scheduledAt) {
          await this.dispatchService.dispatchNotification(notification.data.id);
        }
      }

      return {
        success: true,
        data: {
          notificationCount: notifications.length,
          targetUsers: users.length,
          notifications: notifications.slice(0, 10), // Return first 10 for preview
        },
        message: `${notifications.length} notificações ${dto.scheduledAt ? 'agendadas' : 'enviadas'} com sucesso.`,
      };
    }

    // If targeting specific users by ID
    if (dto.targetUsers && dto.targetUsers.length > 0) {
      const notifications = [];
      for (const userId of dto.targetUsers) {
        const notification = await this.notificationService.createNotification(
          {
            userId,
            title: dto.title,
            body: dto.body,
            type: dto.type,
            channel: dto.channel,
            importance: dto.importance || 'NORMAL',
            actionUrl: dto.actionUrl,
            scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
          },
          undefined,
          adminUserId,
        );

        notifications.push(notification.data);

        // Dispatch immediately if not scheduled
        if (!dto.scheduledAt) {
          await this.dispatchService.dispatchNotification(notification.data.id);
        }
      }

      return {
        success: true,
        data: {
          notificationCount: notifications.length,
          targetUsers: dto.targetUsers.length,
          notifications: notifications.slice(0, 10), // Return first 10 for preview
        },
        message: `${notifications.length} notificações ${dto.scheduledAt ? 'agendadas' : 'enviadas'} com sucesso.`,
      };
    }

    // If no targeting specified - send to all active users
    const allUsers = await this.prisma.user.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    const notifications = [];
    for (const user of allUsers) {
      const notification = await this.notificationService.createNotification(
        {
          userId: user.id,
          title: dto.title,
          body: dto.body,
          type: dto.type,
          channel: dto.channel,
          importance: dto.importance || 'NORMAL',
          actionUrl: dto.actionUrl,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        },
        undefined,
        adminUserId,
      );

      notifications.push(notification.data);

      // Dispatch immediately if not scheduled
      if (!dto.scheduledAt) {
        await this.dispatchService.dispatchNotification(notification.data.id);
      }
    }

    return {
      success: true,
      data: {
        notificationCount: notifications.length,
        targetUsers: allUsers.length,
        notifications: notifications.slice(0, 10), // Return first 10 for preview
      },
      message: `${notifications.length} notificações ${dto.scheduledAt ? 'agendadas' : 'enviadas'} para todos os usuários ativos.`,
    };
  }

  /**
   * GET /admin/notifications/analytics
   * Get notification analytics (admin only)
   */
  @Get('analytics')
  @ApiOperation({
    summary: 'Get notification analytics (Admin)',
    description:
      'Retrieve comprehensive notification analytics including delivery rates and user engagement. Admin only.',
  })
  @ApiResponse({ status: 200, description: 'Analytics retrieved successfully' })
  async getNotificationAnalytics(@Query() query: AnalyticsQueryDto) {
    const dateRange =
      query.dateFrom && query.dateTo
        ? {
            start: new Date(query.dateFrom),
            end: new Date(query.dateTo),
          }
        : undefined;

    const [overallStats, deliveryStats] = await Promise.all([
      this.analyticsService.getOverallStats(dateRange),
      this.analyticsService.getDeliveryStats(dateRange),
    ]);

    return {
      success: true,
      data: {
        overall: overallStats,
        delivery: deliveryStats,
        period: dateRange
          ? {
              start: dateRange.start.toISOString(),
              end: dateRange.end.toISOString(),
            }
          : {
              start: null,
              end: null,
              note: 'All time statistics',
            },
      },
      message: 'Análise de notificações carregada com sucesso.',
    };
  }
}
