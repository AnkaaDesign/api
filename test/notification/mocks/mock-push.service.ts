import { Injectable, Logger } from '@nestjs/common';

/**
 * Mock Push Notification Service for testing
 * Simulates push notifications (FCM, APNS, etc.) without actually sending
 */
@Injectable()
export class MockPushService {
  private readonly logger = new Logger(MockPushService.name);

  // Track sent push notifications for verification
  public sentNotifications: Array<{
    deviceToken: string;
    title: string;
    body: string;
    data?: Record<string, any>;
    platform: 'ios' | 'android' | 'web';
    timestamp: Date;
    status: 'sent' | 'delivered' | 'clicked' | 'failed';
    notificationId: string;
  }> = [];

  // Configuration for testing scenarios
  public shouldFail: boolean = false;
  public shouldDelay: boolean = false;
  public delayMs: number = 100;
  public failureRate: number = 0; // 0-1, percentage of requests that should fail
  public deliveryDelay: number = 300; // Time until notification is "delivered"
  public clickRate: number = 0.3; // 30% of notifications are "clicked"

  private notificationIdCounter: number = 1;

  /**
   * Mock send push notification method
   */
  async sendPushNotification(
    deviceToken: string,
    title: string,
    body: string,
    data?: Record<string, any>,
    platform: 'ios' | 'android' | 'web' = 'android'
  ): Promise<string> {
    this.logger.log(
      `Mock sending ${platform} push notification to ${deviceToken}: ${title}`
    );

    // Simulate delay if configured
    if (this.shouldDelay) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }

    const notificationId = `push_notif_${this.notificationIdCounter++}`;

