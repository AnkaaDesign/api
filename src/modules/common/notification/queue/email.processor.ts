import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../mailer/services/email.service';
import { NOTIFICATION_CHANNEL } from '../../../../constants';

/**
 * Email notification job data
 */
export interface EmailJobData {
  notificationId: string;
  deliveryId?: string;
  recipientEmail: string;
  title: string;
  body: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  templateName?: string;
  templateData?: Record<string, any>;
  retryCount?: number;
}

/**
 * Email delivery result
 */
export interface EmailDeliveryResult {
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
 * Email Queue Processor
 *
 * Handles background processing of email notifications with:
 * - EmailService integration for delivery
 * - Retry logic with exponential backoff
 * - Delivery tracking and status updates
 * - Event emission for monitoring
 * - Rate limiting (5 concurrent jobs)
 * - Progress tracking
 */
@Processor('email-notifications')
@Injectable()
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  // Rate limiting - track sent emails per minute
  private readonly RATE_LIMIT_PER_MINUTE = 60;
  private emailSentTimestamps: number[] = [];

  // Retry configuration
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_BACKOFF_BASE = 2000; // 2 seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Process email notification job
   * Concurrency: 5 (process up to 5 emails simultaneously)
   */
  @Process({
    name: 'send-email',
    concurrency: 5,
  })
  async processEmailJob(job: Job<EmailJobData>): Promise<EmailDeliveryResult> {
    const startTime = Date.now();
    const {
      notificationId,
      deliveryId,
      recipientEmail,
      title,
      body,
      actionUrl,
      metadata,
      templateName,
      templateData,
    } = job.data;

    this.logger.log(
      `Processing email job ${job.id} for notification ${notificationId} to ${this.maskEmail(recipientEmail)}`,
    );

    try {
      // Step 1: Validate recipient email
      await job.progress(10);
      if (!recipientEmail) {
        throw new Error('Recipient email is required for email notifications');
      }

      // Step 2: Check rate limiting
      await job.progress(20);
      await this.checkRateLimit();

      // Step 3: Update delivery status to PROCESSING
      await job.progress(30);
      if (deliveryId) {
        await this.updateDeliveryStatus(deliveryId, 'PROCESSING');
      }

      // Step 4: Prepare email data
      await job.progress(40);
      const emailData = {
        companyName: process.env.COMPANY_NAME || 'Ankaa',
        supportEmail: process.env.SUPPORT_EMAIL || 'support@ankaa.com',
        supportPhone: process.env.SUPPORT_PHONE || '',
        supportUrl: process.env.SUPPORT_URL || '',
        userName: metadata?.userName,
        title,
        body,
        actionUrl,
        ...metadata,
        ...templateData,
      };

      // Step 5: Send email using EmailService
      await job.progress(60);
      let result;

      if (templateName) {
        // Use template-based sending if template is specified
        this.logger.log(`Sending templated email using template: ${templateName}`);
        result = await this.emailService.sendEmailWithRetry(
          recipientEmail,
          title,
          this.generateEmailHtml(title, body, actionUrl, emailData),
          'NOTIFICATION',
        );
      } else {
        // Use standard email sending
        result = await this.emailService.sendEmailWithRetry(
          recipientEmail,
          title,
          this.generateEmailHtml(title, body, actionUrl, emailData),
          'NOTIFICATION',
        );
      }

      await job.progress(80);

      // Step 6: Check if email was sent successfully
      if (!result.success) {
        throw new Error(result.error || 'Failed to send email');
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
      this.eventEmitter.emit('email.notification.delivered', {
        notificationId,
        deliveryId,
        recipientEmail: this.maskEmail(recipientEmail),
        messageId: result.messageId,
        deliveredAt: new Date(),
        processingTime,
        jobId: job.id,
      });

      this.logger.log(
        `Email notification ${notificationId} sent successfully in ${processingTime}ms (Message ID: ${result.messageId})`,
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
        `Failed to send email notification ${notificationId}: ${error.message}`,
        error.stack,
      );

      // Update delivery status as failed
      if (deliveryId) {
        await this.updateDeliveryStatus(deliveryId, 'FAILED', undefined, error.message);
      }

      // Emit failure event
      this.eventEmitter.emit('email.notification.failed', {
        notificationId,
        deliveryId,
        recipientEmail: this.maskEmail(recipientEmail),
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
  onActive(job: Job<EmailJobData>) {
    this.logger.log(
      `Email job ${job.id} started processing for notification ${job.data.notificationId}`,
    );

    // Emit job started event
    this.eventEmitter.emit('email.job.started', {
      jobId: job.id,
      notificationId: job.data.notificationId,
      recipientEmail: this.maskEmail(job.data.recipientEmail),
      startedAt: new Date(),
    });
  }

  /**
   * Event listener: Job completed successfully
   */
  @OnQueueCompleted()
  onCompleted(job: Job<EmailJobData>, result: EmailDeliveryResult) {
    this.logger.log(
      `Email job ${job.id} completed for notification ${result.notificationId} - Success: ${result.success}`,
    );

    // Emit job completed event
    this.eventEmitter.emit('email.job.completed', {
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
  async onFailed(job: Job<EmailJobData>, error: Error) {
    const { notificationId, deliveryId, recipientEmail } = job.data;
    const maxRetries = job.opts.attempts || this.MAX_RETRY_ATTEMPTS;

    this.logger.error(
      `Email job ${job.id} failed for notification ${notificationId} (Attempt ${job.attemptsMade}/${maxRetries})`,
      error.stack,
    );

    // Emit job failed event
    this.eventEmitter.emit('email.job.failed', {
      jobId: job.id,
      notificationId,
      deliveryId,
      recipientEmail: this.maskEmail(recipientEmail),
      error: error.message,
      attemptsMade: job.attemptsMade,
      maxRetries,
      failedAt: new Date(),
    });

    // If all retries exhausted, mark as permanently failed
    if (job.attemptsMade >= maxRetries) {
      this.logger.error(
        `Email notification ${notificationId} permanently failed after ${job.attemptsMade} attempts`,
      );

      if (deliveryId) {
        await this.markDeliveryPermanentlyFailed(
          deliveryId,
          error.message,
          job.attemptsMade,
        );
      }

      // Emit permanent failure event
      this.eventEmitter.emit('email.notification.permanent.failure', {
        notificationId,
        deliveryId,
        recipientEmail: this.maskEmail(recipientEmail),
        error: error.message,
        totalAttempts: job.attemptsMade,
        failedAt: new Date(),
      });
    } else {
      // Retry will be attempted
      const nextAttempt = job.attemptsMade + 1;
      const delay = this.calculateBackoffDelay(job.attemptsMade);

      this.logger.log(
        `Email notification ${notificationId} will be retried (Attempt ${nextAttempt}/${maxRetries}) in ${delay}ms`,
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
      this.eventEmitter.emit('email.notification.retry.scheduled', {
        notificationId,
        deliveryId,
        recipientEmail: this.maskEmail(recipientEmail),
        nextAttempt,
        maxRetries,
        delay,
        scheduledAt: new Date(),
      });
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
   * Generate HTML email template
   */
  private generateEmailHtml(
    title: string,
    body: string,
    actionUrl?: string,
    data?: any,
  ): string {
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f4f4f4;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      background: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #ffffff;
      padding: 30px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .content {
      padding: 30px;
    }
    .content h2 {
      color: #333;
      margin-top: 0;
    }
    .content p {
      margin: 15px 0;
    }
    .button {
      display: inline-block;
      padding: 12px 30px;
      margin: 20px 0;
      background: #667eea;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 5px;
      font-weight: 600;
    }
    .button:hover {
      background: #5568d3;
    }
    .footer {
      background: #f8f9fa;
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: #6c757d;
      border-top: 1px solid #e9ecef;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${data?.companyName || 'Ankaa'}</h1>
    </div>
    <div class="content">
      <h2>${title}</h2>
      <p>${body.replace(/\n/g, '<br>')}</p>
      ${actionUrl ? `<a href="${actionUrl}" class="button">Ver detalhes</a>` : ''}
    </div>
    <div class="footer">
      <p>Esta é uma notificação automática. Por favor, não responda a este e-mail.</p>
      ${data?.supportEmail ? `<p>Dúvidas? Entre em contato: <a href="mailto:${data.supportEmail}">${data.supportEmail}</a></p>` : ''}
      <p>&copy; ${new Date().getFullYear()} ${data?.companyName || 'Ankaa'}. Todos os direitos reservados.</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Check rate limiting to avoid overwhelming email service
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove timestamps older than 1 minute
    this.emailSentTimestamps = this.emailSentTimestamps.filter(
      timestamp => timestamp > oneMinuteAgo,
    );

    // Check if rate limit exceeded
    if (this.emailSentTimestamps.length >= this.RATE_LIMIT_PER_MINUTE) {
      const oldestTimestamp = this.emailSentTimestamps[0];
      const waitTime = oldestTimestamp + 60000 - now;

      this.logger.warn(
        `Email rate limit exceeded. Waiting ${Math.ceil(waitTime / 1000)} seconds...`,
      );

      // Wait before proceeding
      await this.delay(waitTime);

      // Re-check after waiting
      return this.checkRateLimit();
    }

    // Add current timestamp
    this.emailSentTimestamps.push(now);
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attemptsMade: number): number {
    return this.RETRY_BACKOFF_BASE * Math.pow(2, attemptsMade);
  }

  /**
   * Mask email for privacy in logs
   */
  private maskEmail(email?: string): string {
    if (!email) return 'N/A';
    const [username, domain] = email.split('@');
    if (!domain) return email;
    const maskedUsername =
      username.length > 2
        ? username[0] + '*'.repeat(username.length - 2) + username[username.length - 1]
        : username;
    return `${maskedUsername}@${domain}`;
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
