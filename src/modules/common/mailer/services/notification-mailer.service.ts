import { Injectable, Logger } from '@nestjs/common';
import { MailerService, EmailDeliveryResult, BulkEmailDeliveryResult } from './mailer.service';
import {
  EmailTemplateService,
  NotificationTemplateData,
  BaseTemplateData,
} from './email-template.service';

/**
 * Interface for notification email request
 */
export interface NotificationEmailRequest {
  to: string;
  title: string;
  body: string;
  actionUrl?: string;
  actionText?: string;
  importance?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  metadata?: Record<string, any>;
  userName?: string;
}

/**
 * Interface for bulk notification email request
 */
export interface BulkNotificationEmailRequest {
  recipients: Array<{
    email: string;
    title: string;
    body: string;
    actionUrl?: string;
    actionText?: string;
    importance?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    metadata?: Record<string, any>;
    userName?: string;
  }>;
}

/**
 * Notification Mailer Service
 * High-level service that integrates MailerService and EmailTemplateService
 * Provides easy-to-use methods for sending notification emails
 */
@Injectable()
export class NotificationMailerService {
  private readonly logger = new Logger(NotificationMailerService.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly emailTemplateService: EmailTemplateService,
  ) {}

  /**
   * Send a notification email with automatic template rendering
   * @param request - Notification email request
   * @returns Promise<EmailDeliveryResult>
   */
  async sendNotificationEmail(request: NotificationEmailRequest): Promise<EmailDeliveryResult> {
    try {
      this.logger.log(`Sending notification email to ${request.to}: ${request.title}`);

      // Create template data
      const baseData = this.emailTemplateService.createBaseEmailData(request.userName);
      const templateData: NotificationTemplateData = {
        ...baseData,
        title: request.title,
        body: request.body,
        actionUrl: request.actionUrl,
        actionText: request.actionText,
        importance: request.importance,
        metadata: request.metadata,
        timestamp: new Date().toLocaleString('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
        }),
      };

      // Validate template data
      this.emailTemplateService.validateTemplateData(templateData);

      // Render template
      const rendered = this.emailTemplateService.renderNotificationTemplate(templateData);

      // Send email using the HTML template
      const success = await this.mailerService.sendNotificationEmail(request.to, rendered.html, {
        subject: rendered.subject,
        title: request.title,
      });

      return {
        success,
        deliveryTimestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to send notification email to ${request.to}: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        error: error.message,
        errorCode: 'TEMPLATE_RENDER_ERROR',
        deliveryTimestamp: new Date(),
      };
    }
  }

  /**
   * Send bulk notification emails with automatic template rendering and rate limiting
   * @param request - Bulk notification email request
   * @returns Promise<BulkEmailDeliveryResult>
   */
  async sendBulkNotificationEmails(
    request: BulkNotificationEmailRequest,
  ): Promise<BulkEmailDeliveryResult> {
    try {
      this.logger.log(
        `Sending bulk notification emails to ${request.recipients.length} recipients`,
      );

      // Prepare recipients with rendered templates
      const recipientsWithTemplates = request.recipients.map(recipient => {
        const baseData = this.emailTemplateService.createBaseEmailData(recipient.userName);
        const templateData: NotificationTemplateData = {
          ...baseData,
          title: recipient.title,
          body: recipient.body,
          actionUrl: recipient.actionUrl,
          actionText: recipient.actionText,
          importance: recipient.importance,
          metadata: recipient.metadata,
          timestamp: new Date().toLocaleString('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
          }),
        };

        // Validate template data
        try {
          this.emailTemplateService.validateTemplateData(templateData);
        } catch (error) {
          this.logger.error(`Invalid template data for ${recipient.email}: ${error.message}`);
          throw error;
        }

        // Render template
        const rendered = this.emailTemplateService.renderNotificationTemplate(templateData);

        return {
          email: recipient.email,
          data: {
            subject: rendered.subject,
            title: recipient.title,
            html: rendered.html,
          },
        };
      });

      // Send bulk emails with rate limiting
      // We need to pass a template, but since each recipient has their own rendered HTML,
      // we'll use a special approach where the template IS the data.html
      const results: BulkEmailDeliveryResult = {
        success: 0,
        failed: 0,
        totalProcessed: 0,
        results: [],
        errors: [],
      };

      // Process each recipient individually with rate limiting built-in
      for (const recipient of recipientsWithTemplates) {
        const success = await this.mailerService.sendNotificationEmail(
          recipient.email,
          recipient.data.html,
          recipient.data,
        );

        results.totalProcessed++;
        const deliveryResult: EmailDeliveryResult = {
          success,
          deliveryTimestamp: new Date(),
        };

        results.results.push({
          email: recipient.email,
          result: deliveryResult,
        });

        if (success) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push({
            email: recipient.email,
            error: 'Failed to send email',
            errorCode: 'SEND_FAILED',
          });
        }
      }

      this.logger.log(
        `Bulk notification emails completed. Success: ${results.success}, Failed: ${results.failed}`,
      );

      return results;
    } catch (error) {
      this.logger.error(`Failed to send bulk notification emails: ${error.message}`, error.stack);

      return {
        success: 0,
        failed: request.recipients.length,
        totalProcessed: request.recipients.length,
        results: [],
        errors: request.recipients.map(r => ({
          email: r.email,
          error: error.message,
          errorCode: 'BULK_SEND_ERROR',
        })),
      };
    }
  }

  /**
   * Send a simple notification email without template rendering
   * Useful when you already have the HTML content
   * @param to - Recipient email
   * @param subject - Email subject
   * @param html - HTML content
   * @returns Promise<boolean>
   */
  async sendSimpleEmail(to: string, subject: string, html: string): Promise<boolean> {
    try {
      this.logger.log(`Sending simple email to ${to}: ${subject}`);

      return await this.mailerService.sendNotificationEmail(to, html, { subject });
    } catch (error) {
      this.logger.error(`Failed to send simple email to ${to}: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Get delivery status for a specific message
   * @param messageId - Message ID
   * @returns Delivery result or undefined
   */
  getDeliveryStatus(messageId: string): EmailDeliveryResult | undefined {
    return this.mailerService.getDeliveryStatus(messageId);
  }

  /**
   * Get email service statistics
   * @returns Statistics object
   */
  getStatistics(): {
    totalTracked: number;
    successRate: number;
    failureRate: number;
    averageRetries: number;
  } {
    return this.mailerService.getStatistics();
  }

  /**
   * Clear delivery logs
   */
  clearDeliveryLogs(): void {
    this.mailerService.clearDeliveryLogs();
  }

  /**
   * Health check
   * @returns True if service is healthy
   */
  async healthCheck(): Promise<boolean> {
    return await this.mailerService.healthCheck();
  }

  /**
   * Update rate limiting configuration
   * @param config - Rate limit configuration
   */
  updateRateLimitConfig(config: {
    batchSize?: number;
    delayBetweenBatches?: number;
    maxConcurrent?: number;
  }): void {
    this.mailerService.updateRateLimitConfig(config);
  }

  /**
   * Get current rate limiting configuration
   * @returns Rate limit configuration
   */
  getRateLimitConfig(): {
    batchSize: number;
    delayBetweenBatches: number;
    maxConcurrent: number;
  } {
    return this.mailerService.getRateLimitConfig();
  }

  /**
   * Create base email data with environment defaults
   * @param userName - Optional user name
   * @returns Base template data
   */
  createBaseEmailData(userName?: string): BaseTemplateData {
    return this.emailTemplateService.createBaseEmailData(userName);
  }
}
