import { Injectable, Logger } from '@nestjs/common';

/**
 * Mock SMS Service for testing
 * Simulates SMS sending without actually sending messages
 */
@Injectable()
export class MockSmsService {
  private readonly logger = new Logger(MockSmsService.name);

  // Track sent SMS messages for verification
  public sentMessages: Array<{
    to: string;
    message: string;
    timestamp: Date;
    status: 'sent' | 'failed';
  }> = [];

  // Configuration for testing scenarios
  public shouldFail: boolean = false;
  public shouldDelay: boolean = false;
  public delayMs: number = 150;
  public failureRate: number = 0; // 0-1, percentage of requests that should fail

  /**
   * Mock send SMS method
   */
  async sendSms(to: string, message: string): Promise<void> {
    this.logger.log(`Mock sending SMS to ${to}: ${message.substring(0, 50)}...`);

    // Simulate delay if configured
    if (this.shouldDelay) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }

    // Simulate random failures based on failure rate
    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      this.sentMessages.push({
        to,
        message,
        timestamp: new Date(),
        status: 'failed',
      });
      throw new Error('Mock SMS delivery failed (random failure)');
    }

    // Simulate intentional failure if configured
    if (this.shouldFail) {
      this.sentMessages.push({
        to,
        message,
        timestamp: new Date(),
        status: 'failed',
      });
      throw new Error('Mock SMS delivery failed');
    }

    // Track sent SMS
    this.sentMessages.push({
      to,
      message,
      timestamp: new Date(),
      status: 'sent',
    });

    this.logger.log(`Mock SMS sent successfully to ${to}`);
  }

  /**
   * Send notification SMS
   */
  async sendNotificationSms(to: string, message: string): Promise<void> {
    // SMS messages are typically limited to 160 characters
    const truncatedMessage = message.length > 160
      ? message.substring(0, 157) + '...'
      : message;

    return this.sendSms(to, truncatedMessage);
  }

  /**
   * Send batch SMS messages
   */
  async sendBatchSms(
    messages: Array<{ to: string; message: string }>
  ): Promise<void[]> {
    return Promise.all(
      messages.map(msg => this.sendSms(msg.to, msg.message))
    );
  }

  /**
   * Reset mock state
   */
  reset(): void {
    this.sentMessages = [];
    this.shouldFail = false;
    this.shouldDelay = false;
    this.delayMs = 150;
    this.failureRate = 0;
  }

  /**
   * Get sent messages for a specific phone number
   */
  getSentMessagesFor(phone: string): typeof this.sentMessages {
    return this.sentMessages.filter(m => m.to === phone);
  }

  /**
   * Check if SMS was sent
   */
  wasSmsSent(to: string, messageContains?: string): boolean {
    return this.sentMessages.some(
      m =>
        m.to === to &&
        m.status === 'sent' &&
        (!messageContains || m.message.includes(messageContains))
    );
  }

  /**
   * Get count of sent messages
   */
  getSentCount(): number {
    return this.sentMessages.filter(m => m.status === 'sent').length;
  }

  /**
   * Get count of failed messages
   */
  getFailedCount(): number {
    return this.sentMessages.filter(m => m.status === 'failed').length;
  }

  /**
   * Configure failure behavior
   */
  configureFail(shouldFail: boolean = true): void {
    this.shouldFail = shouldFail;
  }

  /**
   * Configure delay behavior
   */
  configureDelay(delayMs: number): void {
    this.shouldDelay = true;
    this.delayMs = delayMs;
  }

  /**
   * Configure random failure rate
   */
  configureFailureRate(rate: number): void {
    this.failureRate = Math.max(0, Math.min(1, rate));
  }

  /**
   * Validate phone number format (mock validation)
   */
  isValidPhoneNumber(phone: string): boolean {
    // Simple validation for testing
    return /^\+?[1-9]\d{1,14}$/.test(phone);
  }
}
