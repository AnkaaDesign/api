import { Injectable, Logger } from '@nestjs/common';
import { MailerRepository } from '../repositories/mailer.repository';

/**
 * Interface for email delivery result with tracking information
 */
export interface EmailDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
  retryCount?: number;
  deliveryTimestamp?: Date;
}

/**
 * Interface for bulk email delivery result
 */
export interface BulkEmailDeliveryResult {
  success: number;
  failed: number;
  totalProcessed: number;
  results: Array<{
    email: string;
    result: EmailDeliveryResult;
  }>;
  errors: Array<{
    email: string;
    error: string;
    errorCode?: string;
  }>;
}

/**
 * Interface for notification email data
 */
export interface NotificationEmailData {
  title: string;
  body: string;
  actionUrl?: string;
  actionText?: string;
  importance?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  metadata?: Record<string, any>;
}

/**
 * Configuration for rate limiting
 */
interface RateLimitConfig {
  batchSize: number;
  delayBetweenBatches: number; // in milliseconds
  maxConcurrent: number;
}

/**
 * Enhanced mailer service with notification system integration
 * Provides advanced email delivery with rate limiting, bulk sending, and delivery tracking
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  // Configuration constants
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second
  private readonly DEFAULT_BATCH_SIZE = 10;
  private readonly DEFAULT_BATCH_DELAY = 2000; // 2 seconds
  private readonly MAX_CONCURRENT = 5;

  // Rate limiting configuration
  private readonly rateLimitConfig: RateLimitConfig = {
    batchSize: this.DEFAULT_BATCH_SIZE,
    delayBetweenBatches: this.DEFAULT_BATCH_DELAY,
    maxConcurrent: this.MAX_CONCURRENT,
  };

  // Delivery tracking storage (in production, this should be in a database)
  private deliveryLog: Map<string, EmailDeliveryResult> = new Map();

  constructor(private readonly mailerRepository: MailerRepository) {}

  /**
   * Send a notification email using a template
   * @param to - Recipient email address
   * @param template - HTML template content
   * @param data - Template data
   * @returns Promise<boolean> - True if delivery was successful
   */
  async sendNotificationEmail(to: string, template: string, data: any): Promise<boolean> {
    try {
      // Validate email address
      if (!this.isValidEmail(to)) {
        this.logger.error(`Invalid email address: ${to}`);
        return false;
      }

      // Extract subject from data or use default
      const subject = data.subject || data.title || 'Nova Notificação';

      // Send email with retry logic
      const result = await this.sendEmailWithRetry(to, subject, template, 'NOTIFICATION', 0);

      // Track delivery
      if (result.messageId) {
        this.trackDelivery(result.messageId, result);
      }

      return result.success;
    } catch (error) {
      this.logger.error(
        `Failed to send notification email to ${to}: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Send bulk notification emails with rate limiting
   * @param recipients - Array of recipients with email and template data
   * @param template - HTML template content
   * @returns Promise with success and failure counts
   */
  async sendBulkNotificationEmails(
    recipients: Array<{ email: string; data: any }>,
    template: string,
  ): Promise<BulkEmailDeliveryResult> {
    this.logger.log(`Starting bulk email send to ${recipients.length} recipients`);

    const result: BulkEmailDeliveryResult = {
      success: 0,
      failed: 0,
      totalProcessed: 0,
      results: [],
      errors: [],
    };

    // Process in batches with rate limiting
    const batches = this.createBatches(recipients, this.rateLimitConfig.batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      this.logger.log(
        `Processing batch ${i + 1}/${batches.length} with ${batch.length} recipients`,
      );

      // Process batch concurrently with limit
      const batchResults = await this.processBatch(batch, template);

      // Aggregate results
      for (const batchResult of batchResults) {
        result.results.push(batchResult);
        result.totalProcessed++;

        if (batchResult.result.success) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push({
            email: batchResult.email,
            error: batchResult.result.error || 'Unknown error',
            errorCode: batchResult.result.errorCode,
          });
        }
      }

      // Add delay between batches (except for the last batch)
      if (i < batches.length - 1) {
        this.logger.log(`Waiting ${this.rateLimitConfig.delayBetweenBatches}ms before next batch`);
        await this.delay(this.rateLimitConfig.delayBetweenBatches);
      }
    }

    this.logger.log(
      `Bulk email send completed. Success: ${result.success}, Failed: ${result.failed}`,
    );

    return result;
  }

  /**
   * Process a batch of emails concurrently with rate limiting
   * @param batch - Array of recipients for this batch
   * @param template - HTML template content
   * @returns Promise with array of delivery results
   */
  private async processBatch(
    batch: Array<{ email: string; data: any }>,
    template: string,
  ): Promise<Array<{ email: string; result: EmailDeliveryResult }>> {
    // Process batch items with concurrent limit
    const results: Array<{ email: string; result: EmailDeliveryResult }> = [];

    // Split batch into concurrent chunks
    const chunks = this.createBatches(batch, this.rateLimitConfig.maxConcurrent);

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(async recipient => {
        const subject = recipient.data.subject || recipient.data.title || 'Nova Notificação';

        const result = await this.sendEmailWithRetry(
          recipient.email,
          subject,
          template,
          'BULK_NOTIFICATION',
          0,
        );

        // Track delivery
        if (result.messageId) {
          this.trackDelivery(result.messageId, result);
        }

        return {
          email: recipient.email,
          result,
        };
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Send email with retry logic and SMTP error handling
   * @param to - Recipient email address
   * @param subject - Email subject
   * @param html - HTML content
   * @param emailType - Type of email for logging
   * @param retryCount - Current retry attempt
   * @returns Promise with delivery result
   */
  private async sendEmailWithRetry(
    to: string,
    subject: string,
    html: string,
    emailType: string,
    retryCount = 0,
  ): Promise<EmailDeliveryResult> {
    const startTime = Date.now();

    try {
      // Validate email address
      if (!this.isValidEmail(to)) {
        return {
          success: false,
          error: 'Invalid email address format',
          errorCode: 'INVALID_EMAIL',
          retryCount,
          deliveryTimestamp: new Date(),
        };
      }

      // Attempt to send email
      const result = await this.mailerRepository.sendMail(to, subject, html);
      const endTime = Date.now();

      this.logger.log(`Successfully sent ${emailType} email to ${to} (${endTime - startTime}ms)`);

      return {
        success: true,
        messageId: result?.messageId || 'unknown',
        retryCount,
        deliveryTimestamp: new Date(),
      };
    } catch (error) {
      const endTime = Date.now();
      const errorCode = this.categorizeError(error);

      this.logger.error(
        `Failed to send ${emailType} email to ${to} (${endTime - startTime}ms): ${error.message}`,
      );

      // Check if we should retry
      if (retryCount < this.MAX_RETRIES && this.shouldRetry(error)) {
        this.logger.warn(
          `Retrying ${emailType} email to ${to} (attempt ${retryCount + 1}/${this.MAX_RETRIES})`,
        );

        // Exponential backoff
        const backoffDelay = this.RETRY_DELAY * Math.pow(2, retryCount);
        await this.delay(backoffDelay);

        return this.sendEmailWithRetry(to, subject, html, emailType, retryCount + 1);
      }

      // Max retries reached or non-retryable error
      return {
        success: false,
        error: this.sanitizeErrorMessage(error.message),
        errorCode,
        retryCount,
        deliveryTimestamp: new Date(),
      };
    }
  }

  /**
   * Categorize SMTP errors for better error handling
   * @param error - The error object
   * @returns Error code string
   */
  private categorizeError(error: any): string {
    const errorMessage = (error.message || error.toString()).toLowerCase();

    // Network errors
    if (errorMessage.includes('etimedout')) return 'TIMEOUT';
    if (errorMessage.includes('enotfound')) return 'DNS_ERROR';
    if (errorMessage.includes('econnreset')) return 'CONNECTION_RESET';
    if (errorMessage.includes('econnrefused')) return 'CONNECTION_REFUSED';
    if (errorMessage.includes('network error')) return 'NETWORK_ERROR';

    // SMTP errors
    if (errorMessage.includes('550')) return 'INVALID_RECIPIENT';
    if (errorMessage.includes('551')) return 'USER_NOT_LOCAL';
    if (errorMessage.includes('552')) return 'MAILBOX_FULL';
    if (errorMessage.includes('553')) return 'INVALID_ADDRESS';
    if (errorMessage.includes('554')) return 'TRANSACTION_FAILED';

    // Authentication errors
    if (errorMessage.includes('authentication')) return 'AUTH_FAILED';
    if (errorMessage.includes('auth')) return 'AUTH_ERROR';

    // Rate limiting
    if (errorMessage.includes('rate limit')) return 'RATE_LIMITED';
    if (errorMessage.includes('too many')) return 'TOO_MANY_REQUESTS';

    // Default
    return 'UNKNOWN_ERROR';
  }

  /**
   * Sanitize error messages to remove sensitive information
   * @param message - Original error message
   * @returns Sanitized error message
   */
  private sanitizeErrorMessage(message: string): string {
    // Remove potential sensitive information like passwords, tokens, etc.
    return message
      .replace(/password[=:]\s*\S+/gi, 'password=***')
      .replace(/token[=:]\s*\S+/gi, 'token=***')
      .replace(/key[=:]\s*\S+/gi, 'key=***')
      .replace(/auth[=:]\s*\S+/gi, 'auth=***');
  }

  /**
   * Check if the error is retryable
   * @param error - The error object
   * @returns True if the error should trigger a retry
   */
  private shouldRetry(error: any): boolean {
    const retryableErrors = [
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNRESET',
      'ECONNREFUSED',
      'ESOCKET',
      'ECONNECTION',
      'Network Error',
      'timeout',
      'rate limit',
      'too many',
    ];

    const errorMessage = error.message || error.toString();

    return retryableErrors.some(retryableError =>
      errorMessage.toLowerCase().includes(retryableError.toLowerCase()),
    );
  }

  /**
   * Validate email address format
   * @param email - Email address to validate
   * @returns True if email is valid
   */
  private isValidEmail(email: string): boolean {
    if (!email || typeof email !== 'string') return false;

    // More comprehensive email validation
    const emailRegex =
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return emailRegex.test(email);
  }

  /**
   * Create batches from an array
   * @param items - Array of items to batch
   * @param batchSize - Size of each batch
   * @returns Array of batches
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    return batches;
  }

  /**
   * Delay utility for retry logic and rate limiting
   * @param ms - Milliseconds to delay
   * @returns Promise that resolves after delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Track email delivery for monitoring and debugging
   * @param messageId - Unique message ID from email provider
   * @param result - Delivery result to track
   */
  private trackDelivery(messageId: string, result: EmailDeliveryResult): void {
    this.deliveryLog.set(messageId, result);

    this.logger.debug(`Tracking delivery for message ${messageId}: ${JSON.stringify(result)}`);

    // Clean up old entries (keep only last 1000)
    if (this.deliveryLog.size > 1000) {
      const firstKey = this.deliveryLog.keys().next().value;
      this.deliveryLog.delete(firstKey);
    }
  }

  /**
   * Get delivery status for a specific message
   * @param messageId - Message ID to lookup
   * @returns Delivery result or undefined if not found
   */
  getDeliveryStatus(messageId: string): EmailDeliveryResult | undefined {
    return this.deliveryLog.get(messageId);
  }

  /**
   * Get all delivery logs (for monitoring/debugging)
   * @returns Array of all tracked deliveries
   */
  getAllDeliveryLogs(): Array<{ messageId: string; result: EmailDeliveryResult }> {
    const logs: Array<{ messageId: string; result: EmailDeliveryResult }> = [];

    this.deliveryLog.forEach((result, messageId) => {
      logs.push({ messageId, result });
    });

    return logs;
  }

  /**
   * Clear delivery logs (for maintenance)
   */
  clearDeliveryLogs(): void {
    this.deliveryLog.clear();
    this.logger.log('Delivery logs cleared');
  }

  /**
   * Update rate limiting configuration
   * @param config - New rate limit configuration
   */
  updateRateLimitConfig(config: Partial<RateLimitConfig>): void {
    Object.assign(this.rateLimitConfig, config);
    this.logger.log(`Rate limit configuration updated: ${JSON.stringify(this.rateLimitConfig)}`);
  }

  /**
   * Get current rate limiting configuration
   * @returns Current rate limit config
   */
  getRateLimitConfig(): RateLimitConfig {
    return { ...this.rateLimitConfig };
  }

  /**
   * Health check - test email service connectivity
   * @returns True if service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      return this.mailerRepository !== null;
    } catch (error) {
      this.logger.error(`Email service health check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get service statistics
   * @returns Statistics about email delivery
   */
  getStatistics(): {
    totalTracked: number;
    successRate: number;
    failureRate: number;
    averageRetries: number;
  } {
    const logs = this.getAllDeliveryLogs();
    const total = logs.length;

    if (total === 0) {
      return {
        totalTracked: 0,
        successRate: 0,
        failureRate: 0,
        averageRetries: 0,
      };
    }

    const successful = logs.filter(log => log.result.success).length;
    const totalRetries = logs.reduce((sum, log) => sum + (log.result.retryCount || 0), 0);

    return {
      totalTracked: total,
      successRate: (successful / total) * 100,
      failureRate: ((total - successful) / total) * 100,
      averageRetries: totalRetries / total,
    };
  }
}
