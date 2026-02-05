import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppNotificationService } from '../whatsapp/whatsapp.service';
import { NOTIFICATION_CHANNEL } from '../../../../constants';

/**
 * WhatsApp notification job data
 */
export interface WhatsAppJobData {
  notificationId: string;
  deliveryId?: string;
  userId: string;
  recipientPhone?: string;
  title: string;
  body: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  retryCount?: number;
}

/**
 * WhatsApp delivery result
 */
export interface WhatsAppDeliveryResult {
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
 * WhatsApp Queue Processor
 *
 * Handles background processing of WhatsApp notifications with:
 * - WhatsApp Web integration via WhatsAppNotificationService
 * - Retry logic with exponential backoff
 * - Delivery tracking and status updates
 * - Event emission for monitoring
 * - Rate limiting (3 concurrent jobs to avoid spam)
 * - Progress tracking
 * - Phone number validation
 */
@Processor('whatsapp-notifications')
@Injectable()
export class WhatsAppProcessor {
  private readonly logger = new Logger(WhatsAppProcessor.name);

  // Rate limiting - track sent WhatsApp messages per minute
  private readonly RATE_LIMIT_PER_MINUTE = 20;
  private whatsappSentTimestamps: number[] = [];

  // Retry configuration
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_BACKOFF_BASE = 5000; // 5 seconds (higher than email/push)

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsAppNotificationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Process WhatsApp notification job
   * Concurrency: 3 (process up to 3 WhatsApp messages simultaneously)
   */
  @Process({
    name: 'send-whatsapp',
    concurrency: 3,
  })
  async processWhatsAppJob(job: Job<WhatsAppJobData>): Promise<WhatsAppDeliveryResult> {
    const startTime = Date.now();
    const { notificationId, deliveryId, userId, recipientPhone, title, body, actionUrl, metadata } =
      job.data;

    this.logger.log(
      `Processing WhatsApp job ${job.id} for notification ${notificationId} to user ${userId}`,
    );

    try {
      // Step 1: Validate user ID
      await job.progress(10);
      if (!userId) {
        throw new Error('User ID is required for WhatsApp notifications');
      }

      // Step 2: Check rate limiting
      await job.progress(15);
      await this.checkRateLimit();

      // Step 3: Get notification and user data
      await job.progress(20);
      const notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
      });

      if (!notification) {
        throw new Error(`Notification ${notificationId} not found`);
      }

      await job.progress(30);
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

      // Step 4: Get or create delivery record if not provided
      await job.progress(40);
      let effectiveDeliveryId = deliveryId;

      if (!effectiveDeliveryId) {
        // Create delivery record
        const delivery = await this.prisma.notificationDelivery.create({
          data: {
            notificationId,
            channel: NOTIFICATION_CHANNEL.WHATSAPP as any,
            status: 'PROCESSING' as any,
          },
        });
        effectiveDeliveryId = delivery.id;
      } else {
        // Update existing delivery to PROCESSING
        await this.updateDeliveryStatus(effectiveDeliveryId, 'PROCESSING');
      }

      // Step 5: Send WhatsApp notification using WhatsAppNotificationService
      await job.progress(60);
      const result = await this.whatsappService.sendNotification(
        notification as any,
        user as any,
        effectiveDeliveryId,
      );

      await job.progress(80);

      // Step 6: Check if WhatsApp message was sent successfully
      if (!result.success) {
        throw new Error(result.error || 'Failed to send WhatsApp notification');
      }

      const processingTime = Date.now() - startTime;

      // Step 7: Update notification sentAt if not set
      await this.updateNotificationSentAt(notificationId);

      await job.progress(100);

      // Step 8: Emit success event
      this.eventEmitter.emit('whatsapp.notification.delivered', {
        notificationId,
        deliveryId: effectiveDeliveryId,
        userId,
        phoneNumber: this.maskPhone(user.phone || ''),
        messageId: result.messageId,
        deliveredAt: result.deliveredAt,
        processingTime,
        jobId: job.id,
      });

      this.logger.log(
        `WhatsApp notification ${notificationId} sent successfully in ${processingTime}ms`,
      );

