import { Injectable, Logger } from '@nestjs/common';

/**
 * Mock Email Service for testing
 * Simulates email sending without actually sending emails
 */
@Injectable()
export class MockEmailService {
  private readonly logger = new Logger(MockEmailService.name);

  // Track sent emails for verification
  public sentEmails: Array<{
    to: string;
    subject: string;
    body: string;
    timestamp: Date;
  }> = [];

  // Configuration for testing scenarios
  public shouldFail: boolean = false;
  public shouldDelay: boolean = false;
  public delayMs: number = 100;
  public failureRate: number = 0; // 0-1, percentage of requests that should fail

  /**
   * Mock send email method
   */
  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    this.logger.log(`Mock sending email to ${to}: ${subject}`);

    // Simulate delay if configured
    if (this.shouldDelay) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }

    // Simulate random failures based on failure rate
    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      throw new Error('Mock email delivery failed (random failure)');
    }

    // Simulate intentional failure if configured
    if (this.shouldFail) {
      throw new Error('Mock email delivery failed');
    }

    // Track sent email
    this.sentEmails.push({
      to,
      subject,
      body,
      timestamp: new Date(),
    });

    this.logger.log(`Mock email sent successfully to ${to}`);
  }

  /**
   * Send notification email
   */
  async sendNotificationEmail(
    to: string,
    title: string,
    body: string,
    actionUrl?: string
  ): Promise<void> {
    const emailBody = `
      ${body}

      ${actionUrl ? `Action: ${actionUrl}` : ''}
    `;

    return this.sendEmail(to, title, emailBody);
  }

  /**
   * Send batch emails
   */
  async sendBatchEmails(
    emails: Array<{ to: string; subject: string; body: string }>
  ): Promise<void[]> {
    return Promise.all(
      emails.map(email => this.sendEmail(email.to, email.subject, email.body))
    );
  }

  /**
   * Reset mock state
   */
  reset(): void {
    this.sentEmails = [];
    this.shouldFail = false;
    this.shouldDelay = false;
    this.delayMs = 100;
    this.failureRate = 0;
  }

  /**
   * Get sent emails for a specific recipient
   */
  getSentEmailsFor(email: string): typeof this.sentEmails {
    return this.sentEmails.filter(e => e.to === email);
  }

  /**
   * Check if email was sent
   */
  wasEmailSent(to: string, subject?: string): boolean {
    return this.sentEmails.some(
      e => e.to === to && (!subject || e.subject.includes(subject))
    );
  }

  /**
   * Get count of sent emails
   */
  getSentCount(): number {
    return this.sentEmails.length;
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
}
