import { Injectable, Logger } from '@nestjs/common';

/**
 * Mock WhatsApp Service for testing
 * Simulates WhatsApp Business API without actually sending messages
 */
@Injectable()
export class MockWhatsAppService {
  private readonly logger = new Logger(MockWhatsAppService.name);

  // Track sent WhatsApp messages for verification
  public sentMessages: Array<{
    to: string;
    message: string;
    type: 'text' | 'template' | 'media';
    timestamp: Date;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    messageId: string;
  }> = [];

  // Configuration for testing scenarios
  public shouldFail: boolean = false;
  public shouldDelay: boolean = false;
  public delayMs: number = 200;
  public failureRate: number = 0; // 0-1, percentage of requests that should fail
  public deliveryDelay: number = 500; // Time until message is "delivered"

  private messageIdCounter: number = 1;

  /**
   * Mock send WhatsApp message method
   */
  async sendWhatsAppMessage(
    to: string,
    message: string,
    type: 'text' | 'template' | 'media' = 'text'
  ): Promise<string> {
    this.logger.log(
      `Mock sending WhatsApp ${type} message to ${to}: ${message.substring(0, 50)}...`
    );

    // Simulate delay if configured
    if (this.shouldDelay) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }

    const messageId = `whatsapp_msg_${this.messageIdCounter++}`;

    // Simulate random failures based on failure rate
    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      this.sentMessages.push({
        to,
        message,
        type,
        timestamp: new Date(),
        status: 'failed',
        messageId,
      });
      throw new Error('Mock WhatsApp delivery failed (random failure)');
    }

    // Simulate intentional failure if configured
    if (this.shouldFail) {
      this.sentMessages.push({
        to,
        message,
        type,
        timestamp: new Date(),
        status: 'failed',
        messageId,
      });
      throw new Error('Mock WhatsApp delivery failed');
    }

    // Track sent message
    this.sentMessages.push({
      to,
      message,
      type,
      timestamp: new Date(),
      status: 'sent',
      messageId,
    });

    // Simulate delivery status update after delay
    setTimeout(() => {
      const msg = this.sentMessages.find(m => m.messageId === messageId);
      if (msg && msg.status === 'sent') {
        msg.status = 'delivered';
      }
    }, this.deliveryDelay);

    this.logger.log(`Mock WhatsApp message sent successfully to ${to}, ID: ${messageId}`);

    return messageId;
  }

  /**
   * Send notification message
   */
  async sendNotificationMessage(
    to: string,
    title: string,
    body: string,
    actionUrl?: string
  ): Promise<string> {
    const message = `*${title}*\n\n${body}${actionUrl ? `\n\n${actionUrl}` : ''}`;
    return this.sendWhatsAppMessage(to, message, 'text');
  }

  /**
   * Send template message
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    parameters: Record<string, string>
  ): Promise<string> {
    const message = `Template: ${templateName}, Params: ${JSON.stringify(parameters)}`;
    return this.sendWhatsAppMessage(to, message, 'template');
  }

  /**
   * Send media message
   */
  async sendMediaMessage(
    to: string,
    mediaUrl: string,
    caption?: string
  ): Promise<string> {
    const message = `Media: ${mediaUrl}${caption ? `, Caption: ${caption}` : ''}`;
    return this.sendWhatsAppMessage(to, message, 'media');
  }

  /**
   * Send batch messages
   */
  async sendBatchMessages(
    messages: Array<{ to: string; message: string; type?: 'text' | 'template' | 'media' }>
  ): Promise<string[]> {
    return Promise.all(
      messages.map(msg =>
        this.sendWhatsAppMessage(msg.to, msg.message, msg.type || 'text')
      )
    );
  }

  /**
   * Get message status
   */
  getMessageStatus(messageId: string): string | null {
    const message = this.sentMessages.find(m => m.messageId === messageId);
    return message ? message.status : null;
  }

  /**
   * Mark message as read (simulate webhook)
   */
  markMessageAsRead(messageId: string): void {
    const message = this.sentMessages.find(m => m.messageId === messageId);
    if (message && message.status === 'delivered') {
      message.status = 'read';
      this.logger.log(`Message ${messageId} marked as read`);
    }
  }

  /**
   * Reset mock state
   */
  reset(): void {
    this.sentMessages = [];
    this.shouldFail = false;
    this.shouldDelay = false;
    this.delayMs = 200;
    this.failureRate = 0;
    this.deliveryDelay = 500;
    this.messageIdCounter = 1;
  }

  /**
   * Get sent messages for a specific phone number
   */
  getSentMessagesFor(phone: string): typeof this.sentMessages {
    return this.sentMessages.filter(m => m.to === phone);
  }

  /**
   * Check if WhatsApp message was sent
   */
  wasMessageSent(to: string, messageContains?: string): boolean {
    return this.sentMessages.some(
      m =>
        m.to === to &&
        m.status !== 'failed' &&
        (!messageContains || m.message.includes(messageContains))
    );
  }

  /**
   * Get count of sent messages
   */
  getSentCount(): number {
    return this.sentMessages.filter(m => m.status !== 'failed').length;
  }

  /**
   * Get count of failed messages
   */
  getFailedCount(): number {
    return this.sentMessages.filter(m => m.status === 'failed').length;
  }

  /**
   * Get count of delivered messages
   */
  getDeliveredCount(): number {
    return this.sentMessages.filter(m => m.status === 'delivered' || m.status === 'read')
      .length;
  }

  /**
   * Get count of read messages
   */
  getReadCount(): number {
    return this.sentMessages.filter(m => m.status === 'read').length;
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
   * Configure delivery delay
   */
  configureDeliveryDelay(delayMs: number): void {
    this.deliveryDelay = delayMs;
  }

  /**
   * Validate phone number format (mock validation)
   */
  isValidWhatsAppNumber(phone: string): boolean {
    // WhatsApp requires E.164 format
    return /^\+?[1-9]\d{1,14}$/.test(phone);
  }

  /**
   * Check if number is registered on WhatsApp (mock check)
   */
  async isRegisteredOnWhatsApp(phone: string): Promise<boolean> {
    // In real implementation, this would check with WhatsApp API
    // For testing, we'll assume all valid numbers are registered
    return this.isValidWhatsAppNumber(phone);
  }
}
