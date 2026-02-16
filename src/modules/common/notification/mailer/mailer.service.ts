import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import { DeepLinkService, DeepLinkEntity } from '../deep-link.service';

/**
 * Email sending options
 */
export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  template?: string;
  templateData?: Record<string, any>;
  attachments?: EmailAttachment[];
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  headers?: Record<string, string>;
  priority?: 'high' | 'normal' | 'low';
}

/**
 * Email attachment structure
 */
export interface EmailAttachment {
  filename: string;
  content?: Buffer | string;
  path?: string;
  contentType?: string;
  cid?: string; // For embedded images
}

/**
 * Bulk email recipient
 */
export interface BulkEmailRecipient {
  email: string;
  templateData?: Record<string, any>;
  customSubject?: string;
}

/**
 * Email delivery result
 */
export interface EmailDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
  recipient?: string;
}

/**
 * Bulk email result
 */
export interface BulkEmailResult {
  totalSent: number;
  totalFailed: number;
  results: EmailDeliveryResult[];
  errors: Array<{ email: string; error: string }>;
}

/**
 * Email tracking data
 */
export interface EmailTrackingData {
  notificationId?: string;
  userId?: string;
  campaignId?: string;
  metadata?: Record<string, any>;
}

/**
 * Template types for notifications
 */
export enum NotificationEmailTemplate {
  TASK_CREATED = 'task-created',
  TASK_UPDATED = 'task-updated',
  ORDER_CREATED = 'order-created',
  STOCK_LOW = 'stock-low',
  GENERIC_NOTIFICATION = 'generic-notification',
}

/**
 * Bounce handling data
 */
export interface BounceData {
  email: string;
  bounceType: 'hard' | 'soft' | 'complaint';
  reason: string;
  timestamp: Date;
}

/**
 * Email validation result
 */
export interface EmailValidationResult {
  isValid: boolean;
  email?: string;
  error?: string;
}

