import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import {
  NotificationAggregationService,
  UserAggregationPreference,
} from './notification-aggregation.service';

/**
 * Controller for notification aggregation management
 */
@ApiTags('Notification Aggregation')
@ApiBearerAuth()
@Controller('notifications/aggregation')
@UseGuards(AuthGuard)
export class NotificationAggregationController {
  constructor(private readonly aggregationService: NotificationAggregationService) {}

  /**
   * Get user's aggregation preferences
   * GET /notifications/aggregation/preferences
   */
  @Get('preferences')
  async getUserPreferences(@Req() req: any) {
    const userId = req.user.id;
    const preferences = await this.aggregationService.getUserPreference(userId);

    return {
      success: true,
      data: preferences,
      message: 'Preferências de agregação carregadas com sucesso.',
    };
  }

  /**
   * Update user's aggregation preferences
   * PUT /notifications/aggregation/preferences
   */
  @Put('preferences')
  async updateUserPreferences(@Req() req: any, @Body() body: Partial<UserAggregationPreference>) {
    const userId = req.user.id;
    await this.aggregationService.updateUserPreference(userId, body);

    return {
      success: true,
      message: 'Preferências de agregação atualizadas com sucesso.',
    };
  }

  /**
   * Get pending aggregated notifications for the current user
   * GET /notifications/aggregation/pending
   */
  @Get('pending')
  async getPendingAggregations(@Req() req: any) {
    const userId = req.user.id;
    const aggregations = await this.aggregationService.getAggregatedNotifications(userId);

    return {
      success: true,
      data: aggregations,
      message: 'Notificações agregadas pendentes carregadas com sucesso.',
    };
  }

  /**
   * Manually flush aggregations for the current user
   * POST /notifications/aggregation/flush
   */
  @Post('flush')
  async flushUserAggregations(@Req() req: any) {
    const userId = req.user.id;
    await this.aggregationService.flushUserAggregations(userId);

    return {
      success: true,
      message: 'Notificações agregadas enviadas com sucesso.',
    };
  }

  /**
   * Get aggregation statistics (admin only)
   * GET /notifications/aggregation/stats
   */
  @Get('stats')
  async getAggregationStats() {
    const stats = await this.aggregationService.getAggregationStats();

    return {
      success: true,
      data: stats,
      message: 'Estatísticas de agregação carregadas com sucesso.',
    };
  }

  /**
   * Manually trigger aggregation flush for all users (admin only)
   * POST /notifications/aggregation/flush-all
   */
  @Post('flush-all')
  async flushAllAggregations() {
    await this.aggregationService.flushAggregations();

    return {
      success: true,
      message: 'Todas as notificações agregadas foram enviadas com sucesso.',
    };
  }

  /**
   * Clear all aggregations (admin only - for testing/maintenance)
   * POST /notifications/aggregation/clear-all
   */
  @Post('clear-all')
  async clearAllAggregations() {
    await this.aggregationService.clearAllAggregations();

    return {
      success: true,
      message: 'Todas as agregações foram limpas com sucesso.',
    };
  }
}
