import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../../push/push.service';
import { NOTIFICATION_CHANNEL } from '../../../../constants';

/**
 * Push notification job data
 */
export interface PushJobData {
  notificationId: string;
  deliveryId?: string;
  recipientDeviceToken: string;
  userId?: string;
  title: string;
  body: string;
  actionUrl?: string;
  imageUrl?: string;
  data?: Record<string, any>;
  metadata?: Record<string, any>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  platform?: 'ios' | 'android' | 'web';
  retryCount?: number;
}

/**
 * Push delivery result
 */
export interface PushDeliveryResult {
  notificationId: string;
  deliveryId?: string;
  success: boolean;
  deliveredAt?: Date;
  error?: string;
  messageId?: string;
  retryCount?: number;
  processingTime?: number;
}

/**
 * Push Notification Queue Processor
 *
 * Handles background processing of push notifications with:
 * - Firebase Cloud Messaging (FCM) integration via PushService
 * - Retry logic with exponential backoff
 * - Delivery tracking and status updates
 * - Event emission for monitoring
 * - Rate limiting (10 concurrent jobs for high throughput)
 * - Progress tracking
 * - Platform-specific handling (iOS, Android, Web)
 */
@Processor('push-notifications')
@Injectable()
export class PushProcessor {
  private readonly logger = new Logger(PushProcessor.name);

  // Rate limiting - track sent push notifications per minute
  private readonly RATE_LIMIT_PER_MINUTE = 100;
  private pushSentTimestamps: number[] = [];

