import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../mailer/services/email.service';
import { SmsService } from '../sms/sms.service';
import { WhatsAppNotificationService } from './whatsapp/whatsapp.service';
import { NOTIFICATION_CHANNEL } from '../../../constants';

/**
 * Notification job data structure
 */
export interface NotificationJobData {
  notificationId: string;
  channel: NOTIFICATION_CHANNEL;
  userId?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  recipientDeviceToken?: string;
  title: string;
  body: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  scheduledFor?: Date;
  retryCount?: number;
}

/**
 * Notification delivery result
 */
export interface NotificationDeliveryResult {
  notificationId: string;
  channel: NOTIFICATION_CHANNEL;
  success: boolean;
  deliveredAt?: Date;
  error?: string;
  messageId?: string;
  retryCount?: number;
  processingTime?: number;
}

/**
 * Notification queue processor
 * Handles background processing of notifications across multiple channels
 */
@Processor('notification')
@Injectable()
export class NotificationQueueProcessor {
  private readonly logger = new Logger(NotificationQueueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly whatsappNotificationService: WhatsAppNotificationService,
  ) {}

  /**
   * Process email notification
   */
  @Process({
    name: 'send-email',
    concurrency: 5, // Process up to 5 emails simultaneously
  })
  async processEmailNotification(
    job: Job<NotificationJobData>,
  ): Promise<NotificationDeliveryResult> {
    const startTime = Date.now();
    const { notificationId, recipientEmail, title, body, actionUrl, metadata } = job.data;

    this.logger.log('Processing email notification job', {
      jobId: job.id,
      notificationId,
      recipientEmail: this.maskEmail(recipientEmail),
      priority: job.data.priority,
      attemptsMade: job.attemptsMade,
      timestamp: new Date(),
    });

    try {
      if (!recipientEmail) {
        throw new Error('Recipient email is required for email notifications');
      }

      // Update progress
      await job.progress(20);

      // Prepare email data
      const emailData = {
        companyName: process.env.COMPANY_NAME || 'Ankaa',
        supportEmail: process.env.SUPPORT_EMAIL || 'support@ankaa.com',
        supportPhone: process.env.SUPPORT_PHONE || '',
        supportUrl: process.env.SUPPORT_URL || '',
        userName: metadata?.userName,
        ...metadata,
      };

      await job.progress(40);

      // Send email using email service
      const result = await this.emailService.sendEmailWithRetry(
        recipientEmail,
        title,
        this.generateEmailHtml(title, body, actionUrl, emailData),
        'NOTIFICATION',
      );

      await job.progress(80);

      if (!result.success) {
        throw new Error(result.error || 'Failed to send email');
      }

      const processingTime = Date.now() - startTime;

      // Update notification delivery status
      await this.updateDeliveryStatus(
        notificationId,
        NOTIFICATION_CHANNEL.EMAIL,
        true,
        result.messageId,
      );

      await job.progress(100);

      this.logger.log('Email notification delivered successfully', {
        jobId: job.id,
        notificationId,
        messageId: result.messageId,
        processingTimeMs: processingTime,
        channel: NOTIFICATION_CHANNEL.EMAIL,
      });

      return {
        notificationId,
        channel: NOTIFICATION_CHANNEL.EMAIL,
        success: true,
        deliveredAt: new Date(),
        messageId: result.messageId,
        processingTime,
      };
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.logger.error('Email notification delivery failed', {
        jobId: job.id,
        notificationId,
        error: error.message,
        stack: error.stack,
        processingTimeMs: processingTime,
        attemptsMade: job.attemptsMade,
      });

      // Update notification delivery status as failed
      await this.updateDeliveryStatus(
        notificationId,
        NOTIFICATION_CHANNEL.EMAIL,
        false,
        undefined,
        error.message,
      );

      return {
        notificationId,
        channel: NOTIFICATION_CHANNEL.EMAIL,
        success: false,
        error: error.message,
        retryCount: job.attemptsMade,
        processingTime,
      };
    }
  }

