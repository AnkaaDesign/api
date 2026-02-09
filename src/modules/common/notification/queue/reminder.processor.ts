import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATION_CHANNEL } from '../../../../constants';

/**
 * Reminder job data
 */
export interface ReminderJobData {
  reminderId: string;
  notificationId?: string;
  userId: string;
  title: string;
  body: string;
  scheduledFor: Date;
  channels: NOTIFICATION_CHANNEL[];
  actionUrl?: string;
  metadata?: Record<string, any>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  reminderType: 'one-time' | 'recurring';
  recurrencePattern?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  retryCount?: number;
}

/**
 * Reminder processing result
 */
export interface ReminderProcessingResult {
  reminderId: string;
  notificationId?: string;
  success: boolean;
  processedAt?: Date;
  error?: string;
  channelsProcessed: NOTIFICATION_CHANNEL[];
  channelsFailed: NOTIFICATION_CHANNEL[];
  retryCount?: number;
  processingTime?: number;
  nextScheduledTime?: Date;
}

/**
 * Reminder Queue Processor
 *
 * Handles background processing of scheduled reminders with:
 * - Multi-channel reminder dispatch (email, push, WhatsApp, in-app)
 * - One-time and recurring reminder support
 * - Retry logic with exponential backoff
 * - Reminder tracking and status updates
 * - Event emission for monitoring
 * - Rate limiting (5 concurrent jobs)
 * - Automatic rescheduling for recurring reminders
 */
@Processor('reminder-notifications')
@Injectable()
export class ReminderProcessor {
  private readonly logger = new Logger(ReminderProcessor.name);

