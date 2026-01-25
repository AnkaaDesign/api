import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationGatewayService } from './notification-gateway.service';
import { ChangeLogService } from '../changelog/changelog.service';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../../constants';

/**
 * Reminder time interval options
 */
export enum REMINDER_INTERVAL {
  FIVE_MINUTES = '5min',
  FIFTEEN_MINUTES = '15min',
  ONE_HOUR = '1hr',
  THREE_HOURS = '3hr',
  TOMORROW = 'tomorrow',
  NEXT_WEEK = 'next_week',
}

/**
 * Reminder option metadata
 */
export interface ReminderOption {
  value: REMINDER_INTERVAL;
  label: string;
  description: string;
  milliseconds: number;
}

/**
 * Reminder statistics
 */
export interface ReminderStats {
  totalPending: number;
  overdue: number;
  upcoming: number;
  byUser: Record<string, number>;
  byInterval: Record<string, number>;
}

/**
 * Reminder with notification data
 */
export interface ReminderWithData {
  id: string;
  userId: string;
  notificationId: string;
  remindAt: Date;
  seenAt: Date;
  reminderCount: number;
  notification: {
    id: string;
    title: string;
    body: string;
    type: string;
    importance: string;
    actionUrl?: string;
    actionType?: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
  };
}

/**
 * Maximum number of reminders allowed per notification
 */
const MAX_REMINDERS_PER_NOTIFICATION = 3;

/**
 * NotificationReminderScheduler Service
 *
 * Handles "remind me later" functionality for notifications:
 * - Schedule reminders with various time intervals
 * - Process due reminders via cron job
 * - Re-send notifications through original channels
 * - Manage reminder lifecycle (create, cancel, reschedule)
 * - Cleanup expired reminders
 * - Enforce max reminder limits
 */
@Injectable()
export class NotificationReminderSchedulerService {
  private readonly logger = new Logger(NotificationReminderSchedulerService.name);
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly gatewayService: NotificationGatewayService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Get available reminder time options
   * Returns list of predefined intervals with metadata
   */
  getReminderOptions(): ReminderOption[] {
    const now = new Date();

    return [
      {
        value: REMINDER_INTERVAL.FIVE_MINUTES,
        label: '5 minutes',
        description: 'Remind me in 5 minutes',
        milliseconds: 5 * 60 * 1000,
      },
      {
        value: REMINDER_INTERVAL.FIFTEEN_MINUTES,
        label: '15 minutes',
        description: 'Remind me in 15 minutes',
        milliseconds: 15 * 60 * 1000,
      },
      {
        value: REMINDER_INTERVAL.ONE_HOUR,
        label: '1 hour',
        description: 'Remind me in 1 hour',
        milliseconds: 60 * 60 * 1000,
      },
      {
        value: REMINDER_INTERVAL.THREE_HOURS,
        label: '3 hours',
        description: 'Remind me in 3 hours',
        milliseconds: 3 * 60 * 60 * 1000,
      },
      {
        value: REMINDER_INTERVAL.TOMORROW,
        label: 'Tomorrow',
        description: 'Remind me tomorrow at 9 AM',
        milliseconds: this.calculateTomorrowMs(now),
      },
      {
        value: REMINDER_INTERVAL.NEXT_WEEK,
        label: 'Next week',
        description: 'Remind me next Monday at 9 AM',
        milliseconds: this.calculateNextWeekMs(now),
      },
    ];
  }