    // Simulate random failures based on failure rate
    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      this.sentNotifications.push({
        deviceToken,
        title,
        body,
        data,
        platform,
        timestamp: new Date(),
        status: 'failed',
        notificationId,
      });
      throw new Error('Mock push notification delivery failed (random failure)');
    }

    // Simulate intentional failure if configured
    if (this.shouldFail) {
      this.sentNotifications.push({
        deviceToken,
        title,
        body,
        data,
        platform,
        timestamp: new Date(),
        status: 'failed',
        notificationId,
      });
      throw new Error('Mock push notification delivery failed');
    }

    // Track sent notification
    this.sentNotifications.push({
      deviceToken,
      title,
      body,
      data,
      platform,
      timestamp: new Date(),
      status: 'sent',
      notificationId,
    });

    // Simulate delivery status update after delay
    setTimeout(() => {
      const notif = this.sentNotifications.find(n => n.notificationId === notificationId);
      if (notif && notif.status === 'sent') {
        notif.status = 'delivered';

        // Simulate random clicks
        if (Math.random() < this.clickRate) {
          setTimeout(() => {
            if (notif.status === 'delivered') {
              notif.status = 'clicked';
            }
          }, 500);
        }
      }
    }, this.deliveryDelay);

    this.logger.log(
      `Mock push notification sent successfully to ${deviceToken}, ID: ${notificationId}`
    );

    return notificationId;
  }

  /**
   * Send notification to multiple devices
   */
  async sendToMultipleDevices(
    deviceTokens: string[],
    title: string,
    body: string,
    data?: Record<string, any>
  ): Promise<string[]> {
    return Promise.all(
      deviceTokens.map(token => this.sendPushNotification(token, title, body, data))
    );
  }

  /**
   * Send notification to topic/group
   */
  async sendToTopic(
    topic: string,
    title: string,
    body: string,
    data?: Record<string, any>
  ): Promise<string> {
    this.logger.log(`Mock sending push notification to topic: ${topic}`);

    // For testing, we'll treat topic as a special device token
    return this.sendPushNotification(`topic:${topic}`, title, body, data);
  }

  /**
   * Send data-only notification (silent/background)
   */
  async sendDataNotification(
    deviceToken: string,
    data: Record<string, any>,
    platform: 'ios' | 'android' | 'web' = 'android'
  ): Promise<string> {
    this.logger.log(`Mock sending data notification to ${deviceToken}`);

    return this.sendPushNotification(
      deviceToken,
      '', // No title for data-only
      '', // No body for data-only
      data,
      platform
    );
  }

  /**
   * Send notification with custom sound and badge
   */
  async sendWithCustomOptions(
    deviceToken: string,
    title: string,
    body: string,
    options: {
      sound?: string;
      badge?: number;
      icon?: string;
      color?: string;
      priority?: 'high' | 'normal';
      data?: Record<string, any>;
    }
  ): Promise<string> {
    this.logger.log(`Mock sending custom push notification to ${deviceToken}`);

    return this.sendPushNotification(
      deviceToken,
      title,
      body,
      { ...options.data, _customOptions: options }
    );
  }

  /**
   * Get notification status
   */
  getNotificationStatus(notificationId: string): string | null {
    const notification = this.sentNotifications.find(n => n.notificationId === notificationId);
    return notification ? notification.status : null;
  }

  /**
   * Mark notification as clicked (simulate user interaction)
   */
  markNotificationAsClicked(notificationId: string): void {
    const notification = this.sentNotifications.find(n => n.notificationId === notificationId);
    if (notification && notification.status === 'delivered') {
      notification.status = 'clicked';
      this.logger.log(`Notification ${notificationId} marked as clicked`);
    }
  }

  /**
   * Subscribe device to topic
   */
  async subscribeToTopic(deviceToken: string, topic: string): Promise<void> {
    this.logger.log(`Mock subscribing ${deviceToken} to topic ${topic}`);
    // In real implementation, this would subscribe via FCM/APNS
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  /**
   * Unsubscribe device from topic
   */
  async unsubscribeFromTopic(deviceToken: string, topic: string): Promise<void> {
    this.logger.log(`Mock unsubscribing ${deviceToken} from topic ${topic}`);
    // In real implementation, this would unsubscribe via FCM/APNS
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  /**
   * Validate device token
   */
  async validateDeviceToken(deviceToken: string): Promise<boolean> {
    // Mock validation - in reality would check with FCM/APNS
    return deviceToken.length > 10 && !deviceToken.includes('invalid');
  }

  /**
   * Reset mock state
   */
  reset(): void {
    this.sentNotifications = [];
    this.shouldFail = false;
    this.shouldDelay = false;
    this.delayMs = 100;
    this.failureRate = 0;
    this.deliveryDelay = 300;
    this.clickRate = 0.3;
    this.notificationIdCounter = 1;
  }

  /**
   * Get sent notifications for a specific device
   */
  getSentNotificationsFor(deviceToken: string): typeof this.sentNotifications {
    return this.sentNotifications.filter(n => n.deviceToken === deviceToken);
  }

  /**
   * Check if push notification was sent
   */
  wasNotificationSent(deviceToken: string, titleContains?: string): boolean {
    return this.sentNotifications.some(
      n =>
        n.deviceToken === deviceToken &&
        n.status !== 'failed' &&
        (!titleContains || n.title.includes(titleContains))
    );
  }

  /**
   * Get count of sent notifications
   */
  getSentCount(): number {
    return this.sentNotifications.filter(n => n.status !== 'failed').length;
  }

  /**
   * Get count of failed notifications
   */
  getFailedCount(): number {
    return this.sentNotifications.filter(n => n.status === 'failed').length;
  }

  /**
   * Get count of delivered notifications
   */
  getDeliveredCount(): number {
    return this.sentNotifications.filter(
      n => n.status === 'delivered' || n.status === 'clicked'
    ).length;
  }

  /**
   * Get count of clicked notifications
   */
  getClickedCount(): number {
    return this.sentNotifications.filter(n => n.status === 'clicked').length;
  }

  /**
   * Get click-through rate
   */
  getClickThroughRate(): number {
    const delivered = this.getDeliveredCount();
    const clicked = this.getClickedCount();
    return delivered > 0 ? clicked / delivered : 0;
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
   * Configure click rate for simulated user interactions
   */
  configureClickRate(rate: number): void {
    this.clickRate = Math.max(0, Math.min(1, rate));
  }

  /**
   * Get notifications by platform
   */
  getNotificationsByPlatform(platform: 'ios' | 'android' | 'web'): typeof this.sentNotifications {
    return this.sentNotifications.filter(n => n.platform === platform);
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    total: number;
    sent: number;
    delivered: number;
    clicked: number;
    failed: number;
    clickThroughRate: number;
    byPlatform: Record<string, number>;
  } {
    return {
      total: this.sentNotifications.length,
      sent: this.getSentCount(),
      delivered: this.getDeliveredCount(),
      clicked: this.getClickedCount(),
      failed: this.getFailedCount(),
      clickThroughRate: this.getClickThroughRate(),
      byPlatform: {
        ios: this.getNotificationsByPlatform('ios').length,
        android: this.getNotificationsByPlatform('android').length,
        web: this.getNotificationsByPlatform('web').length,
      },
    };
  }
}