      return {
        notificationId,
        deliveryId: effectiveDeliveryId,
        success: true,
        deliveredAt: result.deliveredAt,
        messageId: result.messageId,
        processingTime,
      };
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Failed to send WhatsApp notification ${notificationId}: ${error.message}`,
        error.stack,
      );

      // Update delivery status as failed if we have a deliveryId
      if (deliveryId) {
        await this.updateDeliveryStatus(deliveryId, 'FAILED', undefined, error.message);
      }

      // Emit failure event
      this.eventEmitter.emit('whatsapp.notification.failed', {
        notificationId,
        deliveryId,
        userId,
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
  onActive(job: Job<WhatsAppJobData>) {
    this.logger.log(
      `WhatsApp job ${job.id} started processing for notification ${job.data.notificationId}`,
    );

    // Emit job started event
    this.eventEmitter.emit('whatsapp.job.started', {
      jobId: job.id,
      notificationId: job.data.notificationId,
      userId: job.data.userId,
      startedAt: new Date(),
    });
  }

  /**
   * Event listener: Job completed successfully
   */
  @OnQueueCompleted()
  onCompleted(job: Job<WhatsAppJobData>, result: WhatsAppDeliveryResult) {
    this.logger.log(
      `WhatsApp job ${job.id} completed for notification ${result.notificationId} - Success: ${result.success}`,
    );

    // Emit job completed event
    this.eventEmitter.emit('whatsapp.job.completed', {
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
  async onFailed(job: Job<WhatsAppJobData>, error: Error) {
    const { notificationId, deliveryId, userId } = job.data;
    const maxRetries = job.opts.attempts || this.MAX_RETRY_ATTEMPTS;

    this.logger.error(
      `WhatsApp job ${job.id} failed for notification ${notificationId} (Attempt ${job.attemptsMade}/${maxRetries})`,
      error.stack,
    );

    // Emit job failed event
    this.eventEmitter.emit('whatsapp.job.failed', {
      jobId: job.id,
      notificationId,
      deliveryId,
      userId,
      error: error.message,
      attemptsMade: job.attemptsMade,
      maxRetries,
      failedAt: new Date(),
    });

    // If all retries exhausted, mark as permanently failed
    if (job.attemptsMade >= maxRetries) {
      this.logger.error(
        `WhatsApp notification ${notificationId} permanently failed after ${job.attemptsMade} attempts`,
      );

      if (deliveryId) {
        await this.markDeliveryPermanentlyFailed(deliveryId, error.message, job.attemptsMade);
      }

      // Emit permanent failure event
      this.eventEmitter.emit('whatsapp.notification.permanent.failure', {
        notificationId,
        deliveryId,
        userId,
        error: error.message,
        totalAttempts: job.attemptsMade,
        failedAt: new Date(),
      });
    } else {
      // Retry will be attempted (unless it's a non-retryable error)
      if (this.shouldRetry(error)) {
        const nextAttempt = job.attemptsMade + 1;
        const delay = this.calculateBackoffDelay(job.attemptsMade);

        this.logger.log(
          `WhatsApp notification ${notificationId} will be retried (Attempt ${nextAttempt}/${maxRetries}) in ${delay}ms`,
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
        this.eventEmitter.emit('whatsapp.notification.retry.scheduled', {
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
          `WhatsApp notification ${notificationId} will not be retried due to non-retryable error: ${error.message}`,
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
      this.logger.error(`Failed to mark delivery as permanently failed: ${err.message}`, err.stack);
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
   * Determine if error should trigger retry
   */
  private shouldRetry(error: any): boolean {
    const errorMessage = error.message?.toLowerCase() || '';

    // Don't retry for these errors
    const nonRetryableErrors = [
      'not registered on whatsapp',
      'invalid phone',
      'no phone number',
      'user has disabled',
      'disabled whatsapp notifications',
    ];

    for (const nonRetryable of nonRetryableErrors) {
      if (errorMessage.includes(nonRetryable)) {
        return false;
      }
    }

    // Retry for these errors
    const retryableErrors = [
      'not ready',
      'disconnected',
      'timeout',
      'network',
      'rate limit',
      'session',
    ];

    for (const retryable of retryableErrors) {
      if (errorMessage.includes(retryable)) {
        return true;
      }
    }

    // Default: retry for unknown errors
    return true;
  }

  /**
   * Check rate limiting to avoid WhatsApp spam restrictions
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove timestamps older than 1 minute
    this.whatsappSentTimestamps = this.whatsappSentTimestamps.filter(
      timestamp => timestamp > oneMinuteAgo,
    );

    // Check if rate limit exceeded
    if (this.whatsappSentTimestamps.length >= this.RATE_LIMIT_PER_MINUTE) {
      const oldestTimestamp = this.whatsappSentTimestamps[0];
      const waitTime = oldestTimestamp + 60000 - now;

      this.logger.warn(
        `WhatsApp rate limit exceeded. Waiting ${Math.ceil(waitTime / 1000)} seconds...`,
      );

      // Wait before proceeding
      await this.delay(waitTime);

      // Re-check after waiting
      return this.checkRateLimit();
    }

    // Add current timestamp
    this.whatsappSentTimestamps.push(now);
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attemptsMade: number): number {
    return this.RETRY_BACKOFF_BASE * Math.pow(2, attemptsMade);
  }

  /**
   * Mask phone number for privacy in logs
   */
  private maskPhone(phone?: string): string {
    if (!phone) return 'N/A';
    if (phone.length <= 4) return phone;
    const start = phone.slice(0, 2);
    const end = phone.slice(-2);
    const middle = '*'.repeat(phone.length - 4);
    return `${start}${middle}${end}`;
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