  // Retry configuration
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_BACKOFF_BASE = 2000; // 2 seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Process push notification job
   * Concurrency: 10 (process up to 10 push notifications simultaneously)
   */
  @Process({
    name: 'send-push',
    concurrency: 10,
  })
  async processPushJob(job: Job<PushJobData>): Promise<PushDeliveryResult> {
    const startTime = Date.now();
    const {
      notificationId,
      deliveryId,
      recipientDeviceToken,
      userId,
      title,
      body,
      actionUrl,
      imageUrl,
      data,
      metadata,
      platform,
    } = job.data;

    this.logger.log(
      `Processing push job ${job.id} for notification ${notificationId} to device ${this.maskToken(recipientDeviceToken)}`,
    );

    try {
      // Step 1: Validate device token
      await job.progress(10);
      if (!recipientDeviceToken) {
        throw new Error('Recipient device token is required for push notifications');
      }

      // Step 2: Check rate limiting
      await job.progress(20);
      await this.checkRateLimit();

      // Step 3: Update delivery status to PROCESSING
      await job.progress(30);
      if (deliveryId) {
        await this.updateDeliveryStatus(deliveryId, 'PROCESSING');
      }

      // Step 4: Prepare push notification data
      await job.progress(40);
      const pushData = {
        title,
        body,
        data: {
          notificationId,
          actionUrl,
          ...data,
          ...metadata,
        },
        imageUrl,
        actionUrl,
      };

      // Step 5: Send push notification using PushService
      await job.progress(60);
      const result = await this.pushService.sendPushNotification(
        recipientDeviceToken,
        title,
        body,
        pushData.data,
      );

      await job.progress(80);

      // Step 6: Check if push was sent successfully
      if (!result.success) {
        throw new Error(result.error || 'Failed to send push notification');
      }

      const processingTime = Date.now() - startTime;

      // Step 7: Update delivery status to DELIVERED
      if (deliveryId) {
        await this.updateDeliveryStatus(deliveryId, 'DELIVERED', result.messageId);
      } else {
        // Update notification sentAt if no deliveryId
        await this.updateNotificationSentAt(notificationId);
      }

      await job.progress(100);

      // Step 8: Emit success event
      this.eventEmitter.emit('push.notification.delivered', {
        notificationId,
        deliveryId,
        userId,
        deviceToken: this.maskToken(recipientDeviceToken),
        messageId: result.messageId,
        platform,
        deliveredAt: new Date(),
        processingTime,
        jobId: job.id,
      });

      this.logger.log(
        `Push notification ${notificationId} sent successfully in ${processingTime}ms (Message ID: ${result.messageId})`,
      );

      return {
        notificationId,
        deliveryId,
        success: true,
        deliveredAt: new Date(),
        messageId: result.messageId,
        processingTime,
      };
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Failed to send push notification ${notificationId}: ${error.message}`,
        error.stack,
      );

      // Check if token is invalid and should be removed
      if (this.isInvalidTokenError(error)) {
        this.logger.warn(
          `Invalid device token detected for notification ${notificationId}, marking token as invalid`,
        );

        // Mark token as invalid in database
        if (userId) {
          await this.markDeviceTokenInvalid(userId, recipientDeviceToken);
        }
      }

      // Update delivery status as failed
      if (deliveryId) {
        await this.updateDeliveryStatus(deliveryId, 'FAILED', undefined, error.message);
      }

      // Emit failure event
      this.eventEmitter.emit('push.notification.failed', {
        notificationId,
        deliveryId,
        userId,
        deviceToken: this.maskToken(recipientDeviceToken),
        error: error.message,
        failedAt: new Date(),
        retryCount: job.attemptsMade,
        jobId: job.id,
      });

      // Return failure result (will trigger retry if attempts remaining)
      return {
        notificationId,
        deliveryId,
        success: false,
        error: error.message,
        retryCount: job.attemptsMade,
        processingTime,
      };
    }
  }

  /**
   * Event listener: Job becomes active
   */
  @OnQueueActive()
  onActive(job: Job<PushJobData>) {
    this.logger.log(
      `Push job ${job.id} started processing for notification ${job.data.notificationId}`,
    );

    // Emit job started event
    this.eventEmitter.emit('push.job.started', {
      jobId: job.id,
      notificationId: job.data.notificationId,
      userId: job.data.userId,
      platform: job.data.platform,
      startedAt: new Date(),
    });
  }

  /**
   * Event listener: Job completed successfully
   */
  @OnQueueCompleted()
  onCompleted(job: Job<PushJobData>, result: PushDeliveryResult) {
    this.logger.log(
      `Push job ${job.id} completed for notification ${result.notificationId} - Success: ${result.success}`,
    );

    // Emit job completed event
    this.eventEmitter.emit('push.job.completed', {
      jobId: job.id,
      notificationId: result.notificationId,
      success: result.success,
      processingTime: result.processingTime,
      completedAt: new Date(),
    });
  }

  /**
   * Event listener: Job failed
   */
  @OnQueueFailed()
  async onFailed(job: Job<PushJobData>, error: Error) {
    const { notificationId, deliveryId, userId, recipientDeviceToken } = job.data;
    const maxRetries = job.opts.attempts || this.MAX_RETRY_ATTEMPTS;

    this.logger.error(
      `Push job ${job.id} failed for notification ${notificationId} (Attempt ${job.attemptsMade}/${maxRetries})`,
      error.stack,
    );

    // Emit job failed event
    this.eventEmitter.emit('push.job.failed', {
      jobId: job.id,
      notificationId,
      deliveryId,
      userId,
      deviceToken: this.maskToken(recipientDeviceToken),
      error: error.message,
      attemptsMade: job.attemptsMade,
      maxRetries,
      failedAt: new Date(),
    });

    // If all retries exhausted, mark as permanently failed
    if (job.attemptsMade >= maxRetries) {
      this.logger.error(
        `Push notification ${notificationId} permanently failed after ${job.attemptsMade} attempts`,
      );

      if (deliveryId) {
        await this.markDeliveryPermanentlyFailed(deliveryId, error.message, job.attemptsMade);
      }

      // Emit permanent failure event
      this.eventEmitter.emit('push.notification.permanent.failure', {
        notificationId,
        deliveryId,
        userId,
        deviceToken: this.maskToken(recipientDeviceToken),
        error: error.message,
        totalAttempts: job.attemptsMade,
        failedAt: new Date(),
      });
    } else {
      // Retry will be attempted (unless it's an invalid token error)
      if (!this.isInvalidTokenError(error)) {
        const nextAttempt = job.attemptsMade + 1;
        const delay = this.calculateBackoffDelay(job.attemptsMade);

        this.logger.log(
          `Push notification ${notificationId} will be retried (Attempt ${nextAttempt}/${maxRetries}) in ${delay}ms`,
        );

        // Update delivery status to RETRYING
        if (deliveryId) {
          await this.updateDeliveryStatusWithRetry(
            deliveryId,
            'RETRYING',
            undefined,
            error.message,
            job.attemptsMade,
          );
        }

        // Emit retry scheduled event
        this.eventEmitter.emit('push.notification.retry.scheduled', {
          notificationId,
          deliveryId,
          userId,
          nextAttempt,
          maxRetries,
          delay,
          scheduledAt: new Date(),
        });
      } else {
        this.logger.log(
          `Push notification ${notificationId} will not be retried due to invalid token`,
        );
      }
    }
  }

  /**
   * Update delivery status in database
   */
  private async updateDeliveryStatus(
    deliveryId: string,
    status: 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'RETRYING',
    messageId?: string,
    errorMessage?: string,
  ): Promise<void> {
    try {
      const now = new Date();
      await this.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: status as any,
          sentAt: status === 'PROCESSING' ? now : undefined,
          deliveredAt: status === 'DELIVERED' ? now : null,
          failedAt: status === 'FAILED' ? now : null,
          errorMessage: errorMessage || null,
          metadata: messageId ? { messageId } : undefined,
          updatedAt: now,
        },
      });

      this.logger.debug(`Updated delivery ${deliveryId} status to ${status}`);
    } catch (error: any) {
      this.logger.error(
        `Failed to update delivery status for ${deliveryId}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Update delivery status with retry count
   */
  private async updateDeliveryStatusWithRetry(
    deliveryId: string,
    status: 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'RETRYING',
    messageId?: string,
    errorMessage?: string,
    retryCount?: number,
  ): Promise<void> {
    try {
      const delivery = await this.prisma.notificationDelivery.findUnique({
        where: { id: deliveryId },
      });

      if (!delivery) {
        this.logger.warn(`Delivery ${deliveryId} not found`);
        return;
      }

      const now = new Date();
      await this.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: status as any,
          sentAt: status === 'PROCESSING' ? now : undefined,
          deliveredAt: status === 'DELIVERED' ? now : null,
          failedAt: status === 'FAILED' ? now : null,
          errorMessage: errorMessage || null,
          metadata: {
            ...((delivery.metadata as any) || {}),
            ...(messageId && { messageId }),
            ...(retryCount !== undefined && { retryCount }),
          },
          updatedAt: now,
        },
      });

      this.logger.debug(
        `Updated delivery ${deliveryId} status to ${status}${retryCount !== undefined ? ` [Retry ${retryCount}]` : ''}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to update delivery status for ${deliveryId}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Mark delivery as permanently failed
   */
  private async markDeliveryPermanentlyFailed(
    deliveryId: string,
    error: string,
    attempts: number,
  ): Promise<void> {
    try {
      const delivery = await this.prisma.notificationDelivery.findUnique({
        where: { id: deliveryId },
      });

      if (!delivery) {
        this.logger.warn(`Delivery ${deliveryId} not found`);
        return;
      }

      await this.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'FAILED',
          errorMessage: `Permanently failed after ${attempts} retry attempts: ${error}`,
          failedAt: new Date(),
          metadata: {
            ...((delivery.metadata as any) || {}),
            retryCount: attempts,
            permanentlyFailed: true,
          },
        },
      });

      this.logger.log(`Marked delivery ${deliveryId} as permanently failed`);
    } catch (err: any) {
      this.logger.error(
        `Failed to mark delivery as permanently failed: ${err.message}`,
        err.stack,
      );
    }
  }

  /**
   * Update notification sentAt timestamp
   */
  private async updateNotificationSentAt(notificationId: string): Promise<void> {
    try {
      const notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
      });

      if (!notification) {
        this.logger.warn(`Notification ${notificationId} not found`);
        return;
      }

      if (!notification.sentAt) {
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: { sentAt: new Date() },
        });
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to update sentAt for notification ${notificationId}: ${error.message}`,
      );
    }
  }

  /**
   * Mark device token as invalid in database
   */
  private async markDeviceTokenInvalid(userId: string, token: string): Promise<void> {
    try {
      // Find and update the device token
      const deviceToken = await this.prisma.deviceToken.findFirst({
        where: {
          userId,
          token,
        },
      });

      if (deviceToken) {
        await this.prisma.deviceToken.update({
          where: { id: deviceToken.id },
          data: {
            isActive: false,
            updatedAt: new Date(),
          },
        });

        this.logger.log(`Marked device token as invalid for user ${userId}`);
      }
    } catch (error: any) {
      this.logger.error(`Failed to mark device token as invalid: ${error.message}`);
    }
  }

  /**
   * Check if error indicates an invalid token
   */
  private isInvalidTokenError(error: any): boolean {
    const errorMessage = error.message?.toLowerCase() || '';
    return (
      errorMessage.includes('invalid token') ||
      errorMessage.includes('not registered') ||
      errorMessage.includes('invalid registration') ||
      errorMessage.includes('mismatched sender')
    );
  }

  /**
   * Check rate limiting to avoid overwhelming push service
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove timestamps older than 1 minute
    this.pushSentTimestamps = this.pushSentTimestamps.filter(
      timestamp => timestamp > oneMinuteAgo,
    );

    // Check if rate limit exceeded
    if (this.pushSentTimestamps.length >= this.RATE_LIMIT_PER_MINUTE) {
      const oldestTimestamp = this.pushSentTimestamps[0];
      const waitTime = oldestTimestamp + 60000 - now;

      this.logger.warn(
        `Push rate limit exceeded. Waiting ${Math.ceil(waitTime / 1000)} seconds...`,
      );

      // Wait before proceeding
      await this.delay(waitTime);

      // Re-check after waiting
      return this.checkRateLimit();
    }

    // Add current timestamp
    this.pushSentTimestamps.push(now);
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attemptsMade: number): number {
    return this.RETRY_BACKOFF_BASE * Math.pow(2, attemptsMade);
  }

  /**
   * Mask device token for privacy in logs
   */
  private maskToken(token?: string): string {
    if (!token) return 'N/A';
    if (token.length <= 8) return token;
    const start = token.slice(0, 4);
    const end = token.slice(-4);
    return `${start}****${end}`;
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
