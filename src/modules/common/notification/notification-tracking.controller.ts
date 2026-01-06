import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { NotificationService } from './notification.service';
import { NotificationReminderScheduler } from './notification-reminder.scheduler';
import { NOTIFICATION_CHANNEL } from '../../../constants';

/**
 * DTO for marking notification as seen
 */
class MarkAsSeenDto {
  notificationId: string;
}

/**
 * DTO for setting a reminder
 */
class SetReminderDto {
  remindAt: string; // ISO date string
}

/**
 * DTO for marking as delivered
 */
class MarkAsDeliveredDto {
  channel: NOTIFICATION_CHANNEL;
}

/**
 * Controller for notification tracking operations
 * Handles seen status, reminders, delivery tracking, and statistics
 */
@ApiTags('Notification Tracking')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationTrackingController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly reminderScheduler: NotificationReminderScheduler,
  ) {}

  /**
   * POST /notifications/:id/seen
   * Mark a notification as seen by the authenticated user
   */
  @Post(':id/seen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark notification as seen',
    description: 'Mark a notification as seen/read by the authenticated user',
  })
  @ApiParam({ name: 'id', description: 'Notification UUID' })
  @ApiResponse({
    status: 200,
    description: 'Notification marked as seen successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Notification not found',
  })
  async markAsSeen(@Param('id') notificationId: string, @Request() req: any) {
    const userId = req.user.id;

    await this.notificationService.markAsSeen(notificationId, userId);

    return {
      success: true,
      message: 'Notificação marcada como vista com sucesso.',
    };
  }

  /**
   * POST /notifications/:id/remind
   * Set a reminder for a notification
   */
  @Post(':id/remind')
  @HttpCode(HttpStatus.OK)
  async setReminder(
    @Param('id') notificationId: string,
    @Body() dto: SetReminderDto,
    @Request() req: any,
  ) {
    const userId = req.user.id;

    // Validate and parse remindAt date
    const remindAt = new Date(dto.remindAt);
    if (isNaN(remindAt.getTime())) {
      throw new BadRequestException('Data de lembrete inválida.');
    }

    if (remindAt <= new Date()) {
      throw new BadRequestException('A data de lembrete deve estar no futuro.');
    }

    await this.notificationService.setReminder(notificationId, userId, remindAt);

    return {
      success: true,
      message: 'Lembrete definido com sucesso.',
      data: {
        remindAt: remindAt.toISOString(),
      },
    };
  }

  /**
   * POST /notifications/:id/delivered
   * Mark a notification as delivered on a specific channel
   * (Internal endpoint, typically called by notification dispatchers)
   */
  @Post(':id/delivered')
  @HttpCode(HttpStatus.OK)
  async markAsDelivered(@Param('id') notificationId: string, @Body() dto: MarkAsDeliveredDto) {
    // Validate channel
    const validChannels = Object.values(NOTIFICATION_CHANNEL);
    if (!validChannels.includes(dto.channel)) {
      throw new BadRequestException('Canal de notificação inválido.');
    }

    await this.notificationService.markAsDelivered(notificationId, dto.channel);

    return {
      success: true,
      message: 'Notificação marcada como entregue com sucesso.',
      data: {
        channel: dto.channel,
        deliveredAt: new Date().toISOString(),
      },
    };
  }

  /**
   * GET /notifications/:id/delivery-status
   * Get delivery status for a notification across all channels
   */
  @Get(':id/delivery-status')
  async getDeliveryStatus(@Param('id') notificationId: string) {
    const deliveries = await this.notificationService.getDeliveryStatus(notificationId);

    return {
      success: true,
      message: 'Status de entrega carregado com sucesso.',
      data: deliveries,
    };
  }

  /**
   * GET /notifications/:id/stats
   * Get delivery statistics for a notification
   */
  @Get(':id/stats')
  async getNotificationStats(@Param('id') notificationId: string) {
    const stats = await this.notificationService.getDeliveryStats(notificationId);

    return {
      success: true,
      message: 'Estatísticas de notificação carregadas com sucesso.',
      data: stats,
    };
  }

  /**
   * GET /users/:userId/notifications/unseen
   * Get unseen notifications for a user
   */
  @Get('users/:userId/unseen')
  async getUnseenNotifications(@Param('userId') userId: string, @Request() req: any) {
    // Ensure user can only access their own unseen notifications
    if (req.user.id !== userId && !req.user.isAdmin) {
      throw new BadRequestException('Você não tem permissão para acessar essas notificações.');
    }

    const notifications = await this.notificationService.getUnseenNotifications(userId);

    return {
      success: true,
      message: 'Notificações não vistas carregadas com sucesso.',
      data: notifications,
      meta: {
        total: notifications.length,
      },
    };
  }

  /**
   * GET /users/:userId/notifications/unseen-count
   * Get count of unseen notifications for a user
   */
  @Get('users/:userId/unseen-count')
  async getUnseenCount(@Param('userId') userId: string, @Request() req: any) {
    // Ensure user can only access their own unseen count
    if (req.user.id !== userId && !req.user.isAdmin) {
      throw new BadRequestException('Você não tem permissão para acessar essa informação.');
    }

    const count = await this.notificationService.getUnseenCount(userId);

    return {
      success: true,
      message: 'Contagem de notificações não vistas carregada com sucesso.',
      data: {
        count,
      },
    };
  }

  /**
   * GET /users/:userId/notifications/stats
   * Get notification statistics for a user
   */
  @Get('users/:userId/stats')
  async getUserNotificationStats(@Param('userId') userId: string, @Request() req: any) {
    // Ensure user can only access their own stats
    if (req.user.id !== userId && !req.user.isAdmin) {
      throw new BadRequestException('Você não tem permissão para acessar essas estatísticas.');
    }

    const stats = await this.notificationService.getUserNotificationStats(userId);

    return {
      success: true,
      message: 'Estatísticas de notificações do usuário carregadas com sucesso.',
      data: stats,
    };
  }

  /**
   * GET /users/:userId/reminders
   * Get all reminders for a user
   */
  @Get('users/:userId/reminders')
  async getUserReminders(@Param('userId') userId: string, @Request() req: any) {
    // Ensure user can only access their own reminders
    if (req.user.id !== userId && !req.user.isAdmin) {
      throw new BadRequestException('Você não tem permissão para acessar esses lembretes.');
    }

    const reminders = await this.reminderScheduler.getUserReminders(userId);

    return {
      success: true,
      message: 'Lembretes carregados com sucesso.',
      data: reminders,
      meta: {
        total: reminders.length,
      },
    };
  }

  /**
   * POST /users/:userId/reminders/cancel-all
   * Cancel all reminders for a user
   */
  @Post('users/:userId/reminders/cancel-all')
  @HttpCode(HttpStatus.OK)
  async cancelAllReminders(@Param('userId') userId: string, @Request() req: any) {
    // Ensure user can only cancel their own reminders
    if (req.user.id !== userId && !req.user.isAdmin) {
      throw new BadRequestException('Você não tem permissão para cancelar esses lembretes.');
    }

    const count = await this.reminderScheduler.cancelUserReminders(userId);

    return {
      success: true,
      message: `${count} lembretes cancelados com sucesso.`,
      data: {
        cancelledCount: count,
      },
    };
  }

  /**
   * GET /reminders/stats
   * Get reminder statistics (admin only)
   */
  @Get('reminders/stats')
  async getReminderStats(@Request() req: any) {
    // Admin-only endpoint
    if (!req.user.isAdmin) {
      throw new BadRequestException('Você não tem permissão para acessar essas estatísticas.');
    }

    const stats = await this.reminderScheduler.getReminderStats();

    return {
      success: true,
      message: 'Estatísticas de lembretes carregadas com sucesso.',
      data: stats,
    };
  }

  /**
   * POST /reminders/process
   * Manually trigger reminder processing (admin only)
   */
  @Post('reminders/process')
  @HttpCode(HttpStatus.OK)
  async triggerReminderProcessing(@Request() req: any) {
    // Admin-only endpoint
    if (!req.user.isAdmin) {
      throw new BadRequestException('Você não tem permissão para executar essa ação.');
    }

    const result = await this.reminderScheduler.triggerManualProcessing();

    return {
      success: true,
      message: 'Processamento de lembretes concluído.',
      data: result,
    };
  }
}
