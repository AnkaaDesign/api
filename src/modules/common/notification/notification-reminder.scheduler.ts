import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationGatewayService } from './notification-gateway.service';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../../constants';
import { ChangeLogService } from '../changelog/changelog.service';
import { WorkScheduleService } from './work-schedule.service';

/**
 * Scheduler for processing notification reminders
 * Runs every 5 minutes to check for notifications that need to be reminded
 */
@Injectable()
export class NotificationReminderScheduler {
  private readonly logger = new Logger(NotificationReminderScheduler.name);
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gatewayService: NotificationGatewayService,
    private readonly changeLogService: ChangeLogService,
    private readonly workScheduleService: WorkScheduleService,
  ) {}

  /**
   * Process notification reminders
   * Runs every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
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

      // Find all SeenNotifications with remindAt <= now
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

      this.logger.log(`Found ${reminders.length} reminders to process`);

      // Process each reminder
      for (const reminder of reminders) {
        try {
          await this.processReminder(reminder);
          processedCount++;
        } catch (error) {
          errorCount++;
          this.logger.error(
            `Failed to process reminder ${reminder.id} for notification ${reminder.notificationId}:`,
            error,
          );
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Reminder processing completed in ${duration}ms. Processed: ${processedCount}, Errors: ${errorCount}`,
      );
    } catch (error) {
      this.logger.error('Error during reminder processing:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single reminder
   * Re-sends the notification and clears the reminder
   */
  private async processReminder(reminder: any): Promise<void> {
    // Check working day + work hours before processing
    const canSend = await this.workScheduleService.canSendNow();
    if (!canSend) {
      const nextTime = await this.workScheduleService.getNextSendableTime();
      this.logger.log(
        `Reminder ${reminder.id} blocked outside working hours/day, rescheduling to ${nextTime.toISOString()}`,
      );
      await this.prisma.seenNotification.update({
        where: { id: reminder.id },
        data: { remindAt: nextTime },
      });
      return;
    }

    await this.prisma.$transaction(async tx => {
      const notification = reminder.notification;
      const user = reminder.user;

      // Send notification via WebSocket
      try {
        this.gatewayService.sendToUser(user.id, {
          ...notification,
          isReminder: true,
          remindedAt: new Date(),
        });
        this.logger.log(
          `Sent reminder notification ${notification.id} to user ${user.id} via WebSocket`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to send reminder notification via WebSocket for user ${user.id}: ${error.message}`,
        );
      }

      // Clear the remindAt field
      await (tx as any).seenNotification.update({
        where: { id: reminder.id },
        data: {
          remindAt: null,
        },
      });

      // Log the reminder action
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.SEEN_NOTIFICATION,
        entityId: reminder.id,
        action: CHANGE_ACTION.UPDATE,
        field: 'remindAt',
        oldValue: reminder.remindAt,
        newValue: null,
        reason: 'Lembrete de notificação processado',
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
        triggeredById: 'scheduler',
        userId: user.id,
        transaction: tx,
      });

      // Log notification re-dispatch
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.NOTIFICATION,
        entityId: notification.id,
        action: CHANGE_ACTION.UPDATE,
        reason: `Notificação reenviada como lembrete para usuário ${user.name || user.id}`,
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
        triggeredById: 'scheduler',
        userId: user.id,
        transaction: tx,
      });
    });
  }

  /**
   * Manually trigger reminder processing
   * Useful for testing or manual intervention
   */
  async triggerManualProcessing(): Promise<{ processed: number; errors: number }> {
    this.logger.log('Manual reminder processing triggered');

    if (this.isProcessing) {
      throw new Error('Reminder processing already in progress');
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
          await this.processReminder(reminder);
          processedCount++;
        } catch (error) {
          errorCount++;
          this.logger.error(`Failed to process reminder ${reminder.id}:`, error);
        }
      }

      return { processed: processedCount, errors: errorCount };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get statistics about pending reminders
   */
  async getReminderStats(): Promise<{
    totalPending: number;
    overdue: number;
    upcoming: number;
    byUser: Record<string, number>;
  }> {
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

    const byUser: Record<string, number> = {};
    for (const reminder of allReminders) {
      const userId = reminder.userId;
      byUser[userId] = (byUser[userId] || 0) + 1;
    }

    return {
      totalPending: allReminders.length,
      overdue: overdueReminders,
      upcoming: upcomingReminders,
      byUser,
    };
  }

  /**
   * Cancel a specific reminder
   */
  async cancelReminder(seenNotificationId: string): Promise<void> {
    await this.prisma.seenNotification.update({
      where: { id: seenNotificationId },
      data: {
        remindAt: null,
      },
    });

    this.logger.log(`Cancelled reminder for SeenNotification ${seenNotificationId}`);
  }

  /**
   * Cancel all reminders for a user
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
    return result.count;
  }

  /**
   * Get reminders for a specific user
   */
  async getUserReminders(userId: string): Promise<any[]> {
    return this.prisma.seenNotification.findMany({
      where: {
        userId,
        remindAt: {
          not: null,
        },
      },
      include: {
        notification: true,
      },
      orderBy: {
        remindAt: 'asc',
      },
    });
  }
}
