import { Injectable, Logger } from '@nestjs/common';
import { MailerRepository } from '../repositories/mailer.repository';
import {
  generateEmailVerificationCodeTemplate,
  generatePasswordResetCodeTemplate,
  generatePasswordChangedNotificationTemplate,
  generateAccountStatusChangeTemplate,
  generateWelcomeEmailTemplate,
} from '../../../../templates/email-templates';

export interface EmailDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
  retryCount?: number;
}

export interface BaseEmailData {
  companyName: string;
  supportEmail: string;
  supportPhone: string;
  supportUrl: string;
  userName?: string;
}

export interface EmailVerificationData extends BaseEmailData {
  verificationCode: string;
  expiryMinutes: number;
}

export interface PasswordResetData extends BaseEmailData {
  resetCode: string;
  expiryMinutes: number;
}

export interface PasswordChangedData extends BaseEmailData {
  loginUrl: string;
  changeTime: string;
}

export interface AccountStatusData extends BaseEmailData {
  loginUrl: string;
  newStatus: string;
  reason?: string;
  changeTime: string;
}

export interface WelcomeEmailData extends BaseEmailData {
  loginUrl: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second

  constructor(private readonly mailerRepository: MailerRepository) {}

  /**
   * Send email verification code with 6-digit code
   */
  async sendEmailVerificationCode(
    email: string,
    data: EmailVerificationData,
  ): Promise<EmailDeliveryResult> {
    const subject = `Código de Verificação - ${data.companyName}`;
    const html = generateEmailVerificationCodeTemplate(data);

    return this.sendEmailWithRetry(email, subject, html, 'EMAIL_VERIFICATION');
  }

  /**
   * Send password reset code with 6-digit code
   */
  async sendPasswordResetCode(
    email: string,
    data: PasswordResetData,
  ): Promise<EmailDeliveryResult> {
    const subject = `Código para Redefinir Senha - ${data.companyName}`;
    const html = generatePasswordResetCodeTemplate(data);

    return this.sendEmailWithRetry(email, subject, html, 'PASSWORD_RESET');
  }

  /**
   * Send password changed notification
   */
  async sendPasswordChangedNotification(
    email: string,
    data: PasswordChangedData,
  ): Promise<EmailDeliveryResult> {
    const subject = `Senha Alterada - ${data.companyName}`;
    const html = generatePasswordChangedNotificationTemplate(data);

    return this.sendEmailWithRetry(email, subject, html, 'PASSWORD_CHANGED');
  }

  /**
   * Send account status change notification
   */
  async sendAccountStatusNotification(
    email: string,
    data: AccountStatusData,
  ): Promise<EmailDeliveryResult> {
    const subject = `Status da Conta Alterado - ${data.companyName}`;
    const html = generateAccountStatusChangeTemplate(data);

    return this.sendEmailWithRetry(email, subject, html, 'ACCOUNT_STATUS');
  }

  /**
   * Send welcome email after account creation
   */
  async sendWelcomeEmail(email: string, data: WelcomeEmailData): Promise<EmailDeliveryResult> {
    const subject = `Bem-vindo ao ${data.companyName}`;
    const html = generateWelcomeEmailTemplate(data);

    return this.sendEmailWithRetry(email, subject, html, 'WELCOME');
  }

  /**
   * Generic method to send any email with retry logic
   */
  async sendEmailWithRetry(
    to: string,
    subject: string,
    html: string,
    emailType: string,
    retryCount = 0,
  ): Promise<EmailDeliveryResult> {
    try {
      // Validate email address
      if (!this.isValidEmail(to)) {
        return {
          success: false,
          error: 'Invalid email address format',
          retryCount,
        };
      }

      // Attempt to send email
      const result = await this.mailerRepository.sendMail(to, subject, html);

      this.logger.log(`Successfully sent ${emailType} email to ${to}`);

      return {
        success: true,
        messageId: result?.messageId || 'unknown',
        retryCount,
      };
    } catch (error) {
      this.logger.error(`Failed to send ${emailType} email to ${to}: ${error.message}`);

      // Check if we should retry
      if (retryCount < this.MAX_RETRIES && this.shouldRetry(error)) {
        this.logger.warn(
          `Retrying ${emailType} email to ${to} (attempt ${retryCount + 1}/${this.MAX_RETRIES})`,
        );

        // Wait before retrying
        await this.delay(this.RETRY_DELAY * (retryCount + 1));

        return this.sendEmailWithRetry(to, subject, html, emailType, retryCount + 1);
      }

      // Max retries reached or non-retryable error
      return {
        success: false,
        error: error.message,
        retryCount,
      };
    }
  }

  /**
   * Check if the error is retryable
   */
  private shouldRetry(error: any): boolean {
    const retryableErrors = [
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNRESET',
      'ECONNREFUSED',
      'Network Error',
      'timeout',
    ];

    const errorMessage = error.message || error.toString();

    return retryableErrors.some(retryableError =>
      errorMessage.toLowerCase().includes(retryableError.toLowerCase()),
    );
  }

  /**
   * Validate email address format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Delay utility for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create base email data with environment defaults
   */
  createBaseEmailData(userName?: string): BaseEmailData {
    return {
      companyName: 'Ankaa',
      supportEmail: process.env.EMAIL_USER || 'suporte@ankaa.com',
      supportPhone: process.env.TWILIO_PHONE_NUMBER || '+55 11 99999-9999',
      supportUrl: `${process.env.API_URL || `http://localhost:${process.env.PORT || '3030'}`}/suporte`,
      userName,
    };
  }

  /**
   * Send bulk verification emails (for admin operations)
   */
  async sendBulkVerificationEmails(
    recipients: Array<{ email: string; userName: string; code: string }>,
    expiryMinutes: number = 10,
  ): Promise<Array<{ email: string; result: EmailDeliveryResult }>> {
    const results: Array<{ email: string; result: EmailDeliveryResult }> = [];

    for (const recipient of recipients) {
      const baseData = this.createBaseEmailData(recipient.userName);
      const emailData: EmailVerificationData = {
        ...baseData,
        verificationCode: recipient.code,
        expiryMinutes,
      };

      const result = await this.sendEmailVerificationCode(recipient.email, emailData);
      results.push({ email: recipient.email, result });

      // Small delay between bulk emails to avoid rate limiting
      await this.delay(100);
    }

    return results;
  }

  /**
   * Health check - test email service connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      // This would typically send a test email to a known address
      // For now, we'll just verify the mailer repository is available
      return this.mailerRepository !== null;
    } catch (error) {
      this.logger.error(`Email service health check failed: ${error.message}`);
      return false;
    }
  }
}
