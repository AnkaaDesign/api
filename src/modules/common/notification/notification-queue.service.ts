import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job, JobCounts } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationJobData, NotificationDeliveryResult } from './notification-queue.processor';
import { NOTIFICATION_CHANNEL } from '../../../constants';

/**
 * Job status types for cleaning operations
 */
export type JobStatusClean = 'completed' | 'wait' | 'active' | 'delayed' | 'failed' | 'paused';
export type JobStatusCleanInput =
  | 'completed'
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'failed'
  | 'paused';

/**
 * Queue statistics
 */
export interface NotificationQueueStats {
  active: number;
  waiting: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

/**
 * Job information for monitoring
 */
export interface NotificationJobInfo {
  id: string | number;
  notificationId: string;
  channel: NOTIFICATION_CHANNEL;
  state: string;
  progress: number;
  attemptsMade: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  data: NotificationJobData;
}

/**
 * Notification Queue Service
 * Manages notification jobs in the Bull queue
 */
@Injectable()
export class NotificationQueueService {
  private readonly logger = new Logger(NotificationQueueService.name);

  constructor(
    @InjectQueue('notification') private notificationQueue: Queue<NotificationJobData>,
    private readonly prisma: PrismaService,
  ) {
    this.setupQueueListeners();
  }

  /**
   * Add email notification job to the queue
   */
  async addEmailJob(
    notificationId: string,
    recipientEmail: string,
    title: string,
    body: string,
    options?: {
      actionUrl?: string;
      metadata?: Record<string, any>;
      priority?: 'low' | 'normal' | 'high' | 'critical';
      delay?: number;
      scheduledFor?: Date;
    },
  ): Promise<Job<NotificationJobData>> {
    try {
      const jobData: NotificationJobData = {
        notificationId,
        channel: NOTIFICATION_CHANNEL.EMAIL,
        recipientEmail,
        title,
        body,
        actionUrl: options?.actionUrl,
        metadata: options?.metadata,
        priority: options?.priority || 'normal',
        scheduledFor: options?.scheduledFor,
      };

      const jobOptions = this.getJobOptions(options?.priority || 'normal', options?.delay);

      this.logger.log(
        `Adding email job for notification ${notificationId} to ${this.maskEmail(recipientEmail)}`,
      );

      const job = await this.notificationQueue.add('send-email', jobData, {
        ...jobOptions,
        jobId: `email-${notificationId}-${Date.now()}`,
      });

      return job;
    } catch (error: any) {
      this.logger.error(
        `Failed to add email job for notification ${notificationId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Add WhatsApp notification job to the queue
   */
  async addWhatsAppJob(
    notificationId: string,
    userId: string,
    recipientPhone: string,
    body: string,
    options?: {
      metadata?: Record<string, any>;
      priority?: 'low' | 'normal' | 'high' | 'critical';
      delay?: number;
      scheduledFor?: Date;
    },
  ): Promise<Job<NotificationJobData>> {
    try {
      const jobData: NotificationJobData = {
        notificationId,
        userId, // Add userId to job data
        channel: NOTIFICATION_CHANNEL.WHATSAPP,
        recipientPhone,
        title: '', // WhatsApp doesn't use a separate title
        body,
        metadata: options?.metadata,
        priority: options?.priority || 'normal',
        scheduledFor: options?.scheduledFor,
      };

      const jobOptions = this.getJobOptions(options?.priority || 'normal', options?.delay);

      this.logger.log(
        `Adding WhatsApp job for notification ${notificationId} to ${this.maskPhone(recipientPhone)}`,
      );

      const job = await this.notificationQueue.add('send-whatsapp', jobData, {
        ...jobOptions,
        jobId: `whatsapp-${notificationId}-${Date.now()}`,
      });

      return job;
    } catch (error: any) {
      this.logger.error(
        `Failed to add WhatsApp job for notification ${notificationId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Add push notification job to the queue
   */
  async addPushJob(
    notificationId: string,
    recipientDeviceToken: string,
    title: string,
    body: string,
    options?: {
      actionUrl?: string;
      metadata?: Record<string, any>;
      priority?: 'low' | 'normal' | 'high' | 'critical';
      delay?: number;
      scheduledFor?: Date;
    },
  ): Promise<Job<NotificationJobData>> {
    try {
      const jobData: NotificationJobData = {
        notificationId,
        channel: NOTIFICATION_CHANNEL.PUSH,
        recipientDeviceToken,
        title,
        body,
        actionUrl: options?.actionUrl,
        metadata: options?.metadata,
        priority: options?.priority || 'normal',
        scheduledFor: options?.scheduledFor,
      };

      const jobOptions = this.getJobOptions(options?.priority || 'normal', options?.delay);

      this.logger.log(`Adding push job for notification ${notificationId}`);

      const job = await this.notificationQueue.add('send-push', jobData, {
        ...jobOptions,
        jobId: `push-${notificationId}-${Date.now()}`,
      });

      return job;
    } catch (error: any) {
      this.logger.error(
        `Failed to add push job for notification ${notificationId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Add push notification job to the queue for a specific user
   * This sends push notifications to ALL registered devices for the user
   */
  async addPushJobForUser(
    notificationId: string,
    userId: string,
    title: string,
    body: string,
    options?: {
      actionUrl?: string;
      metadata?: Record<string, any>;
      priority?: 'low' | 'normal' | 'high' | 'critical';
      delay?: number;
      scheduledFor?: Date;
    },
  ): Promise<Job<NotificationJobData>> {
    try {
      const jobData: NotificationJobData = {
        notificationId,
        channel: NOTIFICATION_CHANNEL.PUSH,
        userId, // Send to user's devices, not a specific token
        title,
        body,
        actionUrl: options?.actionUrl,
        metadata: options?.metadata,
        priority: options?.priority || 'normal',
        scheduledFor: options?.scheduledFor,
      };

      const jobOptions = this.getJobOptions(options?.priority || 'normal', options?.delay);

      this.logger.log(`Adding push job for notification ${notificationId} to user ${userId}`);

      const job = await this.notificationQueue.add('send-push', jobData, {
        ...jobOptions,
        jobId: `push-user-${notificationId}-${Date.now()}`,
      });

      return job;
    } catch (error: any) {
      this.logger.error(
        `Failed to add push job for notification ${notificationId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Add in-app notification job to the queue
   */
  async addInAppJob(
    notificationId: string,
    userId: string,
    title: string,
    body: string,
    options?: {
      actionUrl?: string;
      metadata?: Record<string, any>;
      priority?: 'low' | 'normal' | 'high' | 'critical';
      delay?: number;
    },
  ): Promise<Job<NotificationJobData>> {
    try {
      const jobData: NotificationJobData = {
        notificationId,
        channel: NOTIFICATION_CHANNEL.IN_APP,
        userId,
        title,
        body,
        actionUrl: options?.actionUrl,
        metadata: options?.metadata,
        priority: options?.priority || 'normal',
      };

      const jobOptions = this.getJobOptions(options?.priority || 'normal', options?.delay);

      this.logger.log(`Adding in-app job for notification ${notificationId} to user ${userId}`);

      const job = await this.notificationQueue.add('send-in-app', jobData, {
        ...jobOptions,
        jobId: `in-app-${notificationId}-${Date.now()}`,
      });

      return job;
    } catch (error: any) {
      this.logger.error(
        `Failed to add in-app job for notification ${notificationId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Add notification jobs for multiple channels
   */
  async addMultiChannelJobs(
    notificationId: string,
    channels: NOTIFICATION_CHANNEL[],
    data: {
      userId?: string;
      recipientEmail?: string;
      recipientPhone?: string;
      recipientDeviceToken?: string;
      title: string;
      body: string;
      actionUrl?: string;
      metadata?: Record<string, any>;
      priority?: 'low' | 'normal' | 'high' | 'critical';
    },
  ): Promise<Job<NotificationJobData>[]> {
    const jobs: Job<NotificationJobData>[] = [];

    for (const channel of channels) {
      try {
        let job: Job<NotificationJobData> | null = null;

        switch (channel) {
          case NOTIFICATION_CHANNEL.EMAIL:
            if (data.recipientEmail) {
              job = await this.addEmailJob(
                notificationId,
                data.recipientEmail,
                data.title,
                data.body,
                {
                  actionUrl: data.actionUrl,
                  metadata: data.metadata,
                  priority: data.priority,
                },
              );
            }
            break;

          case NOTIFICATION_CHANNEL.PUSH:
            // Prefer sending to user's devices if userId is available
            if (data.userId) {
              job = await this.addPushJobForUser(
                notificationId,
                data.userId,
                data.title,
                data.body,
                {
                  actionUrl: data.actionUrl,
                  metadata: data.metadata,
                  priority: data.priority,
                },
              );
            } else if (data.recipientDeviceToken) {
              // Fall back to specific device token if no userId
              job = await this.addPushJob(
                notificationId,
                data.recipientDeviceToken,
                data.title,
                data.body,
                {
                  actionUrl: data.actionUrl,
                  metadata: data.metadata,
                  priority: data.priority,
                },
              );
            }
            break;

          case NOTIFICATION_CHANNEL.IN_APP:
            if (data.userId) {
              job = await this.addInAppJob(notificationId, data.userId, data.title, data.body, {
                actionUrl: data.actionUrl,
                metadata: data.metadata,
                priority: data.priority,
              });
            }
            break;
        }

        if (job) {
          jobs.push(job);
        }
      } catch (error: any) {
        this.logger.error(
          `Failed to add job for channel ${channel} for notification ${notificationId}: ${error.message}`,
        );
        // Continue with other channels even if one fails
      }
    }

    return jobs;
  }

  /**
   * Schedule notification for future delivery
   */
  async scheduleNotification(
    notificationId: string,
    channel: NOTIFICATION_CHANNEL,
    scheduledFor: Date,
    data: {
      recipientEmail?: string;
      recipientPhone?: string;
      recipientDeviceToken?: string;
      userId?: string;
      title: string;
      body: string;
      actionUrl?: string;
      metadata?: Record<string, any>;
      priority?: 'low' | 'normal' | 'high' | 'critical';
    },
  ): Promise<Job<NotificationJobData>> {
    const delay = scheduledFor.getTime() - Date.now();

    if (delay <= 0) {
      throw new Error('Scheduled time must be in the future');
    }

    this.logger.log(
      `Scheduling ${channel} notification ${notificationId} for ${scheduledFor.toISOString()}`,
    );

    const options = {
      ...data,
      delay,
      scheduledFor,
    };

    switch (channel) {
      case NOTIFICATION_CHANNEL.EMAIL:
        if (!data.recipientEmail)
          throw new Error('recipientEmail is required for email notifications');
        return await this.addEmailJob(
          notificationId,
          data.recipientEmail,
          data.title,
          data.body,
          options,
        );

      case NOTIFICATION_CHANNEL.PUSH:
        if (!data.recipientDeviceToken)
          throw new Error('recipientDeviceToken is required for push notifications');
        return await this.addPushJob(
          notificationId,
          data.recipientDeviceToken,
          data.title,
          data.body,
          options,
        );

      case NOTIFICATION_CHANNEL.IN_APP:
        if (!data.userId) throw new Error('userId is required for in-app notifications');
        return await this.addInAppJob(notificationId, data.userId, data.title, data.body, options);

      default:
        throw new Error(`Unsupported notification channel: ${channel}`);
    }
  }

  /**
   * Batch add notification jobs
   */
  async batchAddJobs(
    notifications: Array<{
      notificationId: string;
      channel: NOTIFICATION_CHANNEL;
      data: {
        recipientEmail?: string;
        recipientPhone?: string;
        recipientDeviceToken?: string;
        userId?: string;
        title: string;
        body: string;
        actionUrl?: string;
        metadata?: Record<string, any>;
        priority?: 'low' | 'normal' | 'high' | 'critical';
      };
    }>,
  ): Promise<Job<NotificationJobData>[]> {
    const jobs: Job<NotificationJobData>[] = [];

    for (const notification of notifications) {
      try {
        const job = await this.scheduleNotification(
          notification.notificationId,
          notification.channel,
          new Date(), // Immediate delivery
          notification.data,
        );
        jobs.push(job);
      } catch (error: any) {
        this.logger.error(
          `Failed to add batch job for notification ${notification.notificationId}: ${error.message}`,
        );
        // Continue with other jobs
      }
    }

    return jobs;
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string | number): Promise<Job<NotificationJobData> | null> {
    try {
      return await this.notificationQueue.getJob(jobId);
    } catch (error: any) {
      this.logger.error(`Failed to get job ${jobId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get all jobs by notification ID
   */
  async getJobsByNotificationId(notificationId: string): Promise<Job<NotificationJobData>[]> {
    try {
      const allJobs = await this.notificationQueue.getJobs([
        'active',
        'waiting',
        'delayed',
        'completed',
        'failed',
      ]);

      return allJobs.filter(job => job.data.notificationId === notificationId);
    } catch (error: any) {
      this.logger.error(`Failed to get jobs for notification ${notificationId}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<NotificationQueueStats> {
    try {
      const [active, waiting, completed, failed, delayed, paused] = await Promise.all([
        this.notificationQueue.getActiveCount(),
        this.notificationQueue.getWaitingCount(),
        this.notificationQueue.getCompletedCount(),
        this.notificationQueue.getFailedCount(),
        this.notificationQueue.getDelayedCount(),
        this.notificationQueue.isPaused(),
      ]);

      return {
        active,
        waiting,
        completed,
        failed,
        delayed,
        paused,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get queue stats: ${error.message}`);
      return {
        active: 0,
        waiting: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
      };
    }
  }

  /**
   * Get jobs by state
   */
  async getJobsByState(
    states: Array<'active' | 'waiting' | 'delayed' | 'completed' | 'failed' | 'paused'>,
    start = 0,
    end = 100,
  ): Promise<NotificationJobInfo[]> {
    try {
      const jobs = await this.notificationQueue.getJobs(states, start, end);

      return Promise.all(
        jobs.map(async job => ({
          id: job.id,
          notificationId: job.data.notificationId,
          channel: job.data.channel,
          state: await job.getState(),
          progress: job.progress() as number,
          attemptsMade: job.attemptsMade,
          timestamp: job.timestamp,
          processedOn: job.processedOn,
          finishedOn: job.finishedOn,
          failedReason: job.failedReason,
          data: job.data,
        })),
      );
    } catch (error: any) {
      this.logger.error(`Failed to get jobs by state: ${error.message}`);
      return [];
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string | number): Promise<Job<NotificationJobData> | null> {
    try {
      const job = await this.notificationQueue.getJob(jobId);

      if (!job) {
        this.logger.warn(`Job ${jobId} not found`);
        return null;
      }

      const state = await job.getState();
      if (state !== 'failed') {
        this.logger.warn(`Job ${jobId} is not in failed state (current state: ${state})`);
        return job;
      }

      this.logger.log(`Retrying job ${jobId} for notification ${job.data.notificationId}`);

      await job.retry();
      return job;
    } catch (error: any) {
      this.logger.error(`Failed to retry job ${jobId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Remove/cancel a job
   */
  async removeJob(jobId: string | number): Promise<void> {
    try {
      const job = await this.notificationQueue.getJob(jobId);

      if (!job) {
        this.logger.warn(`Job ${jobId} not found`);
        return;
      }

      this.logger.log(`Removing job ${jobId} for notification ${job.data.notificationId}`);

      await job.remove();
    } catch (error: any) {
      this.logger.error(`Failed to remove job ${jobId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Pause queue processing
   */
  async pauseQueue(): Promise<void> {
    await this.notificationQueue.pause();
    this.logger.log('Notification queue paused');
  }

  /**
   * Resume queue processing
   */
  async resumeQueue(): Promise<void> {
    await this.notificationQueue.resume();
    this.logger.log('Notification queue resumed');
  }

  /**
   * Clean old jobs from the queue
   */
  async cleanQueue(
    type: JobStatusCleanInput = 'completed',
    olderThan: number = 24 * 60 * 60 * 1000, // 24 hours
  ): Promise<number> {
    // Map user-friendly 'waiting' to Bull.js expected 'wait'
    const cleanType: JobStatusClean = type === 'waiting' ? 'wait' : (type as JobStatusClean);

    const jobs = await this.notificationQueue.clean(olderThan, cleanType);
    this.logger.log(`Cleaned ${jobs.length} ${type} jobs older than ${olderThan}ms`);
    return jobs.length;
  }

  /**
   * Empty the queue (remove all jobs)
   */
  async emptyQueue(): Promise<void> {
    await this.notificationQueue.empty();
    this.logger.log('Notification queue emptied');
  }

  /**
   * Setup queue event listeners for monitoring
   */
  private setupQueueListeners(): void {
    this.notificationQueue.on('error', (error: Error) => {
      this.logger.error(`Notification queue error: ${error.message}`, error.stack);
    });

    this.notificationQueue.on('stalled', (job: Job<NotificationJobData>) => {
      this.logger.warn(
        `Notification job stalled: ${job.id} for notification ${job.data.notificationId}`,
      );
    });

    this.notificationQueue.on('waiting', (jobId: number | string) => {
      this.logger.debug(`Job ${jobId} is waiting to be processed`);
    });
  }

  /**
   * Get job options based on priority
   */
  private getJobOptions(
    priority: 'low' | 'normal' | 'high' | 'critical',
    delay?: number,
  ): Record<string, any> {
    const baseOptions = {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    };

    let priorityValue = 5;
    let attempts = 3;

    switch (priority) {
      case 'critical':
        priorityValue = 1;
        attempts = 5;
        break;
      case 'high':
        priorityValue = 3;
        attempts = 4;
        break;
      case 'normal':
        priorityValue = 5;
        attempts = 3;
        break;
      case 'low':
        priorityValue = 10;
        attempts = 2;
        break;
    }

    return {
      ...baseOptions,
      priority: priorityValue,
      attempts,
      ...(delay && { delay }),
    };
  }

  /**
   * Utility: Mask email for logging
   */
  private maskEmail(email: string): string {
    const [username, domain] = email.split('@');
    if (!domain) return email;
    const maskedUsername =
      username.length > 2
        ? username[0] + '*'.repeat(username.length - 2) + username[username.length - 1]
        : username;
    return `${maskedUsername}@${domain}`;
  }

  /**
   * Retry a failed delivery
   * Re-queues the notification with exponential backoff
   */
  async retryDelivery(deliveryId: string): Promise<Job<NotificationJobData> | null> {
    try {
      // Find the delivery record
      const delivery = await this.prisma.notificationDelivery.findUnique({
        where: { id: deliveryId },
        include: {
          notification: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!delivery) {
        this.logger.warn(`Delivery ${deliveryId} not found`);
        return null;
      }

      if (delivery.status !== 'FAILED') {
        this.logger.warn(
          `Delivery ${deliveryId} is not in failed state (current: ${delivery.status})`,
        );
        return null;
      }

      // Extract retry count from metadata
      const metadata = delivery.metadata as any;
      const retryCount = metadata?.retryCount || 0;
      const maxRetries = 3;

      if (retryCount >= maxRetries) {
        this.logger.warn(`Delivery ${deliveryId} has exceeded max retries (${maxRetries})`);
        return null;
      }

      // Calculate exponential backoff delay
      const delays = [2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000]; // 2min, 5min, 15min
      const backoffDelay = delays[retryCount] || delays[delays.length - 1];

      this.logger.log(
        `Retrying delivery ${deliveryId} for notification ${delivery.notificationId} (attempt ${retryCount + 1}/${maxRetries}) with ${backoffDelay}ms backoff`,
      );

      // Update delivery status to RETRYING
      await this.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'RETRYING',
          metadata: {
            ...metadata,
            retryCount: retryCount + 1,
          },
          updatedAt: new Date(),
        },
      });

      const notification = delivery.notification;
      const user = notification.user;

      // Re-queue the notification based on channel
      let job: Job<NotificationJobData> | null = null;

      switch (delivery.channel) {
        case 'EMAIL':
          if (user?.email) {
            job = await this.addEmailJob(
              notification.id,
              user.email,
              notification.title,
              notification.body,
              {
                actionUrl: notification.actionUrl || undefined,
                metadata: metadata,
                priority: 'high', // Use high priority for retries
                delay: backoffDelay,
              },
            );
          }
          break;

        case 'PUSH':
          // Would need device token from user or metadata
          this.logger.warn(
            `Push notification retry not implemented yet for delivery ${deliveryId}`,
          );
          break;

        case 'IN_APP':
          if (user?.id) {
            job = await this.addInAppJob(
              notification.id,
              user.id,
              notification.title,
              notification.body,
              {
                actionUrl: notification.actionUrl || undefined,
                metadata: metadata,
                priority: 'high',
                delay: backoffDelay,
              },
            );
          }
          break;

        default:
          this.logger.warn(`Unsupported channel for retry: ${delivery.channel}`);
      }

      if (job) {
        this.logger.log(`Successfully queued retry job ${job.id} for delivery ${deliveryId}`);
      } else {
        this.logger.warn(`Failed to queue retry job for delivery ${deliveryId}`);
      }

      return job;
    } catch (error: any) {
      this.logger.error(`Failed to retry delivery ${deliveryId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Queue notification job (generic method used by dispatch service)
   * This is a wrapper that routes to the appropriate channel-specific method
   */
  async queueNotificationJob(job: {
    notificationId: string;
    deliveryId: string;
    channel: NOTIFICATION_CHANNEL;
    userId: string;
    attempts: number;
  }): Promise<Job<NotificationJobData>> {
    // Fetch notification and user details
    const notification = await this.prisma.notification.findUnique({
      where: { id: job.notificationId },
      include: { user: true },
    });

    if (!notification) {
      throw new Error(`Notification ${job.notificationId} not found`);
    }

    const user = notification.user;
    if (!user) {
      throw new Error(`User not found for notification ${job.notificationId}`);
    }

    // Route to appropriate channel method
    switch (job.channel) {
      case NOTIFICATION_CHANNEL.EMAIL:
        if (!user.email) {
          throw new Error(`User ${user.id} has no email address`);
        }
        return await this.addEmailJob(
          job.notificationId,
          user.email,
          notification.title,
          notification.body,
          {
            actionUrl: notification.actionUrl || undefined,
            metadata: { deliveryId: job.deliveryId, attempts: job.attempts },
            priority: 'normal',
          },
        );

      case NOTIFICATION_CHANNEL.WHATSAPP:
        if (!user.phone) {
          throw new Error(`User ${user.id} has no phone number for WhatsApp`);
        }
        return await this.addWhatsAppJob(job.notificationId, user.id, user.phone, notification.body, {
          metadata: { deliveryId: job.deliveryId, attempts: job.attempts },
          priority: 'normal',
        });

      case NOTIFICATION_CHANNEL.PUSH:
        // For push notifications, we send to all user's registered devices
        // Include notification metadata for mobile navigation (entityType, entityId, mobileUrl, etc.)
        const notificationMetadata = notification.metadata as Record<string, any> || {};
        return await this.addPushJobForUser(
          job.notificationId,
          user.id,
          notification.title,
          notification.body,
          {
            actionUrl: notification.actionUrl || undefined,
            metadata: {
              ...notificationMetadata, // Include entityType, entityId, mobileUrl, webUrl, universalLink from notification
              deliveryId: job.deliveryId,
              attempts: job.attempts,
            },
            priority: 'normal',
          },
        );

      case NOTIFICATION_CHANNEL.IN_APP:
        return await this.addInAppJob(
          job.notificationId,
          user.id,
          notification.title,
          notification.body,
          {
            actionUrl: notification.actionUrl || undefined,
            metadata: { deliveryId: job.deliveryId, attempts: job.attempts },
            priority: 'normal',
          },
        );

      default:
        throw new Error(`Unsupported notification channel: ${job.channel}`);
    }
  }

  /**
   * Utility: Mask phone for logging
   */
  private maskPhone(phone: string): string {
    if (phone.length <= 4) return phone;
    const start = phone.slice(0, 2);
    const end = phone.slice(-2);
    const middle = '*'.repeat(phone.length - 4);
    return `${start}${middle}${end}`;
  }
}
