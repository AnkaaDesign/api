import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { DeepLinkService } from '../notification/deep-link.service';
import { Platform, DeviceToken } from '@prisma/client';

export interface PushNotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
  deliveryStatus?: 'DELIVERED' | 'FAILED' | 'PENDING';
}

export interface MulticastNotificationResult {
  success: number;
  failure: number;
  failedTokens?: string[];
  deliveryStatus?: Array<{
    token: string;
    status: 'DELIVERED' | 'FAILED';
    error?: string;
  }>;
}

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  imageUrl?: string;
  actionUrl?: string;
  deepLinks?: {
    web?: string;
    mobile?: string;
    universalLink?: string;
  };
}

export interface DeliveryStatusResult {
  notificationId: string;
  token: string;
  status: 'DELIVERED' | 'FAILED' | 'PENDING';
  deliveredAt?: Date;
  failedAt?: Date;
  error?: string;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private firebaseApp: admin.app.App;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deepLinkService: DeepLinkService,
  ) {}

  onModuleInit() {
    try {
      // Check if Firebase is already initialized
      if (admin.apps.length > 0) {
        this.firebaseApp = admin.apps[0];
        this.logger.log('Firebase Admin SDK already initialized');
        return;
      }

      // Initialize Firebase Admin SDK
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

      if (!projectId || !privateKey || !clientEmail) {
        this.logger.warn(
          'Firebase credentials not configured. Push notifications will be disabled.',
        );
        return;
      }

      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          privateKey,
          clientEmail,
        }),
      });

      this.logger.log('Firebase Admin SDK initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error);
    }
  }

  /**
   * Send push notification to a single device token
   */
  async sendPushNotification(
    token: string,
    title: string,
    body: string,
    data?: any,
  ): Promise<PushNotificationResult> {
    if (!this.firebaseApp) {
      this.logger.warn('Firebase not initialized. Cannot send notification.');
      return { success: false, error: 'Firebase not initialized' };
    }

    try {
      this.logger.log(`Sending push notification to token: ${token.substring(0, 10)}...`);

      const message: admin.messaging.Message = {
        token,
        notification: {
          title,
          body,
        },
        data: data ? this.sanitizeData(data) : undefined,
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              contentAvailable: true,
            },
          },
          headers: {
            'apns-priority': '10',
          },
        },
        webpush: {
          notification: {
            icon: '/icon.png',
            badge: '/badge.png',
            requireInteraction: true,
          },
        },
      };

      const messageId = await admin.messaging().send(message);

      this.logger.log(`Successfully sent notification: ${messageId}`);

      return {
        success: true,
        messageId,
      };
    } catch (error) {
      this.logger.error(`Failed to send notification: ${error.message}`, error.stack);

      // Check if token is invalid and mark it as inactive
      if (this.isInvalidTokenError(error)) {
        await this.deactivateToken(token);
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send push notification to multiple device tokens
   */
  async sendMulticastNotification(
    tokens: string[],
    title: string,
    body: string,
    data?: any,
  ): Promise<MulticastNotificationResult> {
    if (!this.firebaseApp) {
      this.logger.warn('Firebase not initialized. Cannot send notifications.');
      return { success: 0, failure: tokens.length };
    }

    if (tokens.length === 0) {
      this.logger.warn('No tokens provided for multicast notification');
      return { success: 0, failure: 0 };
    }

    try {
      this.logger.log(`Sending multicast notification to ${tokens.length} tokens`);

      const message: admin.messaging.MulticastMessage = {
        tokens,
        notification: {
          title,
          body,
        },
        data: data ? this.sanitizeData(data) : undefined,
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              contentAvailable: true,
            },
          },
          headers: {
            'apns-priority': '10',
          },
        },
        webpush: {
          notification: {
            icon: '/icon.png',
            badge: '/badge.png',
            requireInteraction: true,
          },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      this.logger.log(
        `Multicast result - Success: ${response.successCount}, Failure: ${response.failureCount}`,
      );

      // Collect failed tokens and deactivate them
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && this.isInvalidTokenError(resp.error)) {
          failedTokens.push(tokens[idx]);
        }
      });

      if (failedTokens.length > 0) {
        await this.deactivateTokens(failedTokens);
      }

      return {
        success: response.successCount,
        failure: response.failureCount,
        failedTokens: failedTokens.length > 0 ? failedTokens : undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to send multicast notification: ${error.message}`, error.stack);

      return {
        success: 0,
        failure: tokens.length,
      };
    }
  }

  /**
   * Send push notification to a topic
   */
  async sendTopicNotification(
    topic: string,
    title: string,
    body: string,
    data?: any,
  ): Promise<PushNotificationResult> {
    if (!this.firebaseApp) {
      this.logger.warn('Firebase not initialized. Cannot send notification.');
      return { success: false, error: 'Firebase not initialized' };
    }

    try {
      this.logger.log(`Sending topic notification to topic: ${topic}`);

      const message: admin.messaging.Message = {
        topic,
        notification: {
          title,
          body,
        },
        data: data ? this.sanitizeData(data) : undefined,
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              contentAvailable: true,
            },
          },
          headers: {
            'apns-priority': '10',
          },
        },
        webpush: {
          notification: {
            icon: '/icon.png',
            badge: '/badge.png',
            requireInteraction: true,
          },
        },
      };

      const messageId = await admin.messaging().send(message);

      this.logger.log(`Successfully sent topic notification: ${messageId}`);

      return {
        success: true,
        messageId,
      };
    } catch (error) {
      this.logger.error(`Failed to send topic notification: ${error.message}`, error.stack);

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Subscribe token to a topic
   */
  async subscribeToTopic(tokens: string | string[], topic: string): Promise<boolean> {
    if (!this.firebaseApp) {
      this.logger.warn('Firebase not initialized. Cannot subscribe to topic.');
      return false;
    }

    try {
      const tokenArray = Array.isArray(tokens) ? tokens : [tokens];
      await admin.messaging().subscribeToTopic(tokenArray, topic);
      this.logger.log(`Subscribed ${tokenArray.length} tokens to topic: ${topic}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to subscribe to topic: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Unsubscribe token from a topic
   */
  async unsubscribeFromTopic(tokens: string | string[], topic: string): Promise<boolean> {
    if (!this.firebaseApp) {
      this.logger.warn('Firebase not initialized. Cannot unsubscribe from topic.');
      return false;
    }

    try {
      const tokenArray = Array.isArray(tokens) ? tokens : [tokens];
      await admin.messaging().unsubscribeFromTopic(tokenArray, topic);
      this.logger.log(`Unsubscribed ${tokenArray.length} tokens from topic: ${topic}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to unsubscribe from topic: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Register a device token for a user
   */
  async registerDeviceToken(
    userId: string,
    token: string,
    platform: 'IOS' | 'ANDROID' | 'WEB',
  ): Promise<boolean> {
    try {
      await this.prisma.deviceToken.upsert({
        where: { token },
        create: {
          userId,
          token,
          platform,
          isActive: true,
        },
        update: {
          userId,
          platform,
          isActive: true,
          updatedAt: new Date(),
        },
      });

      this.logger.log(`Device token registered for user: ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to register device token: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Unregister a device token
   */
  async unregisterDeviceToken(token: string): Promise<boolean> {
    try {
      await this.prisma.deviceToken.delete({
        where: { token },
      });

      this.logger.log(`Device token unregistered: ${token.substring(0, 10)}...`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to unregister device token: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Get all active device tokens for a user
   */
  async getUserTokens(userId: string): Promise<string[]> {
    try {
      const devices = await this.prisma.deviceToken.findMany({
        where: {
          userId,
          isActive: true,
        },
        select: {
          token: true,
        },
      });

      return devices.map(d => d.token);
    } catch (error) {
      this.logger.error(`Failed to get user tokens: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Send notification to all devices of a user
   */
  async sendToUser(
    userId: string,
    title: string,
    body: string,
    data?: any,
  ): Promise<MulticastNotificationResult> {
    const tokens = await this.getUserTokens(userId);

    if (tokens.length === 0) {
      this.logger.warn(`No active tokens found for user: ${userId}`);
      return { success: 0, failure: 0 };
    }

    return this.sendMulticastNotification(tokens, title, body, data);
  }

  /**
   * Deactivate a single token in the database
   */
  private async deactivateToken(token: string): Promise<void> {
    try {
      await this.prisma.deviceToken.update({
        where: { token },
        data: { isActive: false },
      });

      this.logger.log(`Deactivated invalid token: ${token.substring(0, 10)}...`);
    } catch (error) {
      this.logger.error(`Failed to deactivate token: ${error.message}`);
    }
  }

  /**
   * Deactivate multiple tokens in the database
   */
  private async deactivateTokens(tokens: string[]): Promise<void> {
    try {
      await this.prisma.deviceToken.updateMany({
        where: {
          token: {
            in: tokens,
          },
        },
        data: {
          isActive: false,
        },
      });

      this.logger.log(`Deactivated ${tokens.length} invalid tokens`);
    } catch (error) {
      this.logger.error(`Failed to deactivate tokens: ${error.message}`);
    }
  }

  /**
   * Check if error is due to invalid token
   */
  private isInvalidTokenError(error: any): boolean {
    if (!error) return false;

    const errorCode = error.code || error.errorInfo?.code;
    const invalidCodes = [
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'messaging/invalid-argument',
    ];

    return invalidCodes.includes(errorCode);
  }

  /**
   * Sanitize data to ensure all values are strings (FCM requirement)
   */
  private sanitizeData(data: any): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(data)) {
      if (value !== null && value !== undefined) {
        sanitized[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }

    return sanitized;
  }

  // =====================
  // Enhanced Methods with Deep Links and Delivery Tracking
  // =====================

  /**
   * Send push notification to a specific device token with enhanced features
   * Includes deep links, delivery tracking, and platform-specific optimizations
   */
  async sendToDevice(
    token: string,
    payload: NotificationPayload,
    notificationId?: string,
  ): Promise<PushNotificationResult> {
    if (!this.firebaseApp) {
      this.logger.warn('Firebase not initialized. Cannot send notification.');
      return {
        success: false,
        error: 'Firebase not initialized',
        deliveryStatus: 'FAILED',
      };
    }

    try {
      this.logger.log(`Sending enhanced push notification to token: ${token.substring(0, 10)}...`);

      // Build FCM message with deep links and platform-specific config
      const message = await this.buildNotificationPayload(token, payload);

      const messageId = await admin.messaging().send(message);

      this.logger.log(`Successfully sent notification: ${messageId}`);

      // Track delivery status if notificationId provided
      if (notificationId) {
        await this.handleDeliveryStatus(notificationId, token, 'DELIVERED', messageId);
      }

      return {
        success: true,
        messageId,
        deliveryStatus: 'DELIVERED',
      };
    } catch (error) {
      this.logger.error(`Failed to send notification: ${error.message}`, error.stack);

      // Check if token is invalid and mark it as inactive
      if (this.isInvalidTokenError(error)) {
        await this.deactivateToken(token);
      }

      // Track failure if notificationId provided
      if (notificationId) {
        await this.handleDeliveryStatus(notificationId, token, 'FAILED', undefined, error.message);
      }

      return {
        success: false,
        error: error.message,
        deliveryStatus: 'FAILED',
      };
    }
  }

  /**
   * Send push notification to a topic with enhanced features
   * Supports deep links and delivery tracking
   */
  async sendToTopic(
    topic: string,
    payload: NotificationPayload,
    notificationId?: string,
  ): Promise<PushNotificationResult> {
    if (!this.firebaseApp) {
      this.logger.warn('Firebase not initialized. Cannot send notification.');
      return {
        success: false,
        error: 'Firebase not initialized',
        deliveryStatus: 'FAILED',
      };
    }

    try {
      this.logger.log(`Sending enhanced topic notification to topic: ${topic}`);

      // Build FCM message for topic
      const message = await this.buildTopicNotificationPayload(topic, payload);

      const messageId = await admin.messaging().send(message);

      this.logger.log(`Successfully sent topic notification: ${messageId}`);

      // Track delivery status if notificationId provided
      if (notificationId) {
        await this.handleDeliveryStatus(notificationId, `topic:${topic}`, 'DELIVERED', messageId);
      }

      return {
        success: true,
        messageId,
        deliveryStatus: 'DELIVERED',
      };
    } catch (error) {
      this.logger.error(`Failed to send topic notification: ${error.message}`, error.stack);

      // Track failure if notificationId provided
      if (notificationId) {
        await this.handleDeliveryStatus(
          notificationId,
          `topic:${topic}`,
          'FAILED',
          undefined,
          error.message,
        );
      }

      return {
        success: false,
        error: error.message,
        deliveryStatus: 'FAILED',
      };
    }
  }

  /**
   * Get all device tokens for a user (both active and inactive)
   */
  async getUserDevices(userId: string): Promise<DeviceToken[]> {
    try {
      const devices = await this.prisma.deviceToken.findMany({
        where: {
          userId,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      this.logger.log(`Found ${devices.length} devices for user: ${userId}`);
      return devices;
    } catch (error) {
      this.logger.error(`Failed to get user devices: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Track FCM delivery status in the database
   * Creates or updates NotificationDelivery records
   */
  async handleDeliveryStatus(
    notificationId: string,
    token: string,
    status: 'DELIVERED' | 'FAILED' | 'PENDING',
    messageId?: string,
    errorMessage?: string,
  ): Promise<void> {
    try {
      // Determine the channel based on token type
      const channel = token.startsWith('topic:') ? 'PUSH' : await this.getChannelFromToken(token);

      const deliveryData: any = {
        notificationId,
        channel,
        status,
        errorMessage: errorMessage || null,
        metadata: messageId ? { fcmMessageId: messageId, token } : { token },
      };

      // Set appropriate timestamp based on status
      if (status === 'DELIVERED') {
        deliveryData.sentAt = new Date();
        deliveryData.deliveredAt = new Date();
      } else if (status === 'FAILED') {
        deliveryData.sentAt = new Date();
        deliveryData.failedAt = new Date();
      }

      await this.prisma.notificationDelivery.create({
        data: deliveryData,
      });

      this.logger.log(`Tracked delivery status for notification ${notificationId}: ${status}`);
    } catch (error) {
      this.logger.error(`Failed to track delivery status: ${error.message}`, error.stack);
    }
  }

  /**
   * Build FCM notification payload with deep links and platform-specific config
   * Supports Android, iOS, and Web platforms
   */
  async buildNotificationPayload(
    token: string,
    payload: NotificationPayload,
  ): Promise<admin.messaging.Message> {
    // Get device platform to optimize payload
    const platform = await this.getDevicePlatform(token);

    // Prepare data payload with deep links
    const dataPayload: Record<string, string> = {};

    if (payload.data) {
      Object.assign(dataPayload, this.sanitizeData(payload.data));
    }

    // Add deep links to data payload
    if (payload.deepLinks) {
      if (payload.deepLinks.web) {
        dataPayload.webUrl = payload.deepLinks.web;
      }
      if (payload.deepLinks.mobile) {
        dataPayload.mobileUrl = payload.deepLinks.mobile;
      }
      if (payload.deepLinks.universalLink) {
        dataPayload.universalLink = payload.deepLinks.universalLink;
      }
    } else if (payload.actionUrl) {
      // Parse action URL if it's JSON (from deep link service)
      try {
        const parsedUrl = this.deepLinkService.parseNotificationActionUrl(payload.actionUrl);
        if (parsedUrl) {
          if (parsedUrl.web) dataPayload.webUrl = parsedUrl.web;
          if (parsedUrl.mobile) dataPayload.mobileUrl = parsedUrl.mobile;
          if (parsedUrl.universalLink) dataPayload.universalLink = parsedUrl.universalLink;
        }
      } catch {
        // If not JSON, use as direct URL
        dataPayload.actionUrl = payload.actionUrl;
      }
    }

    // Build the message
    const message: admin.messaging.Message = {
      token,
      notification: {
        title: payload.title,
        body: payload.body,
        imageUrl: payload.imageUrl,
      },
      data: Object.keys(dataPayload).length > 0 ? dataPayload : undefined,
    };

    // Platform-specific configurations
    if (platform === 'ANDROID' || !platform) {
      message.android = {
        priority: 'high',
        notification: {
          channelId: 'default',
          priority: 'high' as any,
          defaultSound: true,
          defaultVibrateTimings: true,
          imageUrl: payload.imageUrl,
          clickAction: dataPayload.mobileUrl || dataPayload.actionUrl,
        },
        data: dataPayload,
      };
    }

    if (platform === 'IOS' || !platform) {
      message.apns = {
        payload: {
          aps: {
            alert: {
              title: payload.title,
              body: payload.body,
            },
            sound: 'default',
            badge: 1,
            contentAvailable: true,
            mutableContent: true,
          },
        },
        headers: {
          'apns-priority': '10',
        },
        fcmOptions: {
          imageUrl: payload.imageUrl,
        },
      };
    }

    if (platform === 'WEB' || !platform) {
      message.webpush = {
        notification: {
          title: payload.title,
          body: payload.body,
          icon: payload.imageUrl || '/icon.png',
          badge: '/badge.png',
          requireInteraction: true,
          data: dataPayload,
        },
        fcmOptions: {
          link: dataPayload.webUrl || dataPayload.universalLink || dataPayload.actionUrl,
        },
      };
    }

    return message;
  }

  /**
   * Build FCM notification payload for topic messaging
   */
  private async buildTopicNotificationPayload(
    topic: string,
    payload: NotificationPayload,
  ): Promise<admin.messaging.Message> {
    // Prepare data payload with deep links
    const dataPayload: Record<string, string> = {};

    if (payload.data) {
      Object.assign(dataPayload, this.sanitizeData(payload.data));
    }

    // Add deep links
    if (payload.deepLinks) {
      if (payload.deepLinks.web) dataPayload.webUrl = payload.deepLinks.web;
      if (payload.deepLinks.mobile) dataPayload.mobileUrl = payload.deepLinks.mobile;
      if (payload.deepLinks.universalLink)
        dataPayload.universalLink = payload.deepLinks.universalLink;
    } else if (payload.actionUrl) {
      try {
        const parsedUrl = this.deepLinkService.parseNotificationActionUrl(payload.actionUrl);
        if (parsedUrl) {
          if (parsedUrl.web) dataPayload.webUrl = parsedUrl.web;
          if (parsedUrl.mobile) dataPayload.mobileUrl = parsedUrl.mobile;
          if (parsedUrl.universalLink) dataPayload.universalLink = parsedUrl.universalLink;
        }
      } catch {
        dataPayload.actionUrl = payload.actionUrl;
      }
    }

    return {
      topic,
      notification: {
        title: payload.title,
        body: payload.body,
        imageUrl: payload.imageUrl,
      },
      data: Object.keys(dataPayload).length > 0 ? dataPayload : undefined,
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          priority: 'high' as any,
          defaultSound: true,
          defaultVibrateTimings: true,
          imageUrl: payload.imageUrl,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            contentAvailable: true,
          },
        },
        headers: {
          'apns-priority': '10',
        },
      },
      webpush: {
        notification: {
          icon: payload.imageUrl || '/icon.png',
          badge: '/badge.png',
          requireInteraction: true,
        },
        fcmOptions: {
          link: dataPayload.webUrl || dataPayload.universalLink,
        },
      },
    };
  }

  /**
   * Get device platform from token
   */
  private async getDevicePlatform(token: string): Promise<Platform | null> {
    try {
      const device = await this.prisma.deviceToken.findUnique({
        where: { token },
        select: { platform: true },
      });

      return device?.platform || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get notification channel from token (MOBILE_PUSH or DESKTOP_PUSH)
   */
  private async getChannelFromToken(token: string): Promise<any> {
    try {
      const device = await this.prisma.deviceToken.findUnique({
        where: { token },
        select: { platform: true },
      });

      // Map platform to channel
      if (device?.platform === 'WEB') {
        return 'DESKTOP_PUSH';
      } else if (device?.platform === 'IOS' || device?.platform === 'ANDROID') {
        return 'MOBILE_PUSH';
      }

      return 'PUSH';
    } catch (error) {
      return 'PUSH';
    }
  }
}
