import { Transporter } from 'nodemailer';
import { MailerRepository, MailerResult } from './mailer.repository';
import * as nodemailer from 'nodemailer';
import { Logger } from '@nestjs/common';

/**
 * SMTP Configuration interface
 */
export interface SMTPConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: {
    email: string;
    name: string;
  };
}

/**
 * Nodemailer Repository Implementation
 * Handles email sending via SMTP with configurable settings
 */
export class NodemailRepository implements MailerRepository {
  private readonly logger = new Logger(NodemailRepository.name);
  private readonly transporter: Transporter;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(config?: Partial<SMTPConfig>) {
    // Load configuration from environment variables with fallbacks
    const smtpConfig = this.loadSMTPConfig(config);

    // Create transporter with configuration
    this.transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.auth.user,
        pass: smtpConfig.auth.pass,
      },
      // Additional recommended settings
      pool: true, // Use pooled connections
      maxConnections: 5, // Max concurrent connections
      maxMessages: 100, // Max messages per connection
      rateDelta: 1000, // Rate limiting: time window in ms
      rateLimit: 5, // Rate limiting: max messages per time window
    });

    this.fromEmail = smtpConfig.from.email;
    this.fromName = smtpConfig.from.name;

    // Log configuration (without sensitive data)
    this.logger.log(
      `SMTP configured: ${smtpConfig.host}:${smtpConfig.port} (secure: ${smtpConfig.secure})`,
    );

    // Verify transporter connection
    this.verifyConnection();
  }

  /**
   * Load SMTP configuration from environment variables
   * @param config - Optional partial configuration to override defaults
   * @returns Complete SMTP configuration
   */
  private loadSMTPConfig(config?: Partial<SMTPConfig>): SMTPConfig {
    // Default configuration
    const defaultConfig: SMTPConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || process.env.EMAIL_USER || '',
        pass: process.env.SMTP_PASSWORD || process.env.EMAIL_PASS || '',
      },
      from: {
        email: process.env.SMTP_FROM_EMAIL || process.env.EMAIL_USER || 'noreply@example.com',
        name: process.env.SMTP_FROM_NAME || 'Ankaa System',
      },
    };

    // Merge with provided config
    return {
      ...defaultConfig,
      ...config,
      auth: {
        ...defaultConfig.auth,
        ...(config?.auth || {}),
      },
      from: {
        ...defaultConfig.from,
        ...(config?.from || {}),
      },
    };
  }

  /**
   * Verify SMTP connection
   * @returns Promise that resolves if connection is successful
   */
  private async verifyConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified successfully');
    } catch (error) {
      this.logger.warn(`SMTP connection verification failed: ${error.message}`);
      // Don't throw - allow the service to start even if SMTP is not configured
      // Errors will be caught when actually sending emails
    }
  }

  /**
   * Send email via SMTP
   * @param to - Recipient email address
   * @param subject - Email subject
   * @param html - HTML content
   * @returns Promise with mail result including message ID
   */
  async sendMail(to: string, subject: string, html: string): Promise<MailerResult> {
    const mailOptions = {
      from: `"${this.fromName}" <${this.fromEmail}>`,
      to,
      subject,
      html,
      // Generate plain text version automatically
      text: this.stripHtml(html),
    };

    try {
      const result = await this.transporter.sendMail(mailOptions);

      this.logger.log(`Email sent successfully to ${to}, messageId: ${result.messageId}`);

      return {
        messageId: result.messageId,
      };
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${error.message}`, error.stack);

      if (process.env.NODE_ENV !== 'production') {
        console.error('Email sending error details:', {
          to,
          subject,
          error: error.message,
          stack: error.stack,
        });
      }

      throw error;
    }
  }

  /**
   * Simple HTML to plain text converter
   * @param html - HTML content
   * @returns Plain text version
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  /**
   * Close transporter connection pool
   * Should be called on application shutdown
   */
  async close(): Promise<void> {
    this.transporter.close();
    this.logger.log('SMTP connection pool closed');
  }

  /**
   * Get transporter instance for advanced operations
   * @returns Nodemailer transporter
   */
  getTransporter(): Transporter {
    return this.transporter;
  }
}
