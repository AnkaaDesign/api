import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { differenceInDays } from 'date-fns';

/**
 * Notification Scheduler Service
 * Handles scheduled notifications, recurring checks, and automated notification triggers
 */
@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);
  private isProcessingScheduled = false;
  private isProcessingReminders = false;
  private isProcessingRetries = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Process scheduled notifications every minute
   * Finds notifications scheduled for now or earlier and dispatches them
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processScheduledNotifications(): Promise<void> {
    // Prevent concurrent execution
    if (this.isProcessingScheduled) {
      this.logger.warn('Scheduled notification processing already in progress, skipping...');
      return;
    }

    this.isProcessingScheduled = true;
    const startTime = Date.now();
    let processedCount = 0;
    let errorCount = 0;

    try {
      this.logger.log('Starting scheduled notification processing...');

      const now = new Date();

      // Find notifications scheduled for now or earlier that haven't been sent yet
      const pendingNotifications = await this.notificationService.findScheduledNotifications(now);

      if (pendingNotifications.length === 0) {
        this.logger.debug('No scheduled notifications to process');
        return;
      }

      this.logger.log(`Found ${pendingNotifications.length} scheduled notifications to process`);

      // Process each scheduled notification
      for (const notification of pendingNotifications) {
        try {
          await this.dispatchService.dispatchNotification(notification.id);
          processedCount++;
          this.logger.log(`Dispatched scheduled notification ${notification.id}`);
        } catch (error) {
          errorCount++;
          this.logger.error(
            `Failed to dispatch scheduled notification ${notification.id}: ${error.message}`,
            error.stack,
          );
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Scheduled notification processing completed in ${duration}ms. Processed: ${processedCount}, Errors: ${errorCount}`,
      );

      // Emit event for monitoring
      this.eventEmitter.emit('notification.scheduled.processed', {
        processedCount,
        errorCount,
        duration,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(
        `Critical error during scheduled notification processing: ${error.message}`,
        error.stack,
      );
    } finally {
      this.isProcessingScheduled = false;
    }
  }

  /**
   * Check task deadlines daily at 8 AM
   * Sends notifications for tasks due in 7, 3, or 1 day(s)
   */
  @Cron('0 8 * * *', { timeZone: 'America/Sao_Paulo' })
  async checkTaskDeadlines(): Promise<void> {
    const startTime = Date.now();
    let notificationCount = 0;

    try {
      this.logger.log('Starting task deadline check...');

      // Find tasks with upcoming deadlines
      const tasks = await this.findUpcomingDeadlineTasks();

      this.logger.log(`Found ${tasks.length} tasks with upcoming deadlines`);

      for (const task of tasks) {
        try {
          const daysRemaining = differenceInDays(new Date(task.term), new Date());

          // Only notify for 7, 3, and 1 day milestones
          if ([7, 3, 1].includes(daysRemaining)) {
            this.eventEmitter.emit('task.deadline.approaching', {
              task,
              daysRemaining,
            });
            notificationCount++;
            this.logger.log(
              `Emitted deadline approaching event for task ${task.id}: ${daysRemaining} days remaining`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to process deadline for task ${task.id}: ${error.message}`,
            error.stack,
          );
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Task deadline check completed in ${duration}ms. Notifications sent: ${notificationCount}`,
      );
    } catch (error) {
      this.logger.error(`Error during task deadline check: ${error.message}`, error.stack);
    }
  }

  /**
   * Check overdue tasks daily at 9 AM
   * Sends notifications for tasks that are past their deadline
   */
  @Cron('0 9 * * *', { timeZone: 'America/Sao_Paulo' })
  async checkOverdueTasks(): Promise<void> {
    const startTime = Date.now();
    let notificationCount = 0;

    try {
      this.logger.log('Starting overdue task check...');

      // Find overdue tasks
      const tasks = await this.findOverdueTasks();

      this.logger.log(`Found ${tasks.length} overdue tasks`);

      for (const task of tasks) {
        try {
          const daysOverdue = differenceInDays(new Date(), new Date(task.term));

          // Only emit for positive days overdue
          if (daysOverdue > 0) {
            this.eventEmitter.emit('task.overdue', {
              task,
              daysOverdue,
            });
            notificationCount++;
            this.logger.log(
              `Emitted overdue event for task ${task.id}: ${daysOverdue} days overdue`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to process overdue task ${task.id}: ${error.message}`,
            error.stack,
          );
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Overdue task check completed in ${duration}ms. Notifications sent: ${notificationCount}`,
      );
    } catch (error) {
      this.logger.error(`Error during overdue task check: ${error.message}`, error.stack);
    }
  }

  /**
   * Check stock levels daily at 10 AM
   * Sends notifications for items with low stock
   */
  @Cron('0 10 * * *', { timeZone: 'America/Sao_Paulo' })
  async checkStockLevels(): Promise<void> {
    const startTime = Date.now();
    let notificationCount = 0;

    try {
      this.logger.log('Starting stock level check...');

      // Find items with low stock
      const items = await this.findLowStockItems();

      this.logger.log(`Found ${items.length} items with low stock`);

      for (const item of items) {
        try {
          this.eventEmitter.emit('item.low-stock', { item });
          notificationCount++;
          this.logger.log(
            `Emitted low stock event for item ${item.id}: ${item.name} (${item.quantity} units)`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to process low stock for item ${item.id}: ${error.message}`,
            error.stack,
          );
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Stock level check completed in ${duration}ms. Notifications sent: ${notificationCount}`,
      );
    } catch (error) {
      this.logger.error(`Error during stock level check: ${error.message}`, error.stack);
    }
  }

  /**
   * Process reminders every 5 minutes
   * Re-dispatches notifications that have a reminder set
   */
  @Cron('*/5 * * * *')
  async processReminders(): Promise<void> {
    // Prevent concurrent execution
    if (this.isProcessingReminders) {
      this.logger.warn('Reminder processing already in progress, skipping...');
      return;
    }

    this.isProcessingReminders = true;
    const startTime = Date.now();
    let processedCount = 0;
    let errorCount = 0;

    try {
      this.logger.log('Starting reminder processing...');

      // Find reminders that are due
      const reminders = await this.findDueReminders();

      if (reminders.length === 0) {
        this.logger.debug('No due reminders to process');
        return;
      }

      this.logger.log(`Found ${reminders.length} due reminders to process`);

      for (const reminder of reminders) {
        try {
          // Re-dispatch the notification
          await this.dispatchService.dispatchNotification(reminder.notificationId);

          // Clear the reminder
          await this.clearReminder(reminder.id);

          processedCount++;
          this.logger.log(
            `Processed reminder ${reminder.id} for notification ${reminder.notificationId}`,
          );
        } catch (error) {
          errorCount++;
          this.logger.error(
            `Failed to process reminder ${reminder.id}: ${error.message}`,
            error.stack,
          );
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Reminder processing completed in ${duration}ms. Processed: ${processedCount}, Errors: ${errorCount}`,
      );
    } catch (error) {
      this.logger.error(`Error during reminder processing: ${error.message}`, error.stack);
    } finally {
      this.isProcessingReminders = false;
    }
  }

  /**
   * Retry failed deliveries every 10 minutes
   * Retries deliveries that failed but haven't exceeded max retry count
   */
  @Cron('*/10 * * * *')
  async retryFailedDeliveries(): Promise<void> {
    // Prevent concurrent execution
    if (this.isProcessingRetries) {
      this.logger.warn('Retry processing already in progress, skipping...');
      return;
    }

    this.isProcessingRetries = true;
    const startTime = Date.now();
    let retriedCount = 0;
    let errorCount = 0;

    try {
      this.logger.log('Starting failed delivery retry processing...');

      const maxRetries = 3;

      // Find failed deliveries that can be retried
      const failedDeliveries = await this.findFailedDeliveries(maxRetries);

      if (failedDeliveries.length === 0) {
        this.logger.debug('No failed deliveries to retry');
        return;
      }

      this.logger.log(`Found ${failedDeliveries.length} failed deliveries to retry`);

      for (const delivery of failedDeliveries) {
        try {
          await this.retryDelivery(delivery);
          retriedCount++;
          this.logger.log(
            `Retried delivery ${delivery.id} for notification ${delivery.notificationId} (attempt ${delivery.retryCount + 1}/${maxRetries})`,
          );
        } catch (error) {
          errorCount++;
          this.logger.error(
            `Failed to retry delivery ${delivery.id}: ${error.message}`,
            error.stack,
          );
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Failed delivery retry processing completed in ${duration}ms. Retried: ${retriedCount}, Errors: ${errorCount}`,
      );
    } catch (error) {
      this.logger.error(
        `Error during failed delivery retry processing: ${error.message}`,
        error.stack,
      );
    } finally {
      this.isProcessingRetries = false;
    }
  }

  /**
   * Clean old notifications monthly
   * Removes notifications older than 30 days
   */
  @Cron('0 0 1 * *', { timeZone: 'America/Sao_Paulo' })
  async cleanOldNotifications(): Promise<void> {
    const startTime = Date.now();
    let deletedCount = 0;

    try {
      this.logger.log('Starting old notification cleanup...');

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      deletedCount = await this.deleteOldNotifications(thirtyDaysAgo);

      const duration = Date.now() - startTime;
      this.logger.log(
        `Old notification cleanup completed in ${duration}ms. Deleted: ${deletedCount} notifications`,
      );
    } catch (error) {
      this.logger.error(`Error during old notification cleanup: ${error.message}`, error.stack);
    }
  }

  /**
   * Find tasks with upcoming deadlines (within 7 days)
   */
  private async findUpcomingDeadlineTasks(): Promise<any[]> {
    try {
      const now = new Date();
      const sevenDaysFromNow = new Date();
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

      return await this.prisma.task.findMany({
        where: {
          term: {
            gte: now,
            lte: sevenDaysFromNow,
          },
          status: {
            not: 'COMPLETED', // Don't notify for completed tasks
          },
        },
        include: {
          customer: true,
          sector: true,
        },
      });
    } catch (error) {
      this.logger.error(`Error finding upcoming deadline tasks: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Find overdue tasks
   */
  private async findOverdueTasks(): Promise<any[]> {
    try {
      const now = new Date();

      return await this.prisma.task.findMany({
        where: {
          term: {
            lt: now,
          },
          status: {
            not: 'COMPLETED', // Don't notify for completed tasks
          },
        },
        include: {
          customer: true,
          sector: true,
        },
      });
    } catch (error) {
      this.logger.error(`Error finding overdue tasks: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Find items with low stock
   */
  private async findLowStockItems(): Promise<any[]> {
    try {
      return await this.prisma.item.findMany({
        where: {
          AND: [
            {
              quantity: {
                lte: this.prisma.item.fields.reorderPoint,
              },
            },
            {
              reorderPoint: {
                not: null,
              },
            },
          ],
        },
        include: {
          category: true,
          brand: true,
        },
      });
    } catch (error) {
      this.logger.error(`Error finding low stock items: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Find due reminders
   */
  private async findDueReminders(): Promise<any[]> {
    try {
      const now = new Date();

      return await this.prisma.seenNotification.findMany({
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
    } catch (error) {
      this.logger.error(`Error finding due reminders: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Clear a reminder
   */
  private async clearReminder(reminderId: string): Promise<void> {
    try {
      await this.prisma.seenNotification.update({
        where: { id: reminderId },
        data: { remindAt: null },
      });
    } catch (error) {
      this.logger.error(`Error clearing reminder ${reminderId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find failed deliveries that can be retried
   */
  private async findFailedDeliveries(maxRetries: number): Promise<any[]> {
    try {
      return await this.prisma.notificationDelivery.findMany({
        where: {
          status: 'FAILED',
        },
        include: {
          notification: true,
        },
        orderBy: {
          updatedAt: 'asc', // Retry oldest failures first
        },
        take: 50, // Limit to 50 retries per run to avoid overload
      });
    } catch (error) {
      this.logger.error(`Error finding failed deliveries: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Retry a failed delivery with exponential backoff
   */
  private async retryDelivery(delivery: any): Promise<void> {
    try {
      const retryCount = delivery.retryCount || 0;
      const maxRetries = 3;

      // Check if we've exceeded max retries
      if (retryCount >= maxRetries) {
        this.logger.warn(
          `Delivery ${delivery.id} has exceeded max retries (${maxRetries}), marking as permanently failed`,
        );

        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'FAILED',
            errorMessage: `Permanently failed after ${maxRetries} retry attempts`,
            updatedAt: new Date(),
          },
        });

        return;
      }

      // Calculate exponential backoff delay
      const delays = [2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000]; // 2min, 5min, 15min
      const backoffDelay = delays[retryCount] || delays[delays.length - 1];

      // Check if enough time has passed since last attempt
      const timeSinceLastAttempt = Date.now() - new Date(delivery.updatedAt).getTime();
      if (timeSinceLastAttempt < backoffDelay) {
        this.logger.debug(
          `Skipping retry for delivery ${delivery.id}, backoff delay not met (${timeSinceLastAttempt}ms < ${backoffDelay}ms)`,
        );
        return;
      }

      // Update status to retrying
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'RETRYING',
          updatedAt: new Date(),
        },
      });

      // Re-dispatch the notification
      await this.dispatchService.dispatchNotification(delivery.notificationId);

      this.logger.log(
        `Successfully retried delivery ${delivery.id} (attempt ${retryCount + 1}/${maxRetries})`,
      );
    } catch (error) {
      // Update delivery with error
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          errorMessage: error.message,
          updatedAt: new Date(),
        },
      });

      throw error;
    }
  }

  /**
   * Delete notifications older than the specified date
   */
  private async deleteOldNotifications(beforeDate: Date): Promise<number> {
    try {
      const result = await this.prisma.notification.deleteMany({
        where: {
          createdAt: {
            lt: beforeDate,
          },
          // Only delete notifications that have been sent
          sentAt: {
            not: null,
          },
        },
      });

      return result.count;
    } catch (error) {
      this.logger.error(`Error deleting old notifications: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Manually trigger scheduled notification processing
   * Useful for testing or manual intervention
   */
  async triggerScheduledProcessing(): Promise<{ processed: number; errors: number }> {
    this.logger.log('Manual scheduled notification processing triggered');

    if (this.isProcessingScheduled) {
      throw new Error('Scheduled notification processing already in progress');
    }

    let processedCount = 0;
    let errorCount = 0;

    this.isProcessingScheduled = true;

    try {
      const now = new Date();
      const pendingNotifications = await this.notificationService.findScheduledNotifications(now);

      for (const notification of pendingNotifications) {
        try {
          await this.dispatchService.dispatchNotification(notification.id);
          processedCount++;
        } catch (error) {
          errorCount++;
          this.logger.error(`Failed to dispatch notification ${notification.id}:`, error);
        }
      }

      return { processed: processedCount, errors: errorCount };
    } finally {
      this.isProcessingScheduled = false;
    }
  }

  /**
   * Get scheduler statistics
   */
  async getSchedulerStats(): Promise<{
    scheduledNotifications: number;
    dueReminders: number;
    failedDeliveries: number;
    upcomingDeadlines: number;
    overdueTasks: number;
    lowStockItems: number;
  }> {
    const [
      scheduledNotifications,
      dueReminders,
      failedDeliveries,
      upcomingDeadlines,
      overdueTasks,
      lowStockItems,
    ] = await Promise.all([
      this.prisma.notification.count({
        where: {
          scheduledAt: { not: null },
          sentAt: null,
        },
      }),
      this.prisma.seenNotification.count({
        where: {
          remindAt: {
            lte: new Date(),
            not: null,
          },
        },
      }),
      this.prisma.notificationDelivery.count({
        where: {
          status: 'FAILED',
        },
      }),
      (await this.findUpcomingDeadlineTasks()).length,
      (await this.findOverdueTasks()).length,
      (await this.findLowStockItems()).length,
    ]);

    return {
      scheduledNotifications,
      dueReminders,
      failedDeliveries,
      upcomingDeadlines,
      overdueTasks,
      lowStockItems,
    };
  }
}