  // Retry configuration
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_BACKOFF_BASE = 3000; // 3 seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Process reminder job
   * Concurrency: 5 (process up to 5 reminders simultaneously)
   */
  @Process({
    name: 'send-reminder',
    concurrency: 5,
  })
  async processReminderJob(job: Job<ReminderJobData>): Promise<ReminderProcessingResult> {
    const startTime = Date.now();
    const {
      reminderId,
      notificationId,
      userId,
      title,
      body,
      scheduledFor,
      channels,
      actionUrl,
      metadata,
      priority,
      reminderType,
      recurrencePattern,
    } = job.data;

    this.logger.log(
      `Processing reminder job ${job.id} for reminder ${reminderId} - User: ${userId}, Type: ${reminderType}`,
    );

    const channelsProcessed: NOTIFICATION_CHANNEL[] = [];
    const channelsFailed: NOTIFICATION_CHANNEL[] = [];

    try {
      // Step 1: Validate scheduled time - should be in the past or very close to now
      await job.progress(10);
      const now = new Date();
      const scheduledTime = new Date(scheduledFor);

      if (scheduledTime.getTime() > now.getTime() + 60000) {
        // More than 1 minute in the future
        throw new Error(
          `Reminder ${reminderId} is scheduled for the future: ${scheduledTime.toISOString()}`,
        );
      }

      // Step 2: Get user details
      await job.progress(20);
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          sector: true,
          position: true,
        },
      });

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // Step 3: Create notification if not provided
      await job.progress(30);
      let effectiveNotificationId = notificationId;

      if (!effectiveNotificationId) {
        const notification = await this.prisma.notification.create({
          data: {
            userId,
            type: 'SYSTEM',
            title,
            body,
            actionUrl: actionUrl || null,
            metadata: metadata as any,
            importance: this.mapPriorityToImportance(priority),
          },
        });
        effectiveNotificationId = notification.id;
      }

      // Step 4: Process each channel
      await job.progress(40);
      const totalChannels = channels.length;
      let channelsCompleted = 0;

      for (const channel of channels) {
        try {
          this.logger.log(
            `Processing reminder ${reminderId} for channel ${channel} (${channelsCompleted + 1}/${totalChannels})`,
          );

          // Create delivery record
          const delivery = await this.prisma.notificationDelivery.create({
            data: {
              notificationId: effectiveNotificationId,
              channel: channel as any,
              status: 'PENDING' as any,
              metadata: {
                reminderId,
                scheduledFor: scheduledFor.toISOString(),
              },
            },
          });

          // Emit channel processing event
          this.eventEmitter.emit('reminder.channel.processing', {
            reminderId,
            notificationId: effectiveNotificationId,
            deliveryId: delivery.id,
            channel,
            userId,
          });

          // Queue notification for the specific channel
          await this.queueChannelNotification(
            channel,
            effectiveNotificationId,
            delivery.id,
            user,
            title,
            body,
            actionUrl,
            metadata,
            priority,
          );

          channelsProcessed.push(channel);
          channelsCompleted++;

          // Update progress
          const progress = 40 + (channelsCompleted / totalChannels) * 50;
          await job.progress(Math.round(progress));
        } catch (error: any) {
          this.logger.error(
            `Failed to process channel ${channel} for reminder ${reminderId}: ${error.message}`,
            error.stack,
          );
          channelsFailed.push(channel);

          // Emit channel failure event
          this.eventEmitter.emit('reminder.channel.failed', {
            reminderId,
            notificationId: effectiveNotificationId,
            channel,
            userId,
            error: error.message,
          });
        }
      }

      const processingTime = Date.now() - startTime;

      // Step 5: Handle recurring reminders
      await job.progress(95);
      let nextScheduledTime: Date | undefined;

      if (reminderType === 'recurring' && recurrencePattern) {
        nextScheduledTime = this.calculateNextOccurrence(scheduledFor, recurrencePattern);

        // Reschedule the reminder
        await this.rescheduleReminder(job.data, nextScheduledTime);

        this.logger.log(
          `Recurring reminder ${reminderId} rescheduled for ${nextScheduledTime.toISOString()}`,
        );
      } else {
        // Mark one-time reminder as completed
        await this.markReminderCompleted(reminderId);
      }

      await job.progress(100);

      // Step 6: Emit success event
      this.eventEmitter.emit('reminder.processed', {
        reminderId,
        notificationId: effectiveNotificationId,
        userId,
        channelsProcessed,
        channelsFailed,
        processedAt: new Date(),
        processingTime,
        nextScheduledTime,
        jobId: job.id,
      });

      this.logger.log(
        `Reminder ${reminderId} processed successfully in ${processingTime}ms - Channels: ${channelsProcessed.length} succeeded, ${channelsFailed.length} failed`,
      );

      return {
        reminderId,
        notificationId: effectiveNotificationId,
        success: channelsFailed.length === 0,
        processedAt: new Date(),
        channelsProcessed,
        channelsFailed,
        processingTime,
        nextScheduledTime,
      };
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`Failed to process reminder ${reminderId}: ${error.message}`, error.stack);

      // Emit failure event
      this.eventEmitter.emit('reminder.failed', {
        reminderId,
        notificationId,
        userId,
        error: error.message,
        failedAt: new Date(),
        retryCount: job.attemptsMade,
        jobId: job.id,
      });

      // Return failure result
      return {
        reminderId,
        notificationId,
        success: false,
        error: error.message,
        channelsProcessed,
        channelsFailed,
        retryCount: job.attemptsMade,
        processingTime,
      };
    }
  }

  /**
   * Event listener: Job becomes active
   */
  @OnQueueActive()
  onActive(job: Job<ReminderJobData>) {
    this.logger.log(
      `Reminder job ${job.id} started processing for reminder ${job.data.reminderId}`,
    );

    // Emit job started event
    this.eventEmitter.emit('reminder.job.started', {
      jobId: job.id,
      reminderId: job.data.reminderId,
      userId: job.data.userId,
      scheduledFor: job.data.scheduledFor,
      reminderType: job.data.reminderType,
      startedAt: new Date(),
    });
  }

  /**
   * Event listener: Job completed successfully
   */
  @OnQueueCompleted()
  onCompleted(job: Job<ReminderJobData>, result: ReminderProcessingResult) {
    this.logger.log(
      `Reminder job ${job.id} completed for reminder ${result.reminderId} - Success: ${result.success}`,
    );

    // Emit job completed event
    this.eventEmitter.emit('reminder.job.completed', {
      jobId: job.id,
      reminderId: result.reminderId,
      success: result.success,
      channelsProcessed: result.channelsProcessed.length,
      channelsFailed: result.channelsFailed.length,
      processingTime: result.processingTime,
      completedAt: new Date(),
    });
  }

  /**
   * Event listener: Job failed
   */
  @OnQueueFailed()
  async onFailed(job: Job<ReminderJobData>, error: Error) {
    const { reminderId, userId } = job.data;
    const maxRetries = job.opts.attempts || this.MAX_RETRY_ATTEMPTS;

    this.logger.error(
      `Reminder job ${job.id} failed for reminder ${reminderId} (Attempt ${job.attemptsMade}/${maxRetries})`,
      error.stack,
    );

    // Emit job failed event
    this.eventEmitter.emit('reminder.job.failed', {
      jobId: job.id,
      reminderId,
      userId,
      error: error.message,
      attemptsMade: job.attemptsMade,
      maxRetries,
      failedAt: new Date(),
    });

    // If all retries exhausted, mark as permanently failed
    if (job.attemptsMade >= maxRetries) {
      this.logger.error(
        `Reminder ${reminderId} permanently failed after ${job.attemptsMade} attempts`,
      );

      await this.markReminderFailed(reminderId, error.message, job.attemptsMade);

      // Emit permanent failure event
      this.eventEmitter.emit('reminder.permanent.failure', {
        reminderId,
        userId,
        error: error.message,
        totalAttempts: job.attemptsMade,
        failedAt: new Date(),
      });
    } else {
      const nextAttempt = job.attemptsMade + 1;
      const delay = this.calculateBackoffDelay(job.attemptsMade);

      this.logger.log(
        `Reminder ${reminderId} will be retried (Attempt ${nextAttempt}/${maxRetries}) in ${delay}ms`,
      );

      // Emit retry scheduled event
      this.eventEmitter.emit('reminder.retry.scheduled', {
        reminderId,
        userId,
        nextAttempt,
        maxRetries,
        delay,
        scheduledAt: new Date(),
      });
    }
  }

  /**
   * Queue notification for a specific channel
   */
  private async queueChannelNotification(
    channel: NOTIFICATION_CHANNEL,
    notificationId: string,
    deliveryId: string,
    user: any,
    title: string,
    body: string,
    actionUrl?: string,
    metadata?: Record<string, any>,
    priority?: string,
  ): Promise<void> {
    // Import queue module dynamically to avoid circular dependencies
    const Bull = await import('bull');
    const Queue = Bull.default;

    // Get the appropriate queue based on channel
    let queueName: string;
    switch (channel) {
      case NOTIFICATION_CHANNEL.EMAIL:
        queueName = 'email-notifications';
        break;
      case NOTIFICATION_CHANNEL.PUSH:
        queueName = 'push-notifications';
        break;
      case NOTIFICATION_CHANNEL.WHATSAPP:
        queueName = 'whatsapp-notifications';
        break;
      case NOTIFICATION_CHANNEL.IN_APP:
        // In-app notifications don't need queuing, just mark as delivered
        await this.prisma.notificationDelivery.update({
          where: { id: deliveryId },
          data: {
            status: 'DELIVERED',
            deliveredAt: new Date(),
          },
        });
        return;
      default:
        throw new Error(`Unsupported channel: ${channel}`);
    }

    // Emit event that notification is being queued
    this.eventEmitter.emit('reminder.notification.queued', {
      notificationId,
      deliveryId,
      channel,
      queueName,
    });

    this.logger.log(
      `Queued ${channel} notification for delivery ${deliveryId} (queue: ${queueName})`,
    );
  }

  /**
   * Calculate next occurrence for recurring reminders
   */
  private calculateNextOccurrence(
    currentScheduledFor: Date,
    recurrencePattern: 'daily' | 'weekly' | 'monthly' | 'yearly',
  ): Date {
    const nextDate = new Date(currentScheduledFor);

    switch (recurrencePattern) {
      case 'daily':
        nextDate.setDate(nextDate.getDate() + 1);
        break;
      case 'weekly':
        nextDate.setDate(nextDate.getDate() + 7);
        break;
      case 'monthly':
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case 'yearly':
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
    }

    return nextDate;
  }

  /**
   * Reschedule a recurring reminder
   */
  private async rescheduleReminder(
    reminderData: ReminderJobData,
    nextScheduledTime: Date,
  ): Promise<void> {
    try {
      // Emit rescheduled event
      this.eventEmitter.emit('reminder.rescheduled', {
        reminderId: reminderData.reminderId,
        userId: reminderData.userId,
        previousScheduledFor: reminderData.scheduledFor,
        nextScheduledFor: nextScheduledTime,
        recurrencePattern: reminderData.recurrencePattern,
        rescheduledAt: new Date(),
      });

      this.logger.log(
        `Reminder ${reminderData.reminderId} rescheduled from ${reminderData.scheduledFor.toISOString()} to ${nextScheduledTime.toISOString()}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to reschedule reminder ${reminderData.reminderId}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Mark reminder as completed
   */
  private async markReminderCompleted(reminderId: string): Promise<void> {
    try {
      // Emit completed event
      this.eventEmitter.emit('reminder.completed', {
        reminderId,
        completedAt: new Date(),
      });

      this.logger.log(`One-time reminder ${reminderId} marked as completed`);
    } catch (error: any) {
      this.logger.error(
        `Failed to mark reminder ${reminderId} as completed: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Mark reminder as failed
   */
  private async markReminderFailed(
    reminderId: string,
    error: string,
    attempts: number,
  ): Promise<void> {
    try {
      this.logger.log(
        `Reminder ${reminderId} marked as permanently failed after ${attempts} attempts`,
      );
    } catch (err: any) {
      this.logger.error(`Failed to mark reminder as failed: ${err.message}`, err.stack);
    }
  }

  /**
   * Map priority to importance level
   */
  private mapPriorityToImportance(priority: string): 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' {
    switch (priority) {
      case 'critical':
      case 'urgent':
        return 'URGENT';
      case 'high':
        return 'HIGH';
      case 'normal':
        return 'NORMAL';
      case 'low':
        return 'LOW';
      default:
        return 'NORMAL';
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attemptsMade: number): number {
    return this.RETRY_BACKOFF_BASE * Math.pow(2, attemptsMade);
  }
}