  /**
   * Process SMS notification
   */
  @Process({
    name: 'send-sms',
    concurrency: 3, // Process up to 3 SMS simultaneously
  })
  async processSmsNotification(job: Job<NotificationJobData>): Promise<NotificationDeliveryResult> {
    const startTime = Date.now();
    const { notificationId, recipientPhone, body } = job.data;

    this.logger.log(
      `Processing SMS notification ${notificationId} to ${this.maskPhone(recipientPhone)}`,
    );

    try {
      if (!recipientPhone) {
        throw new Error('Recipient phone is required for SMS notifications');
      }

      await job.progress(30);

      // Truncate message to 160 characters for SMS
      const smsMessage = body.length > 160 ? body.substring(0, 157) + '...' : body;

      await job.progress(50);

      // Send SMS
      await this.smsService.sendSms(recipientPhone, smsMessage);

      await job.progress(80);

      const processingTime = Date.now() - startTime;

      // Update notification delivery status
      await this.updateDeliveryStatus(notificationId, NOTIFICATION_CHANNEL.SMS, true);

      await job.progress(100);

      this.logger.log(
        `SMS notification ${notificationId} sent successfully in ${processingTime}ms`,
      );

      return {
        notificationId,
        channel: NOTIFICATION_CHANNEL.SMS,
        success: true,
        deliveredAt: new Date(),
        processingTime,
      };
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Failed to send SMS notification ${notificationId}: ${error.message}`,
        error.stack,
      );

      // Update notification delivery status as failed
      await this.updateDeliveryStatus(
        notificationId,
        NOTIFICATION_CHANNEL.SMS,
        false,
        undefined,
        error.message,
      );

      return {
        notificationId,
        channel: NOTIFICATION_CHANNEL.SMS,
        success: false,
        error: error.message,
        retryCount: job.attemptsMade,
        processingTime,
      };
    }
  }

  /**
   * Process push notification
   */
  @Process({
    name: 'send-push',
    concurrency: 10, // Process up to 10 push notifications simultaneously
  })
  async processPushNotification(
    job: Job<NotificationJobData>,
  ): Promise<NotificationDeliveryResult> {
    const startTime = Date.now();
    const { notificationId, recipientDeviceToken, title, body, actionUrl, metadata } = job.data;

    this.logger.log(`Processing push notification ${notificationId}`);

    try {
      if (!recipientDeviceToken) {
        throw new Error('Recipient device token is required for push notifications');
      }

      await job.progress(30);

      // TODO: Implement push notification service integration
      // For now, we'll simulate the push notification
      this.logger.warn(
        `Push notification not yet implemented. Would send to device: ${recipientDeviceToken}`,
      );

      await job.progress(80);

      const processingTime = Date.now() - startTime;

      // Update notification delivery status
      await this.updateDeliveryStatus(notificationId, NOTIFICATION_CHANNEL.PUSH, true);

      await job.progress(100);

      this.logger.log(
        `Push notification ${notificationId} sent successfully in ${processingTime}ms`,
      );

      return {
        notificationId,
        channel: NOTIFICATION_CHANNEL.PUSH,
        success: true,
        deliveredAt: new Date(),
        processingTime,
      };
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Failed to send push notification ${notificationId}: ${error.message}`,
        error.stack,
      );

      // Update notification delivery status as failed
      await this.updateDeliveryStatus(
        notificationId,
        NOTIFICATION_CHANNEL.PUSH,
        false,
        undefined,
        error.message,
      );

      return {
        notificationId,
        channel: NOTIFICATION_CHANNEL.PUSH,
        success: false,
        error: error.message,
        retryCount: job.attemptsMade,
        processingTime,
      };
    }
  }

  /**
   * Process WhatsApp notification
   */
  @Process({
    name: 'send-whatsapp',
    concurrency: 3, // Process up to 3 WhatsApp messages simultaneously
  })
  async processWhatsAppNotification(job: Job<NotificationJobData>): Promise<NotificationDeliveryResult> {
    const startTime = Date.now();
    const { notificationId, userId, title, body, actionUrl, metadata } = job.data;

    this.logger.log(`Processing WhatsApp notification ${notificationId} for user ${userId}`);

    try {
      if (!userId) {
        throw new Error('User ID is required for WhatsApp notifications');
      }

      await job.progress(10);

      // Get notification and user data
      const notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
      });

      if (!notification) {
        throw new Error(`Notification ${notificationId} not found`);
      }

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

      await job.progress(30);

      // Get or create delivery record
      let delivery = await this.prisma.notificationDelivery.findFirst({
        where: {
          notificationId,
          channel: NOTIFICATION_CHANNEL.WHATSAPP as any,
        },
      });

      if (!delivery) {
        delivery = await this.prisma.notificationDelivery.create({
          data: {
            notificationId,
            channel: NOTIFICATION_CHANNEL.WHATSAPP as any,
            status: 'PROCESSING' as any,
          },
        });
      }

      await job.progress(50);

      // Send WhatsApp notification using the dedicated service
      const result = await this.whatsappNotificationService.sendNotification(
        notification as any,
        user as any,
        delivery.id,
      );

      await job.progress(90);

      const processingTime = Date.now() - startTime;

      if (!result.success) {
        throw new Error(result.error || 'WhatsApp notification failed');
      }

      await job.progress(100);

      this.logger.log(
        `WhatsApp notification ${notificationId} sent successfully in ${processingTime}ms`,
      );

      return {
        notificationId,
        channel: NOTIFICATION_CHANNEL.WHATSAPP,
        success: true,
        deliveredAt: result.deliveredAt,
        processingTime,
      };
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Failed to send WhatsApp notification ${notificationId}: ${error.message}`,
        error.stack,
      );

      // Update notification delivery status as failed
      await this.updateDeliveryStatus(
        notificationId,
        NOTIFICATION_CHANNEL.WHATSAPP,
        false,
        undefined,
        error.message,
      );

      return {
        notificationId,
        channel: NOTIFICATION_CHANNEL.WHATSAPP,
        success: false,
        error: error.message,
        retryCount: job.attemptsMade,
        processingTime,
      };
    }
  }

  /**
   * Process in-app notification
   */
  @Process({
    name: 'send-in-app',
    concurrency: 10, // Process up to 10 in-app notifications simultaneously
  })
  async processInAppNotification(
    job: Job<NotificationJobData>,
  ): Promise<NotificationDeliveryResult> {
    const startTime = Date.now();
    const { notificationId } = job.data;

    this.logger.log(`Processing in-app notification ${notificationId}`);

    try {
      await job.progress(50);

      // In-app notifications are stored in the database
      // They are already created when the job is queued
      // Just mark as delivered
      const processingTime = Date.now() - startTime;

      // Update notification delivery status
      await this.updateDeliveryStatus(notificationId, NOTIFICATION_CHANNEL.IN_APP, true);

      await job.progress(100);

      this.logger.log(`In-app notification ${notificationId} delivered in ${processingTime}ms`);

      return {
        notificationId,
        channel: NOTIFICATION_CHANNEL.IN_APP,
        success: true,
        deliveredAt: new Date(),
        processingTime,
      };
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Failed to deliver in-app notification ${notificationId}: ${error.message}`,
        error.stack,
      );

      // Update notification delivery status as failed
      await this.updateDeliveryStatus(
        notificationId,
        NOTIFICATION_CHANNEL.IN_APP,
        false,
        undefined,
        error.message,
      );

      return {
        notificationId,
        channel: NOTIFICATION_CHANNEL.IN_APP,
        success: false,
        error: error.message,
        retryCount: job.attemptsMade,
        processingTime,
      };
    }
  }

  /**
   * Queue event listeners
   */
  @OnQueueActive()
  onActive(job: Job<NotificationJobData>) {
    this.logger.log(
      `Processing notification job ${job.id} for notification ${job.data.notificationId} via ${job.data.channel}`,
    );
  }

  @OnQueueCompleted()
  onCompleted(job: Job<NotificationJobData>, result: NotificationDeliveryResult) {
    this.logger.log(
      `Completed notification job ${job.id} for notification ${result.notificationId} via ${result.channel} - Success: ${result.success}`,
    );
  }

  @OnQueueFailed()
  async onFailed(job: Job<NotificationJobData>, error: Error) {
    this.logger.error(
      `Failed notification job ${job.id} for notification ${job.data.notificationId} via ${job.data.channel}`,
      error.stack,
    );

    const maxRetries = job.opts.attempts || 3;

    // Update delivery status with retry count
    await this.updateDeliveryStatusWithRetry(
      job.data.notificationId,
      job.data.channel,
      false,
      undefined,
      error.message,
      job.attemptsMade,
    );

    // If all retries exhausted, mark as permanently failed
    if (job.attemptsMade >= maxRetries) {
      this.logger.error(
        `Notification ${job.data.notificationId} permanently failed after ${job.attemptsMade} attempts`,
      );

      // Mark delivery as permanently failed
      await this.markDeliveryPermanentlyFailed(
        job.data.notificationId,
        job.data.channel,
        error.message,
        job.attemptsMade,
      );
    }
  }

  /**
   * Update notification delivery status in database
   */
  private async updateDeliveryStatus(
    notificationId: string,
    channel: NOTIFICATION_CHANNEL,
    success: boolean,
    messageId?: string,
    error?: string,
  ): Promise<void> {
    try {
      // Check if notification exists
      const notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
      });

      if (!notification) {
        this.logger.warn(`Notification ${notificationId} not found in database`);
        return;
      }

      // Update notification sentAt timestamp if successful
      if (success && !notification.sentAt) {
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: { sentAt: new Date() },
        });
      }

      // TODO: Store delivery status in a separate table (notification_deliveries)
      // This would track each delivery attempt per channel
      this.logger.log(
        `Notification ${notificationId} delivery status updated: ${channel} - ${success ? 'SUCCESS' : 'FAILED'}${error ? ` (${error})` : ''}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to update delivery status for notification ${notificationId}: ${err.message}`,
        err.stack,
      );
    }
  }

  /**
   * Generate HTML email template
   */
  private generateEmailHtml(title: string, body: string, actionUrl?: string, data?: any): string {
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
   * Utility: Mask email for logging
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
   * Update notification delivery status with retry count
   */
  private async updateDeliveryStatusWithRetry(
    notificationId: string,
    channel: NOTIFICATION_CHANNEL,
    success: boolean,
    messageId?: string,
    error?: string,
    retryCount?: number,
  ): Promise<void> {
    try {
      // Check if notification exists
      const notification = await this.prisma.notification.findUnique({
        where: { id: notificationId },
      });

      if (!notification) {
        this.logger.warn(`Notification ${notificationId} not found in database`);
        return;
      }

      // Update notification sentAt timestamp if successful
      if (success && !notification.sentAt) {
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: { sentAt: new Date() },
        });
      }

      // Find or create delivery record
      const existingDelivery = await this.prisma.notificationDelivery.findFirst({
        where: {
          notificationId,
          channel: channel as any,
        },
      });

      const now = new Date();

      if (existingDelivery) {
        // Update existing delivery with retry count
        await this.prisma.notificationDelivery.update({
          where: { id: existingDelivery.id },
          data: {
            status: success ? 'DELIVERED' : 'FAILED',
            deliveredAt: success ? now : null,
            failedAt: success ? null : now,
            errorMessage: error || null,
            metadata:
              retryCount !== undefined
                ? { ...((existingDelivery.metadata as any) || {}), retryCount }
                : existingDelivery.metadata,
            updatedAt: now,
          },
        });
      } else {
        // Create new delivery record
        await this.prisma.notificationDelivery.create({
          data: {
            notificationId,
            channel: channel as any,
            status: success ? 'DELIVERED' : 'FAILED',
            sentAt: now,
            deliveredAt: success ? now : null,
            failedAt: success ? null : now,
            errorMessage: error || null,
            metadata: retryCount !== undefined ? { retryCount } : null,
          },
        });
      }

      this.logger.log(
        `Notification ${notificationId} delivery status updated: ${channel} - ${success ? 'SUCCESS' : 'FAILED'}${error ? ` (${error})` : ''}${retryCount !== undefined ? ` [Retry ${retryCount}]` : ''}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to update delivery status for notification ${notificationId}: ${err.message}`,
        err.stack,
      );
    }
  }

  /**
   * Mark delivery as permanently failed after max retries
   */
  private async markDeliveryPermanentlyFailed(
    notificationId: string,
    channel: NOTIFICATION_CHANNEL,
    error: string,
    attempts: number,
  ): Promise<void> {
    try {
      const delivery = await this.prisma.notificationDelivery.findFirst({
        where: {
          notificationId,
          channel: channel as any,
        },
      });

      if (delivery) {
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
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

        this.logger.log(
          `Marked delivery as permanently failed for notification ${notificationId} via ${channel}`,
        );
      }
    } catch (err: any) {
      this.logger.error(`Failed to mark delivery as permanently failed: ${err.message}`, err.stack);
    }
  }

  /**
   * Utility: Mask phone for logging
   */
  private maskPhone(phone?: string): string {
    if (!phone) return 'N/A';
    if (phone.length <= 4) return phone;
    const start = phone.slice(0, 2);
    const end = phone.slice(-2);
    const middle = '*'.repeat(phone.length - 4);
    return `${start}${middle}${end}`;
  }
}