/**
 * Comprehensive Email Notification Service using Nodemailer
 *
 * Features:
 * - SMTP email sending with Nodemailer
 * - Handlebars template rendering
 * - Bulk email sending with rate limiting
 * - Email tracking (opens and clicks)
 * - Deep link integration
 * - Bounce handling
 * - Email validation
 * - Unsubscribe link management
 * - HTML and plain text support
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter;
  private readonly templatesPath: string;
  private readonly trackingBaseUrl: string;
  private readonly unsubscribeBaseUrl: string;
  private readonly templateCache: Map<string, HandlebarsTemplateDelegate>;

  // Rate limiting configuration
  private readonly BATCH_SIZE = 50;
  private readonly BATCH_DELAY_MS = 2000; // 2 seconds between batches
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 1000;

  // Bounce tracking
  private readonly bounces: Map<string, BounceData> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly deepLinkService: DeepLinkService,
  ) {
    // Initialize SMTP transporter
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST') || 'smtp.gmail.com',
      port: this.configService.get<number>('SMTP_PORT') || 587,
      secure: this.configService.get<boolean>('SMTP_SECURE') || false,
      auth: {
        user: this.configService.get<string>('SMTP_USER') || process.env.EMAIL_USER,
        pass: this.configService.get<string>('SMTP_PASS') || process.env.EMAIL_PASS,
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 10,
    });

    // Set up paths
    const isProduction = process.env.NODE_ENV === 'production';
    const baseDir = isProduction
      ? path.join(__dirname, '..', '..', '..', '..')
      : path.join(__dirname, '..');

    this.templatesPath = path.join(baseDir, 'templates', 'email', 'notification');
    this.trackingBaseUrl =
      this.configService.get<string>('API_URL') ||
      `http://localhost:${process.env.PORT || '3030'}`;
    this.unsubscribeBaseUrl =
      this.configService.get<string>('WEB_APP_URL') ||
      this.configService.get<string>('CLIENT_HOST') ||
      'http://localhost:3000';
    this.templateCache = new Map();

    // Register Handlebars helpers
    this.registerHandlebarsHelpers();

    // Verify SMTP connection
    this.verifyConnection();

    this.logger.log('MailerService initialized');
    this.logger.log(`Templates path: ${this.templatesPath}`);
    this.logger.log(`Tracking URL: ${this.trackingBaseUrl}`);
  }

  /**
   * Verify SMTP connection
   */
  private async verifyConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified successfully');
    } catch (error) {
      this.logger.error('SMTP connection verification failed:', error);
      this.logger.warn('Email sending may not work properly');
    }
  }

  /**
   * Register Handlebars helpers for email templates
   */
  private registerHandlebarsHelpers(): void {
    Handlebars.registerHelper('formatDate', (date: Date | string) => {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    });

    Handlebars.registerHelper('formatDateTime', (date: Date | string) => {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    });

    Handlebars.registerHelper('eq', (a: any, b: any) => a === b);
    Handlebars.registerHelper('ne', (a: any, b: any) => a !== b);
    Handlebars.registerHelper('gt', (a: number, b: number) => a > b);
    Handlebars.registerHelper('lt', (a: number, b: number) => a < b);

    Handlebars.registerHelper('uppercase', (str: string) => str?.toUpperCase() || '');
    Handlebars.registerHelper('lowercase', (str: string) => str?.toLowerCase() || '');

    Handlebars.registerHelper('capitalize', (str: string) => {
      if (!str) return '';
      return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    });

    this.logger.log('Handlebars helpers registered');
  }

  /**
   * 1. Send an email notification
   *
   * @param options - Email sending options
   * @returns Promise with delivery result
   */
  async sendEmail(options: SendEmailOptions): Promise<EmailDeliveryResult> {
    try {
      // Validate recipient
      const validation = this.validateEmail(options.to as string);
      if (!validation.isValid) {
        throw new Error(validation.error || 'Invalid email address');
      }

      // Build email content
      let html = options.html;
      let text = options.text;

      // If template is specified, render it
      if (options.template) {
        const rendered = await this.buildEmailFromTemplate(
          options.template,
          options.templateData || {},
        );
        html = rendered.html;
        text = rendered.text;
      }

      // Ensure we have content
      if (!html && !text) {
        throw new Error('Email must have either HTML or text content');
      }

      // Generate plain text from HTML if not provided
      if (!text && html) {
        text = this.htmlToText(html);
      }

      // Prepare mail options
      const mailOptions = {
        from:
          options.from || this.configService.get<string>('EMAIL_FROM') || process.env.EMAIL_USER,
        to: options.to,
        subject: options.subject,
        html,
        text,
        replyTo: options.replyTo,
        cc: options.cc,
        bcc: options.bcc,
        attachments: options.attachments,
        headers: options.headers,
        priority: options.priority,
      };

      // Send email with retry logic
      const result = await this.sendWithRetry(mailOptions);

      this.logger.log(`Email sent successfully to ${options.to}`);

      return {
        success: true,
        messageId: result.messageId,
        recipient: Array.isArray(options.to) ? options.to[0] : options.to,
      };
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`, error.stack);

      return {
        success: false,
        error: error.message,
        errorCode: this.categorizeError(error),
        recipient: Array.isArray(options.to) ? options.to[0] : options.to,
      };
    }
  }

  /**
   * 2. Send bulk emails to multiple recipients
   *
   * @param recipients - Array of recipients with email and template data
   * @param subject - Email subject (can be overridden per recipient)
   * @param template - Template name to use
   * @param baseTemplateData - Base template data (merged with recipient-specific data)
   * @returns Promise with bulk sending results
   */
  async sendBulkEmails(
    recipients: BulkEmailRecipient[],
    subject: string,
    template: string,
    baseTemplateData: Record<string, any> = {},
  ): Promise<BulkEmailResult> {
    this.logger.log(`Starting bulk email send to ${recipients.length} recipients`);

    const result: BulkEmailResult = {
      totalSent: 0,
      totalFailed: 0,
      results: [],
      errors: [],
    };

    // Process in batches to avoid rate limiting
    const batches = this.createBatches(recipients, this.BATCH_SIZE);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      this.logger.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} recipients)`);

      // Process batch concurrently
      const batchPromises = batch.map(async recipient => {
        const templateData = {
          ...baseTemplateData,
          ...recipient.templateData,
        };

        const emailResult = await this.sendEmail({
          to: recipient.email,
          subject: recipient.customSubject || subject,
          template,
          templateData,
        });

        return emailResult;
      });

      const batchResults = await Promise.all(batchPromises);

      // Aggregate results
      for (const emailResult of batchResults) {
        result.results.push(emailResult);

        if (emailResult.success) {
          result.totalSent++;
        } else {
          result.totalFailed++;
          result.errors.push({
            email: emailResult.recipient || 'unknown',
            error: emailResult.error || 'Unknown error',
          });
        }
      }

      // Delay between batches (except last batch)
      if (i < batches.length - 1) {
        await this.delay(this.BATCH_DELAY_MS);
      }
    }

    this.logger.log(`Bulk email completed: ${result.totalSent} sent, ${result.totalFailed} failed`);

    return result;
  }

  /**
   * 3. Build email from Handlebars template
   *
   * @param templateName - Name of the template (e.g., 'task-created')
   * @param data - Data to pass to the template
   * @returns Promise with rendered HTML and text
   */
  async buildEmailFromTemplate(
    templateName: string,
    data: Record<string, any>,
  ): Promise<{ html: string; text: string }> {
    try {
      // Load and compile template
      const template = await this.loadTemplate(templateName);

      // Prepare template data with defaults
      const templateData = {
        companyName: this.configService.get<string>('COMPANY_NAME') || 'Sua Empresa',
        companyLogo: this.configService.get<string>('COMPANY_LOGO_URL') || '',
        currentYear: new Date().getFullYear(),
        supportEmail: this.configService.get<string>('SUPPORT_EMAIL') || 'suporte@empresa.com',
        ...data,
      };

      // Render template
      const html = template(templateData);
      const text = this.htmlToText(html);

      return { html, text };
    } catch (error) {
      this.logger.error(`Failed to build email from template ${templateName}:`, error);
      throw error;
    }
  }

  /**
   * 4. Attach deep link to email
   *
   * @param html - HTML content
   * @param entityType - Type of entity to link to
   * @param entityId - ID of the entity
   * @param linkText - Text for the link button/anchor
   * @param queryParams - Additional query parameters
   * @returns HTML with deep link attached
   */
  attachDeepLink(
    html: string,
    entityType: DeepLinkEntity,
    entityId: string,
    linkText: string = 'Ver Detalhes',
    queryParams?: Record<string, string>,
  ): string {
    try {
      // Generate deep links for both platforms
      const links = this.deepLinkService.generateBothLinks(entityType, entityId, queryParams);

      // Create button HTML with both web and mobile links
      const buttonHtml = `
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
          <tr>
            <td align="center" bgcolor="#007bff" style="border-radius: 4px;">
              <a href="${links.web}" target="_blank" style="display: inline-block; padding: 12px 24px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 16px; color: #ffffff; text-decoration: none; border-radius: 4px;">
                ${linkText}
              </a>
            </td>
          </tr>
        </table>
        <p style="font-size: 12px; color: #666; margin-top: 10px;">
          Ou acesse diretamente: <a href="${links.web}" style="color: #007bff;">${links.web}</a>
        </p>
      `;

      // Insert button before closing body tag
      return html.replace('</body>', `${buttonHtml}</body>`);
    } catch (error) {
      this.logger.error('Failed to attach deep link:', error);
      return html; // Return original HTML if deep link fails
    }
  }

  /**
   * 5. Track email opened using tracking pixel
   *
   * @param html - HTML content
   * @param trackingData - Data for tracking (notificationId, userId, etc.)
   * @returns HTML with tracking pixel inserted
   */
  trackEmailOpened(html: string, trackingData: EmailTrackingData): string {
    try {
      // Create tracking token (encode tracking data)
      const trackingToken = Buffer.from(JSON.stringify(trackingData)).toString('base64url');

      // Create tracking pixel URL
      const pixelUrl = `${this.trackingBaseUrl}/api/notifications/track/email-open/${trackingToken}`;

      // Create tracking pixel (1x1 transparent image)
      const trackingPixel = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;border:0;outline:0;" />`;

      // Insert pixel before closing body tag
      return html.replace('</body>', `${trackingPixel}</body>`);
    } catch (error) {
      this.logger.error('Failed to add email tracking pixel:', error);
      return html; // Return original HTML if tracking fails
    }
  }

  /**
   * 6. Track link clicks in email
   *
   * @param html - HTML content
   * @param trackingData - Data for tracking
   * @returns HTML with tracked links
   */
  trackLinkClicked(html: string, trackingData: EmailTrackingData): string {
    try {
      // Find all links in the HTML
      const linkRegex = /<a\s+([^>]*href=["']([^"']+)["'][^>]*)>/gi;

      // Replace each link with a tracked version
      const trackedHtml = html.replace(linkRegex, (match, attributes, url) => {
        // Skip tracking pixel and unsubscribe links
        if (
          url.includes('/track/email-open/') ||
          url.includes('/unsubscribe/') ||
          url.startsWith('mailto:')
        ) {
          return match;
        }

        // Create tracking token
        const linkTrackingData = {
          ...trackingData,
          targetUrl: url,
        };
        const trackingToken = Buffer.from(JSON.stringify(linkTrackingData)).toString('base64url');

        // Create tracked URL
        const trackedUrl = `${this.trackingBaseUrl}/api/notifications/track/email-click/${trackingToken}`;

        // Replace original URL with tracked URL
        return `<a ${attributes.replace(url, trackedUrl)}>`;
      });

      return trackedHtml;
    } catch (error) {
      this.logger.error('Failed to track email links:', error);
      return html; // Return original HTML if tracking fails
    }
  }

  /**
   * 7. Handle bounced emails
   *
   * @param bounceData - Bounce information
   */
  async handleBounces(bounceData: BounceData): Promise<void> {
    try {
      this.logger.warn(`Email bounce detected for ${bounceData.email}:`, bounceData);

      // Store bounce data
      this.bounces.set(bounceData.email, bounceData);

      // For hard bounces, you might want to:
      // 1. Mark email as invalid in database
      // 2. Disable email notifications for this user
      // 3. Send alert to admin
      if (bounceData.bounceType === 'hard') {
        this.logger.error(
          `Hard bounce detected for ${bounceData.email}. Consider disabling email notifications.`,
        );

        // TODO: Implement database update to mark email as invalid
        // await this.prisma.user.update({
        //   where: { email: bounceData.email },
        //   data: { emailValid: false, emailBounceReason: bounceData.reason }
        // });
      }

      // For soft bounces, implement retry logic
      if (bounceData.bounceType === 'soft') {
        this.logger.warn(
          `Soft bounce for ${bounceData.email}. Email may be temporarily unavailable.`,
        );
      }

      // For complaints (spam reports), immediately stop sending
      if (bounceData.bounceType === 'complaint') {
        this.logger.error(
          `Spam complaint received for ${bounceData.email}. Unsubscribing immediately.`,
        );

        // TODO: Implement automatic unsubscribe
        // await this.unsubscribeUser(bounceData.email);
      }

      // Clean up old bounce data (keep last 1000)
      if (this.bounces.size > 1000) {
        const firstKey = this.bounces.keys().next().value;
        this.bounces.delete(firstKey);
      }
    } catch (error) {
      this.logger.error('Failed to handle email bounce:', error);
    }
  }

  /**
   * 8. Validate email address
   *
   * @param email - Email address to validate
   * @returns Validation result
   */
  validateEmail(email: string | string[]): EmailValidationResult {
    // Handle array of emails
    if (Array.isArray(email)) {
      for (const e of email) {
        const result = this.validateEmail(e);
        if (!result.isValid) {
          return result;
        }
      }
      return { isValid: true };
    }

    // Check if email is provided
    if (!email || typeof email !== 'string') {
      return {
        isValid: false,
        error: 'Email is required',
      };
    }

    // Trim whitespace
    email = email.trim();

    // Check length
    if (email.length === 0) {
      return {
        isValid: false,
        error: 'Email cannot be empty',
      };
    }

    if (email.length > 320) {
      return {
        isValid: false,
        error: 'Email is too long (max 320 characters)',
      };
    }

    // Check format using regex
    const emailRegex =
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    if (!emailRegex.test(email)) {
      return {
        isValid: false,
        error: 'Invalid email format',
      };
    }

    // Check if email has bounced before
    const bounce = this.bounces.get(email);
    if (bounce && bounce.bounceType === 'hard') {
      return {
        isValid: false,
        error: 'Email address is invalid (previous hard bounce)',
      };
    }

    // Additional validations
    const [localPart, domain] = email.split('@');

    // Check local part length
    if (localPart.length > 64) {
      return {
        isValid: false,
        error: 'Email local part is too long',
      };
    }

    // Check domain
    if (!domain || domain.length < 3) {
      return {
        isValid: false,
        error: 'Invalid email domain',
      };
    }

    // Check for consecutive dots
    if (email.includes('..')) {
      return {
        isValid: false,
        error: 'Email cannot contain consecutive dots',
      };
    }

    return {
      isValid: true,
      email,
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Load and compile a Handlebars template
   */
  private async loadTemplate(templateName: string): Promise<HandlebarsTemplateDelegate> {
    // Check cache first
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName)!;
    }

    try {
      // Build template path
      const templatePath = path.join(this.templatesPath, `${templateName}.hbs`);

      // Check if template exists
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Template not found: ${templatePath}`);
      }

      // Read template file
      const templateSource = fs.readFileSync(templatePath, 'utf-8');

      // Compile template
      const compiled = Handlebars.compile(templateSource);

      // Cache compiled template
      this.templateCache.set(templateName, compiled);

      return compiled;
    } catch (error) {
      this.logger.error(`Failed to load template ${templateName}:`, error);
      throw error;
    }
  }

  /**
   * Send email with retry logic
   */
  private async sendWithRetry(mailOptions: any, retryCount: number = 0): Promise<any> {
    try {
      const result = await this.transporter.sendMail(mailOptions);
      return result;
    } catch (error) {
      // Check if we should retry
      if (retryCount < this.MAX_RETRIES && this.shouldRetry(error)) {
        this.logger.warn(`Email send failed, retrying (${retryCount + 1}/${this.MAX_RETRIES})...`);

        // Exponential backoff
        const delay = this.RETRY_DELAY_MS * Math.pow(2, retryCount);
        await this.delay(delay);

        return this.sendWithRetry(mailOptions, retryCount + 1);
      }

      // Max retries reached or non-retryable error
      throw error;
    }
  }

  /**
   * Check if error is retryable
   */
  private shouldRetry(error: any): boolean {
    const retryableErrors = [
      'ETIMEDOUT',
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'ESOCKET',
      'timeout',
      'network error',
    ];

    const errorMessage = (error.message || error.toString()).toLowerCase();

    return retryableErrors.some(retryableError =>
      errorMessage.includes(retryableError.toLowerCase()),
    );
  }

  /**
   * Categorize error for better error handling
   */
  private categorizeError(error: any): string {
    const errorMessage = (error.message || error.toString()).toLowerCase();

    if (errorMessage.includes('invalid recipient')) return 'INVALID_RECIPIENT';
    if (errorMessage.includes('mailbox full')) return 'MAILBOX_FULL';
    if (errorMessage.includes('timeout')) return 'TIMEOUT';
    if (errorMessage.includes('connection')) return 'CONNECTION_ERROR';
    if (errorMessage.includes('authentication')) return 'AUTH_ERROR';
    if (errorMessage.includes('rate limit')) return 'RATE_LIMIT';

    return 'UNKNOWN_ERROR';
  }

  /**
   * Convert HTML to plain text
   */
  private htmlToText(html: string): string {
    return html
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  }

  /**
   * Create batches from array
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Add unsubscribe link to email (for optional notifications)
   */
  addUnsubscribeLink(html: string, userId: string, notificationType?: string): string {
    try {
      // Create unsubscribe URL
      const unsubscribeUrl = `${this.unsubscribeBaseUrl}/notifications/unsubscribe?userId=${userId}&type=${notificationType || 'all'}`;

      // Create unsubscribe link HTML
      const unsubscribeHtml = `
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 12px; color: #666;">
          <p>
            Você está recebendo este email porque está inscrito para receber notificações.
          </p>
          <p>
            <a href="${unsubscribeUrl}" style="color: #666; text-decoration: underline;">
              Cancelar inscrição
            </a>
          </p>
        </div>
      `;

      // Insert before closing body tag
      return html.replace('</body>', `${unsubscribeHtml}</body>`);
    } catch (error) {
      this.logger.error('Failed to add unsubscribe link:', error);
      return html;
    }
  }

  /**
   * Get bounce statistics
   */
  getBounceStatistics(): {
    totalBounces: number;
    hardBounces: number;
    softBounces: number;
    complaints: number;
  } {
    const stats = {
      totalBounces: this.bounces.size,
      hardBounces: 0,
      softBounces: 0,
      complaints: 0,
    };

    this.bounces.forEach(bounce => {
      if (bounce.bounceType === 'hard') stats.hardBounces++;
      if (bounce.bounceType === 'soft') stats.softBounces++;
      if (bounce.bounceType === 'complaint') stats.complaints++;
    });

    return stats;
  }

  /**
   * Check if email has bounced
   */
  hasEmailBounced(email: string): boolean {
    return this.bounces.has(email);
  }

  /**
   * Get bounce data for email
   */
  getBounceData(email: string): BounceData | undefined {
    return this.bounces.get(email);
  }

  /**
   * Clear bounce data for email
   */
  clearBounceData(email: string): void {
    this.bounces.delete(email);
    this.logger.log(`Bounce data cleared for ${email}`);
  }

  /**
   * Health check for email service
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      this.logger.error('Email service health check failed:', error);
      return false;
    }
  }
}
