import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { CurrentUser, UserId } from '@common/decorators/current-user.decorator';
import { NotificationReminderSchedulerService } from './notification-reminder-scheduler.service';
import {
  ScheduleReminderDto,
  RescheduleReminderDto,
  CancelReminderDto,
  CleanupRemindersDto,
  ReminderStatsResponseDto,
  ReminderOptionResponseDto,
  ReminderWithDataResponseDto,
  ManualProcessingResponseDto,
  CleanupResponseDto,
  ReminderSuccessResponseDto,
} from './dto/notification-reminder.dto';

/**
 * Controller for notification reminder operations
 *
 * Provides endpoints for:
 * - Scheduling reminders
 * - Cancelling reminders
 * - Rescheduling reminders
 * - Getting reminder statistics
 * - Managing user reminders
 * - Cleanup operations
 */
@ApiTags('Notification Reminders')
@Controller('notifications/reminders')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class NotificationReminderController {
  constructor(private readonly reminderSchedulerService: NotificationReminderSchedulerService) {}

  /**
   * Get available reminder time options
   */
  @Get('options')
  @ApiOperation({
    summary: 'Get reminder time options',
    description:
      'Returns list of available reminder intervals (5min, 15min, 1hr, 3hr, tomorrow, next week)',
  })
  @ApiResponse({
    status: 200,
    description: 'Reminder options retrieved successfully',
    type: [ReminderOptionResponseDto],
  })
  getReminderOptions(): ReminderOptionResponseDto[] {
    return this.reminderSchedulerService.getReminderOptions();
  }

  /**
   * Schedule a reminder for a notification
   */
  @Post('schedule')
  @ApiOperation({
    summary: 'Schedule a notification reminder',
    description:
      'Schedule a reminder to re-send a notification at a later time. Maximum 3 reminders per notification.',
  })
  @ApiResponse({
    status: 201,
    description: 'Reminder scheduled successfully',
    type: ReminderWithDataResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request or max reminders reached' })
  @ApiResponse({ status: 404, description: 'Notification or user not found' })
  async scheduleReminder(
    @Body() dto: ScheduleReminderDto,
    @UserId() userId: string,
  ): Promise<ReminderWithDataResponseDto> {
    return await this.reminderSchedulerService.scheduleReminder(
      dto.notificationId,
      userId,
      dto.interval,
    );
  }

  /**
   * Cancel a scheduled reminder
   */
  @Delete('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a scheduled reminder',
    description: 'Cancel an active reminder for a notification',
  })
  @ApiResponse({
    status: 200,
    description: 'Reminder cancelled successfully',
    type: ReminderSuccessResponseDto,
  })
  @ApiResponse({ status: 404, description: 'No active reminder found' })
  async cancelReminder(
    @Body() dto: CancelReminderDto,
    @UserId() userId: string,
  ): Promise<ReminderSuccessResponseDto> {
    await this.reminderSchedulerService.cancelReminder(dto.notificationId, userId);
    return {
      success: true,
      message: 'Reminder cancelled successfully',
    };
  }

  /**
   * Reschedule an existing reminder
   */
  @Post('reschedule')
  @ApiOperation({
    summary: 'Reschedule an existing reminder',
    description: 'Change the time of an existing reminder',
  })
  @ApiResponse({
    status: 200,
    description: 'Reminder rescheduled successfully',
    type: ReminderWithDataResponseDto,
  })
  @ApiResponse({ status: 404, description: 'No active reminder found' })
  async rescheduleReminder(
    @Body() dto: RescheduleReminderDto,
    @UserId() userId: string,
  ): Promise<ReminderWithDataResponseDto> {
    return await this.reminderSchedulerService.rescheduleReminder(
      dto.notificationId,
      userId,
      dto.newInterval,
    );
  }

  /**
   * Get current user's reminders
   */
  @Get('my-reminders')
  @ApiOperation({
    summary: 'Get my reminders',
    description: 'Get all active reminders for the current user',
  })
  @ApiResponse({
    status: 200,
    description: 'Reminders retrieved successfully',
    type: [ReminderWithDataResponseDto],
  })
  async getMyReminders(@UserId() userId: string): Promise<ReminderWithDataResponseDto[]> {
    return await this.reminderSchedulerService.getUserReminders(userId);
  }

  /**
   * Cancel all reminders for current user
   */
  @Delete('my-reminders')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel all my reminders',
    description: 'Cancel all active reminders for the current user',
  })
  @ApiResponse({
    status: 200,
    description: 'All reminders cancelled successfully',
    type: ReminderSuccessResponseDto,
  })
  async cancelMyReminders(@UserId() userId: string): Promise<ReminderSuccessResponseDto> {
    const count = await this.reminderSchedulerService.cancelUserReminders(userId);
    return {
      success: true,
      message: `Successfully cancelled ${count} reminder(s)`,
      data: { count },
    };
  }

  /**
   * Get reminder statistics (admin only)
   */
  @Get('stats')
  @ApiOperation({
    summary: 'Get reminder statistics',
    description: 'Get statistics about all pending reminders (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
    type: ReminderStatsResponseDto,
  })
  async getReminderStats(): Promise<ReminderStatsResponseDto> {
    return await this.reminderSchedulerService.getReminderStats();
  }

  /**
   * Manually trigger reminder processing (admin only)
   */
  @Post('process')
  @ApiOperation({
    summary: 'Manually trigger reminder processing',
    description: 'Manually process all due reminders (admin only, useful for testing)',
  })
  @ApiResponse({
    status: 200,
    description: 'Processing completed',
    type: ManualProcessingResponseDto,
  })
  async triggerProcessing(): Promise<ManualProcessingResponseDto> {
    return await this.reminderSchedulerService.triggerManualProcessing();
  }

  /**
   * Cleanup expired reminders (admin only)
   */
  @Delete('cleanup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cleanup expired reminders',
    description: 'Remove reminders older than specified days (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Cleanup completed',
    type: CleanupResponseDto,
  })
  async cleanupReminders(@Query() dto: CleanupRemindersDto): Promise<CleanupResponseDto> {
    const count = await this.reminderSchedulerService.cleanupExpiredReminders(dto.daysOld);
    return {
      count,
      message: `Successfully cleaned up ${count} expired reminder(s)`,
    };
  }

  /**
   * Get reminders for a specific user (admin only)
   */
  @Get('user/:userId')
  @ApiOperation({
    summary: 'Get reminders for a specific user',
    description: 'Get all active reminders for a specific user (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Reminders retrieved successfully',
    type: [ReminderWithDataResponseDto],
  })
  async getUserReminders(@Param('userId') userId: string): Promise<ReminderWithDataResponseDto[]> {
    return await this.reminderSchedulerService.getUserReminders(userId);
  }

  /**
   * Cancel all reminders for a specific user (admin only)
   */
  @Delete('user/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel all reminders for a user',
    description: 'Cancel all active reminders for a specific user (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'All reminders cancelled successfully',
    type: ReminderSuccessResponseDto,
  })
  async cancelUserReminders(@Param('userId') userId: string): Promise<ReminderSuccessResponseDto> {
    const count = await this.reminderSchedulerService.cancelUserReminders(userId);
    return {
      success: true,
      message: `Successfully cancelled ${count} reminder(s) for user ${userId}`,
      data: { count },
    };
  }
}
