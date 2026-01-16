import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../mailer/services/email.service';
import { SmsService } from '../sms/sms.service';
import { WhatsAppNotificationService } from './whatsapp/whatsapp.service';
import { PushService } from '../push/push.service';
import { NOTIFICATION_CHANNEL } from '../../../constants';

/**
 * Helper interface for parsed action URLs
 */
interface ParsedActionUrl {
  web: string;
  mobile?: string;
  universalLink?: string;
}

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

  // Base URL for web application, loaded from environment
  private readonly webAppUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly whatsappNotificationService: WhatsAppNotificationService,
    private readonly pushService: PushService,
    private readonly configService: ConfigService,
  ) {
    this.webAppUrl = this.configService.get<string>('WEB_APP_URL') || 'https://ankaadesign.com.br';
  }

  /**
   * Parse action URL which can be either:
   * 1. A JSON string with web, mobile, universalLink fields
   * 2. A relative path (legacy format)
   * 3. A full URL
   *
   * @param actionUrl - The action URL to parse
   * @returns Parsed URL with web and optionally mobile/universalLink
   */
  private parseActionUrl(actionUrl: string | undefined): ParsedActionUrl | null {
    if (!actionUrl) {
      return null;
    }

    // Try to parse as JSON first (new format from DeepLinkService)
    try {
      const parsed = JSON.parse(actionUrl);
      if (parsed && typeof parsed === 'object' && parsed.web) {
        return {
          web: parsed.web,
          mobile: parsed.mobile,
          universalLink: parsed.universalLink,
        };
      }
    } catch {
      // Not JSON, continue with other formats
    }

    // Check if it's already a full URL
    if (actionUrl.startsWith('http://') || actionUrl.startsWith('https://')) {
      return { web: actionUrl };
    }

    // It's a relative path - prepend base URL
    return { web: `${this.webAppUrl}${actionUrl}` };
  }

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
        companyName: process.env.COMPANY_NAME || 'Ankaa Design',
        supportEmail: process.env.SUPPORT_EMAIL || 'suporte@ankaadesign.com.br',
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
   * Process push notification via Firebase Cloud Messaging
   */
  @Process({
    name: 'send-push',
    concurrency: 10, // Process up to 10 push notifications simultaneously
  })
  async processPushNotification(
    job: Job<NotificationJobData>,
  ): Promise<NotificationDeliveryResult> {
    const startTime = Date.now();
    const { notificationId, recipientDeviceToken, userId, title, body, actionUrl, metadata } = job.data;

    this.logger.log(`Processing push notification ${notificationId} for user ${userId}`);

    try {
      await job.progress(20);

      // Parse action URL - for push notifications, we keep the full JSON if available
      // so the mobile app can extract the mobile URL
      const parsedUrl = this.parseActionUrl(actionUrl);

      // Prepare data payload for the push notification
      // Include the full actionUrl (which may be JSON) so mobile can parse it
      const dataPayload = {
        notificationId,
        actionUrl: actionUrl || '', // Keep original JSON for mobile to parse
        // Also include extracted URLs for convenience
        webUrl: parsedUrl?.web || '',
        mobileUrl: parsedUrl?.mobile || '',
        universalLink: parsedUrl?.universalLink || '',
        type: metadata?.type || 'notification',
        ...metadata,
      };

      await job.progress(40);

      let result;

      // If we have a specific device token, send to that device
      if (recipientDeviceToken) {
        this.logger.log(`Sending push to device token: ${recipientDeviceToken.substring(0, 10)}...`);
        result = await this.pushService.sendPushNotification(
          recipientDeviceToken,
          title,
          body,
          dataPayload,
        );
      }
      // Otherwise, send to all devices for the user
      else if (userId) {
        this.logger.log(`Sending push to all devices for user: ${userId}`);
        const multicastResult = await this.pushService.sendToUser(userId, title, body, dataPayload);
        result = {
          success: multicastResult.success > 0,
          error: multicastResult.failure > 0 ? `${multicastResult.failure} devices failed` : undefined,
        };
      } else {
        throw new Error('Either recipientDeviceToken or userId is required for push notifications');
      }

      await job.progress(80);

      const processingTime = Date.now() - startTime;

      if (!result.success) {
        throw new Error(result.error || 'Failed to send push notification');
      }

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
        messageId: result.messageId,
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
   * Generate HTML email template - matches company branding (green gradient)
   */
  private generateEmailHtml(title: string, body: string, actionUrl?: string, data?: any): string {
    const companyName = data?.companyName || process.env.COMPANY_NAME || 'Ankaa Design';
    const supportEmail = data?.supportEmail || process.env.SUPPORT_EMAIL || '';

    // Parse action URL and extract web URL for email
    const parsedUrl = this.parseActionUrl(actionUrl);
    const fullActionUrl = parsedUrl?.web;

    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title} - ${companyName}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
    }
    .email-wrapper {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .email-header {
      background: linear-gradient(135deg, #16802B 0%, #1a9933 100%);
      color: white;
      padding: 30px 20px;
      text-align: center;
    }
    .email-header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 600;
    }
    .email-body {
      padding: 40px 30px;
      background-color: #ffffff;
    }
    .email-body h2 {
      color: #16802B;
      margin: 0 0 20px 0;
      font-size: 22px;
    }
    .email-body p {
      margin: 0 0 15px 0;
      color: #555;
      line-height: 1.8;
    }
    .button-center {
      text-align: center;
      margin: 25px 0;
    }
    .button {
      display: inline-block;
      padding: 14px 32px;
      background: #16802B;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 16px;
    }
    .divider {
      height: 1px;
      background: linear-gradient(to right, transparent, #dee2e6, transparent);
      margin: 30px 0;
    }
    .email-footer {
      background-color: #f8f9fa;
      padding: 30px 20px;
      text-align: center;
      border-top: 1px solid #e9ecef;
    }
    .email-footer p {
      margin: 5px 0;
      font-size: 13px;
      color: #6c757d;
    }
    .email-footer a {
      color: #16802B;
      text-decoration: none;
    }
    @media only screen and (max-width: 600px) {
      .email-body {
        padding: 30px 20px;
      }
      .email-header h1 {
        font-size: 24px;
      }
      .button {
        padding: 12px 24px;
        font-size: 14px;
      }
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="email-header">
      <h1>${companyName}</h1>
    </div>
    <div class="email-body">
      <h2>${title}</h2>
      <p>${body.replace(/\n/g, '<br>')}</p>
      ${fullActionUrl ? `
      <div class="button-center">
        <a href="${fullActionUrl}" class="button">Ver detalhes</a>
      </div>
      ` : ''}
    </div>
    <div class="email-footer">
      <p>Esta é uma notificação automática.</p>
      ${supportEmail ? `<p>Dúvidas? Entre em contato: <a href="mailto:${supportEmail}">${supportEmail}</a></p>` : ''}
      <p>&copy; ${new Date().getFullYear()} ${companyName}. Todos os direitos reservados.</p>
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