  /**
   * Schedule a reminder for a notification
   *
   * @param notificationId - The notification to remind about
   * @param userId - The user to remind
   * @param interval - Time interval for reminder
   * @throws BadRequestException if validation fails
   * @throws NotFoundException if notification or user not found
   */
  async scheduleReminder(
    notificationId: string,
    userId: string,
    interval: REMINDER_INTERVAL,
  ): Promise<ReminderWithData> {
    this.logger.log(`Scheduling reminder for notification ${notificationId}, user ${userId}`);

    return await this.prisma.$transaction(async tx => {
      // 1. Verify notification exists
      const notification = await (tx as any).notification.findUnique({
        where: { id: notificationId },
      });

      if (!notification) {
        throw new NotFoundException('Notification not found');
      }

      // 2. Verify user exists
      const user = await (tx as any).user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // 3. Check if SeenNotification exists
      let seenNotification = await (tx as any).seenNotification.findUnique({
        where: {
          userId_notificationId: {
            userId,
            notificationId,
          },
        },
      });

      // 4. If not seen yet, create SeenNotification record
      if (!seenNotification) {
        seenNotification = await (tx as any).seenNotification.create({
          data: {
            userId,
            notificationId,
            seenAt: new Date(),
          },
        });
      }

      // 5. Check reminder count limit
      const reminderCount = await this.getReminderCount(notificationId, userId, tx);
      if (reminderCount >= MAX_REMINDERS_PER_NOTIFICATION) {
        throw new BadRequestException(
          `Maximum ${MAX_REMINDERS_PER_NOTIFICATION} reminders reached for this notification`,
        );
      }

      // 6. Calculate reminder time
      let remindAt = this.calculateReminderTime(interval);

      // 6.5. Validate work hours for non-urgent notifications
      // If reminder would trigger outside work hours, adjust to next 7:30 AM
      if (notification.importance !== 'URGENT') {
        remindAt = this.adjustReminderForWorkHours(remindAt);
      }

      // 7. Update SeenNotification with reminder time
      const updated = await (tx as any).seenNotification.update({
        where: { id: seenNotification.id },
        data: {
          remindAt,
        },
        include: {
          notification: true,
          user: true,
        },
      });

      // 8. Log the reminder scheduling
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
        entityId: seenNotification.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'remindAt',
        oldValue: seenNotification.remindAt,
        newValue: remindAt,
        reason: `Reminder scheduled for ${interval} (${remindAt.toISOString()})`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: userId,
        userId: userId,
        transaction: tx,
      });

      this.logger.log(
        `Reminder scheduled successfully for notification ${notificationId} at ${remindAt}`,
      );

      return {
        ...updated,
        reminderCount: reminderCount + 1,
      };
    });
  }

  /**
   * Cancel a scheduled reminder
   *
   * @param notificationId - The notification ID
   * @param userId - The user ID
   * @throws NotFoundException if reminder not found
   */
  async cancelReminder(notificationId: string, userId: string): Promise<void> {
    this.logger.log(`Cancelling reminder for notification ${notificationId}, user ${userId}`);

    await this.prisma.$transaction(async tx => {
      // Find the SeenNotification with active reminder
      const seenNotification = await (tx as any).seenNotification.findUnique({
        where: {
          userId_notificationId: {
            userId,
            notificationId,
          },
        },
      });

      if (!seenNotification || !seenNotification.remindAt) {
        throw new NotFoundException('No active reminder found for this notification');
      }

      // Clear the remindAt field
      await (tx as any).seenNotification.update({
        where: { id: seenNotification.id },
        data: {
          remindAt: null,
        },
      });

      // Log the cancellation
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
        entityId: seenNotification.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'remindAt',
        oldValue: seenNotification.remindAt,
        newValue: null,
        reason: 'Reminder cancelled by user',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: userId,
        userId: userId,
        transaction: tx,
      });
    });

    this.logger.log(`Reminder cancelled successfully for notification ${notificationId}`);
  }

  /**
   * Reschedule an existing reminder
   *
   * @param notificationId - The notification ID
   * @param userId - The user ID
   * @param newInterval - New time interval
   * @throws NotFoundException if reminder not found
   * @throws BadRequestException if validation fails
   */
  async rescheduleReminder(
    notificationId: string,
    userId: string,
    newInterval: REMINDER_INTERVAL,
  ): Promise<ReminderWithData> {
    this.logger.log(`Rescheduling reminder for notification ${notificationId}, user ${userId}`);

    return await this.prisma.$transaction(async tx => {
      // Find existing reminder
      const seenNotification = await (tx as any).seenNotification.findUnique({
        where: {
          userId_notificationId: {
            userId,
            notificationId,
          },
        },
      });

      if (!seenNotification || !seenNotification.remindAt) {
        throw new NotFoundException('No active reminder found for this notification');
      }

      // Calculate new reminder time
      const newRemindAt = this.calculateReminderTime(newInterval);
      const oldRemindAt = seenNotification.remindAt;

      // Update reminder time
      const updated = await (tx as any).seenNotification.update({
        where: { id: seenNotification.id },
        data: {
          remindAt: newRemindAt,
        },
        include: {
          notification: true,
          user: true,
        },
      });

      // Log the rescheduling
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
        entityId: seenNotification.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'remindAt',
        oldValue: oldRemindAt,
        newValue: newRemindAt,
        reason: `Reminder rescheduled from ${oldRemindAt.toISOString()} to ${newRemindAt.toISOString()} (${newInterval})`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: userId,
        userId: userId,
        transaction: tx,
      });

      const reminderCount = await this.getReminderCount(notificationId, userId, tx);

      this.logger.log(
        `Reminder rescheduled successfully for notification ${notificationId} to ${newRemindAt}`,
      );

      return {
        ...updated,
        reminderCount,
      };
    });
  }

  /**
   * Process due reminders - Main cron job
   * Runs every minute to check for notifications that need reminding
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processReminders(): Promise<void> {
    // Prevent concurrent execution
    if (this.isProcessing) {
      this.logger.warn('Reminder processing already in progress, skipping...');
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();
    let processedCount = 0;
    let errorCount = 0;

    try {
      this.logger.log('Starting notification reminder processing...');

      // Find all due reminders
      const now = new Date();
      const reminders = await this.prisma.seenNotification.findMany({
        where: {
          remindAt: {
            lte: now,
            not: null,
          },
        },
        include: {
          notification: true,
          user: true,
        },
      });

      this.logger.log(`Found ${reminders.length} due reminders to process`);

      // Process each reminder
      for (const reminder of reminders) {
        try {
          await this.processSingleReminder(reminder);
          processedCount++;
        } catch (error) {
          errorCount++;
          this.logger.error(
            `Failed to process reminder ${reminder.id} for notification ${reminder.notificationId}:`,
            error.stack,
          );
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Reminder processing completed in ${duration}ms. Processed: ${processedCount}, Errors: ${errorCount}`,
      );
    } catch (error) {
      this.logger.error('Error during reminder processing:', error.stack);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single reminder
   * Re-sends the notification through original channels
   *
   * @param reminder - The reminder to process
   */
  private async processSingleReminder(reminder: any): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const notification = reminder.notification;
      const user = reminder.user;

      this.logger.log(`Processing reminder for notification ${notification.id}, user ${user.id}`);

      // 1. Re-send notification via WebSocket (in-app)
      try {
        await this.gatewayService.sendToUser(user.id, {
          ...notification,
          isReminder: true,
          remindedAt: new Date(),
          reminderNote: 'This is a reminder notification',
        });
        this.logger.log(
          `Sent reminder notification ${notification.id} to user ${user.id} via WebSocket`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to send reminder notification via WebSocket for user ${user.id}: ${error.message}`,
        );
      }

      // 2. Optionally re-dispatch through original channels
      // This will respect user's notification preferences and send via email, SMS, etc.
      try {
        // Check if notification has channels defined
        if (notification.channel && notification.channel.length > 0) {
          await this.dispatchService.dispatchNotification(notification.id);
          this.logger.log(
            `Re-dispatched reminder notification ${notification.id} through channels`,
          );
        }
      } catch (error) {
        // Don't fail the entire process if dispatch fails
        this.logger.warn(
          `Failed to re-dispatch reminder notification ${notification.id}: ${error.message}`,
        );
      }

      // 3. Clear the remindAt field
      await (tx as any).seenNotification.update({
        where: { id: reminder.id },
        data: {
          remindAt: null,
        },
      });

      // 4. Log the reminder processing
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
        entityId: reminder.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'remindAt',
        oldValue: reminder.remindAt,
        newValue: null,
        reason: 'Reminder processed and notification re-sent',
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
        triggeredById: 'reminder-scheduler',
        userId: user.id,
        transaction: tx,
      });

      // 5. Log notification re-dispatch
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.NOTIFICATION,
        entityId: notification.id,
        action: CHANGE_ACTION.UPDATE,
        reason: `Notification re-sent as reminder to user ${user.name || user.id}`,
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
        triggeredById: 'reminder-scheduler',
        userId: user.id,
        transaction: tx,
      });
    });
  }

  /**
   * Cleanup expired reminders
   * Removes reminders that are older than the specified days
   *
   * @param daysOld - Number of days old to consider expired (default: 30)
   * @returns Number of expired reminders cleaned up
   */
  async cleanupExpiredReminders(daysOld: number = 30): Promise<number> {
    this.logger.log(`Cleaning up reminders older than ${daysOld} days`);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    try {
      // Find expired reminders
      const expiredReminders = await this.prisma.seenNotification.findMany({
        where: {
          remindAt: {
            lt: cutoffDate,
            not: null,
          },
        },
      });

      const count = expiredReminders.length;

      if (count === 0) {
        this.logger.log('No expired reminders found');
        return 0;
      }

      // Clear expired reminders
      await this.prisma.seenNotification.updateMany({
        where: {
          remindAt: {
            lt: cutoffDate,
            not: null,
          },
        },
        data: {
          remindAt: null,
        },
      });

      // Log cleanup action
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
        entityId: 'BATCH',
        action: CHANGE_ACTION.BATCH_UPDATE,
        reason: `Cleaned up ${count} expired reminders older than ${daysOld} days`,
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
        triggeredById: 'reminder-scheduler',
        userId: null,
      });

      this.logger.log(`Cleaned up ${count} expired reminders`);

      return count;
    } catch (error) {
      this.logger.error('Error during expired reminders cleanup:', error.stack);
      throw error;
    }
  }

  /**
   * Get reminder statistics
   *
   * @returns Statistics about pending reminders
   */
  async getReminderStats(): Promise<ReminderStats> {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    const [allReminders, overdueReminders, upcomingReminders] = await Promise.all([
      this.prisma.seenNotification.findMany({
        where: {
          remindAt: {
            not: null,
          },
        },
        include: {
          user: true,
          notification: true,
        },
      }),
      this.prisma.seenNotification.count({
        where: {
          remindAt: {
            lte: now,
            not: null,
          },
        },
      }),
      this.prisma.seenNotification.count({
        where: {
          remindAt: {
            gt: now,
            lte: oneHourFromNow,
          },
        },
      }),
    ]);

    // Count by user
    const byUser: Record<string, number> = {};
    for (const reminder of allReminders) {
      const userId = reminder.userId;
      byUser[userId] = (byUser[userId] || 0) + 1;
    }

    // Count by interval (approximate)
    const byInterval: Record<string, number> = {};
    for (const reminder of allReminders) {
      if (!reminder.remindAt) continue;

      const diffMs = reminder.remindAt.getTime() - reminder.updatedAt.getTime();
      const interval = this.approximateInterval(diffMs);
      byInterval[interval] = (byInterval[interval] || 0) + 1;
    }

    return {
      totalPending: allReminders.length,
      overdue: overdueReminders,
      upcoming: upcomingReminders,
      byUser,
      byInterval,
    };
  }

  /**
   * Get reminders for a specific user
   *
   * @param userId - The user ID
   * @returns List of active reminders for the user
   */
  async getUserReminders(userId: string): Promise<ReminderWithData[]> {
    const reminders = await this.prisma.seenNotification.findMany({
      where: {
        userId,
        remindAt: {
          not: null,
        },
      },
      include: {
        notification: true,
        user: true,
      },
      orderBy: {
        remindAt: 'asc',
      },
    });

    // Add reminder count for each
    const remindersWithCount = await Promise.all(
      reminders.map(async reminder => ({
        ...reminder,
        reminderCount: await this.getReminderCount(
          reminder.notificationId,
          reminder.userId,
          this.prisma,
        ),
      })),
    );

    return remindersWithCount;
  }

  /**
   * Cancel all reminders for a user
   *
   * @param userId - The user ID
   * @returns Number of reminders cancelled
   */
  async cancelUserReminders(userId: string): Promise<number> {
    const result = await this.prisma.seenNotification.updateMany({
      where: {
        userId,
        remindAt: {
          not: null,
        },
      },
      data: {
        remindAt: null,
      },
    });

    this.logger.log(`Cancelled ${result.count} reminders for user ${userId}`);

    // Log bulk cancellation
    if (result.count > 0) {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
        entityId: 'BATCH',
        action: CHANGE_ACTION.BATCH_UPDATE,
        reason: `Cancelled ${result.count} reminders for user ${userId}`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: userId,
        userId: userId,
      });
    }

    return result.count;
  }

  /**
   * Manually trigger reminder processing
   * Useful for testing or manual intervention
   */
  async triggerManualProcessing(): Promise<{ processed: number; errors: number }> {
    this.logger.log('Manual reminder processing triggered');

    if (this.isProcessing) {
      throw new BadRequestException('Reminder processing already in progress');
    }

    let processedCount = 0;
    let errorCount = 0;

    this.isProcessing = true;

    try {
      const now = new Date();
      const reminders = await this.prisma.seenNotification.findMany({
        where: {
          remindAt: {
            lte: now,
            not: null,
          },
        },
        include: {
          notification: true,
          user: true,
        },
      });

      for (const reminder of reminders) {
        try {
          await this.processSingleReminder(reminder);
          processedCount++;
        } catch (error) {
          errorCount++;
          this.logger.error(`Failed to process reminder ${reminder.id}:`, error.stack);
        }
      }

      return { processed: processedCount, errors: errorCount };
    } finally {
      this.isProcessing = false;
    }
  }

  // =====================
  // Private Helper Methods
  // =====================

  /**
   * Calculate reminder time based on interval
   *
   * @param interval - The reminder interval
   * @returns Calculated reminder time
   */
  private calculateReminderTime(interval: REMINDER_INTERVAL): Date {
    const now = new Date();

    switch (interval) {
      case REMINDER_INTERVAL.FIVE_MINUTES:
        return new Date(now.getTime() + 5 * 60 * 1000);

      case REMINDER_INTERVAL.FIFTEEN_MINUTES:
        return new Date(now.getTime() + 15 * 60 * 1000);

      case REMINDER_INTERVAL.ONE_HOUR:
        return new Date(now.getTime() + 60 * 60 * 1000);

      case REMINDER_INTERVAL.THREE_HOURS:
        return new Date(now.getTime() + 3 * 60 * 60 * 1000);

      case REMINDER_INTERVAL.TOMORROW:
        return this.calculateTomorrow(now);

      case REMINDER_INTERVAL.NEXT_WEEK:
        return this.calculateNextWeek(now);

      default:
        throw new BadRequestException(`Invalid reminder interval: ${interval}`);
    }
  }

  /**
   * Calculate tomorrow at 9 AM (São Paulo timezone)
   */
  private calculateTomorrow(now: Date): Date {
    // Get current time in São Paulo timezone
    const saoPauloTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));

    // Set to tomorrow at 9 AM
    const tomorrow = new Date(saoPauloTime);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    return tomorrow;
  }

  /**
   * Calculate milliseconds until tomorrow at 9 AM
   */
  private calculateTomorrowMs(now: Date): number {
    const tomorrow = this.calculateTomorrow(now);
    return tomorrow.getTime() - now.getTime();
  }

  /**
   * Calculate next Monday at 9 AM (São Paulo timezone)
   */
  private calculateNextWeek(now: Date): Date {
    // Get current time in São Paulo timezone
    const saoPauloTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));

    // Calculate next Monday
    const nextWeek = new Date(saoPauloTime);
    const currentDay = nextWeek.getDay();
    const daysUntilMonday = currentDay === 0 ? 1 : 8 - currentDay;
    nextWeek.setDate(nextWeek.getDate() + daysUntilMonday);
    nextWeek.setHours(9, 0, 0, 0);

    return nextWeek;
  }

  /**
   * Calculate milliseconds until next Monday at 9 AM
   */
  private calculateNextWeekMs(now: Date): number {
    const nextWeek = this.calculateNextWeek(now);
    return nextWeek.getTime() - now.getTime();
  }

  /**
   * Get reminder count for a notification and user
   * Uses changelog to count how many times a reminder was set
   */
  private async getReminderCount(notificationId: string, userId: string, tx: any): Promise<number> {
    try {
      const seenNotification = await (tx as any).seenNotification.findUnique({
        where: {
          userId_notificationId: {
            userId,
            notificationId,
          },
        },
      });

      if (!seenNotification) {
        return 0;
      }

      // Count changelog entries where remindAt was set (not null)
      const reminderLogs = await (tx as any).changeLog.count({
        where: {
          entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
          entityId: seenNotification.id,
          field: 'remindAt',
          newValue: {
            not: null,
          },
          action: CHANGE_ACTION.UPDATE,
        },
      });

      return reminderLogs;
    } catch (error) {
      this.logger.warn(
        `Failed to get reminder count for notification ${notificationId}: ${error.message}`,
      );
      return 0;
    }
  }

  /**
   * Approximate interval based on milliseconds difference
   */
  private approximateInterval(diffMs: number): string {
    const minutes = diffMs / (60 * 1000);
    const hours = diffMs / (60 * 60 * 1000);
    const days = diffMs / (24 * 60 * 60 * 1000);

    if (minutes <= 10) return REMINDER_INTERVAL.FIVE_MINUTES;
    if (minutes <= 30) return REMINDER_INTERVAL.FIFTEEN_MINUTES;
    if (hours <= 2) return REMINDER_INTERVAL.ONE_HOUR;
    if (hours <= 6) return REMINDER_INTERVAL.THREE_HOURS;
    if (days <= 2) return REMINDER_INTERVAL.TOMORROW;
    return REMINDER_INTERVAL.NEXT_WEEK;
  }

  /**
   * Adjust reminder time to respect work hours (7:30 AM - 6:00 PM)
   * If reminder would trigger outside work hours, reschedule to next 7:30 AM
   *
   * @param reminderTime - The originally calculated reminder time
   * @returns Adjusted reminder time within work hours
   */
  private adjustReminderForWorkHours(reminderTime: Date): Date {
    // Get reminder time in São Paulo timezone
    const saoPauloTime = new Date(
      reminderTime.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
    );
    const hours = saoPauloTime.getHours();
    const minutes = saoPauloTime.getMinutes();

    // Work hours: 7:30 (7.5) to 18:00 (18.0)
    const currentTimeInHours = hours + minutes / 60;
    const workStartHour = 7.5; // 7:30
    const workEndHour = 18.0; // 18:00

    // Check if within work hours
    const isWithinWorkHours = currentTimeInHours >= workStartHour && currentTimeInHours < workEndHour;

    if (isWithinWorkHours) {
      // Already within work hours, return as-is
      this.logger.debug(
        `Reminder time ${reminderTime.toISOString()} is within work hours, no adjustment needed`,
      );
      return reminderTime;
    }

    // Outside work hours - calculate next 7:30 AM
    const next730 = new Date(saoPauloTime);
    next730.setHours(7, 30, 0, 0);

    // If current time is past 7:30 today (or at/after 18:00), schedule for tomorrow
    if (currentTimeInHours >= 7.5) {
      next730.setDate(next730.getDate() + 1);
    }

    this.logger.log(
      `Reminder time ${reminderTime.toISOString()} is outside work hours (${hours}:${minutes.toString().padStart(2, '0')}). ` +
      `Adjusted to ${next730.toISOString()} (next 7:30 AM)`,
    );

    return next730;
  }
}
