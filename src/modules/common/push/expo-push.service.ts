import { Injectable, Logger } from '@nestjs/common';
import {
  Expo,
  ExpoPushMessage,
  ExpoPushTicket,
  ExpoPushSuccessTicket,
  ExpoPushErrorTicket,
} from 'expo-server-sdk';

export interface ExpoPushResult {
  success: boolean;
  ticket?: ExpoPushTicket;
  error?: string;
}

export interface ExpoMulticastResult {
  success: number;
  failure: number;
  tickets: ExpoPushTicket[];
  failedTokens: string[];
}

/**
 * Expo Push Notification Service
 * Handles sending push notifications through Expo's push service
 * for Expo-generated tokens (ExponentPushToken[...])
 */
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);
  private expo: Expo;

  constructor() {
    this.logger.log('========================================');
    this.logger.log('[EXPO PUSH] Initializing Expo Push Service...');

    try {
      // Initialize Expo SDK
      this.expo = new Expo({
        accessToken: process.env.EXPO_ACCESS_TOKEN, // Optional, for higher rate limits
        useFcmV1: true, // Use FCM v1 API (recommended)
      });

      this.logger.log('[EXPO PUSH] ✅ Expo Push Service initialized successfully');

      if (process.env.EXPO_ACCESS_TOKEN) {
        this.logger.log('[EXPO PUSH] Using Expo access token (higher rate limits)');
      } else {
        this.logger.warn('[EXPO PUSH] ⚠️ No EXPO_ACCESS_TOKEN set (using default rate limits)');
        this.logger.warn('[EXPO PUSH] Free tier: 600 notifications/hour');
        this.logger.warn('[EXPO PUSH] To increase limits, set EXPO_ACCESS_TOKEN in .env');
      }

      this.logger.log('========================================');
    } catch (error) {
      this.logger.error('========================================');
      this.logger.error('[EXPO PUSH] ❌ Failed to initialize Expo Push Service');
      this.logger.error('[EXPO PUSH] Error:', error.message);
      this.logger.error('========================================');
    }
  }

  /**
   * Check if a token is a valid Expo push token
   */
  isExpoPushToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }

  /**
   * Send push notification to a single Expo token
   */
  async sendPushNotification(
    token: string,
    title: string,
    body: string,
    data?: any,
  ): Promise<ExpoPushResult> {
    if (!this.expo) {
      return { success: false, error: 'Expo Push Service not initialized' };
    }

    // Validate token
    if (!Expo.isExpoPushToken(token)) {
      this.logger.error(
        `[EXPO PUSH] Invalid Expo push token: ${String(token).substring(0, 20)}...`,
      );
      return { success: false, error: 'Invalid Expo push token format' };
    }

    try {
      this.logger.log(`[EXPO PUSH] Sending notification to token: ${token.substring(0, 30)}...`);
      this.logger.log(`[EXPO PUSH] Title: ${title}`);
      this.logger.log(
        `[EXPO PUSH] Body: ${body.substring(0, 100)}${body.length > 100 ? '...' : ''}`,
      );

      // Determine Android notification channel based on data
      const importance = data?.importance || 'default';
      let channelId = 'default';
      let priority: 'default' | 'normal' | 'high' = 'high';

      if (importance === 'URGENT' || importance === 'HIGH') {
        channelId = 'high-priority';
        priority = 'high';
      } else if (importance === 'LOW') {
        channelId = 'low-priority';
        priority = 'normal';
      }

      // Build message
      const message: ExpoPushMessage = {
        to: token,
        sound: 'default',
        title,
        body,
        data: data || {},
        priority,
        channelId,
      };

      // Send notification
      const chunks = this.expo.chunkPushNotifications([message]);
      const tickets: ExpoPushTicket[] = [];

      for (const chunk of chunks) {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      }

      const ticket = tickets[0];

      // Check if ticket is success or error
      if (ticket.status === 'ok') {
        this.logger.log(`[EXPO PUSH] ✅ Notification sent successfully`);
        this.logger.log(`[EXPO PUSH] Ticket ID: ${(ticket as ExpoPushSuccessTicket).id}`);
        return { success: true, ticket };
      } else {
        const errorTicket = ticket as ExpoPushErrorTicket;
        this.logger.error(`[EXPO PUSH] ❌ Failed to send notification`);
        this.logger.error(`[EXPO PUSH] Error: ${errorTicket.message}`);
        this.logger.error(`[EXPO PUSH] Details:`, JSON.stringify(errorTicket.details, null, 2));
        return { success: false, error: errorTicket.message, ticket };
      }
    } catch (error) {
      this.logger.error(`[EXPO PUSH] ❌ Exception while sending notification`);
      this.logger.error(`[EXPO PUSH] Error:`, error.message);
      this.logger.error(`[EXPO PUSH] Stack:`, error.stack);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send push notifications to multiple Expo tokens
   */
  async sendMulticastNotification(
    tokens: string[],
    title: string,
    body: string,
    data?: any,
  ): Promise<ExpoMulticastResult> {
    if (!this.expo) {
      return { success: 0, failure: tokens.length, tickets: [], failedTokens: tokens };
    }

    if (tokens.length === 0) {
      this.logger.warn('[EXPO PUSH] No tokens provided for multicast');
      return { success: 0, failure: 0, tickets: [], failedTokens: [] };
    }

    try {
      this.logger.log(`[EXPO PUSH] ========================================`);
      this.logger.log(`[EXPO PUSH] Sending multicast notification to ${tokens.length} token(s)`);
      this.logger.log(`[EXPO PUSH] Title: ${title}`);
      this.logger.log(
        `[EXPO PUSH] Body: ${body.substring(0, 100)}${body.length > 100 ? '...' : ''}`,
      );

      // Filter valid Expo tokens
      const validTokens = tokens.filter(token => Expo.isExpoPushToken(token));
      const invalidTokens = tokens.filter(token => !Expo.isExpoPushToken(token));

      if (invalidTokens.length > 0) {
        this.logger.warn(`[EXPO PUSH] ⚠️ Found ${invalidTokens.length} invalid Expo token(s)`);
        invalidTokens.forEach(token => {
          this.logger.warn(`[EXPO PUSH] Invalid token: ${String(token).substring(0, 30)}...`);
        });
      }

      this.logger.log(`[EXPO PUSH] Valid tokens: ${validTokens.length}`);

      if (validTokens.length === 0) {
        return { success: 0, failure: tokens.length, tickets: [], failedTokens: tokens };
      }

      // Determine Android notification channel based on data
      const importance = data?.importance || 'default';
      let channelId = 'default';
      let priority: 'default' | 'normal' | 'high' = 'high';

      if (importance === 'URGENT' || importance === 'HIGH') {
        channelId = 'high-priority';
        priority = 'high';
      } else if (importance === 'LOW') {
        channelId = 'low-priority';
        priority = 'normal';
      }

      // Build messages
      const messages: ExpoPushMessage[] = validTokens.map(token => ({
        to: token,
        sound: 'default',
        title,
        body,
        data: data || {},
        priority,
        channelId,
      }));

      // Chunk messages (Expo has a limit of 100 per request)
      const chunks = this.expo.chunkPushNotifications(messages);
      const tickets: ExpoPushTicket[] = [];

      this.logger.log(`[EXPO PUSH] Sending ${chunks.length} chunk(s)...`);

      // Send all chunks
      for (const chunk of chunks) {
        try {
          const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
        } catch (error) {
          this.logger.error(`[EXPO PUSH] Error sending chunk:`, error.message);
        }
      }

      // Analyze results
      let successCount = 0;
      let failureCount = 0;
      const failedTokens: string[] = [];

      tickets.forEach((ticket, index) => {
        if (ticket.status === 'ok') {
          successCount++;
          this.logger.log(
            `[EXPO PUSH] ✅ Token ${index + 1}: Success (${(ticket as ExpoPushSuccessTicket).id})`,
          );
        } else {
          failureCount++;
          const errorTicket = ticket as ExpoPushErrorTicket;
          failedTokens.push(validTokens[index]);
          this.logger.error(`[EXPO PUSH] ❌ Token ${index + 1}: Failed - ${errorTicket.message}`);
        }
      });

      // Add invalid tokens to failed count
      failureCount += invalidTokens.length;
      failedTokens.push(...invalidTokens);

      this.logger.log(`[EXPO PUSH] ========================================`);
      this.logger.log(`[EXPO PUSH] Multicast Result:`);
      this.logger.log(`[EXPO PUSH]   ✅ Success: ${successCount}`);
      this.logger.log(`[EXPO PUSH]   ❌ Failure: ${failureCount}`);
      this.logger.log(`[EXPO PUSH] ========================================`);

      return {
        success: successCount,
        failure: failureCount,
        tickets,
        failedTokens,
      };
    } catch (error) {
      this.logger.error(`[EXPO PUSH] ❌ Exception in multicast notification`);
      this.logger.error(`[EXPO PUSH] Error:`, error.message);
      this.logger.error(`[EXPO PUSH] Stack:`, error.stack);

      return {
        success: 0,
        failure: tokens.length,
        tickets: [],
        failedTokens: tokens,
      };
    }
  }

  /**
   * Check receipts for previously sent notifications
   * This allows you to verify if notifications were actually delivered
   */
  async getPushNotificationReceipts(receiptIds: string[]): Promise<any> {
    if (!this.expo) {
      return { receipts: {} };
    }

    try {
      const receiptIdChunks = this.expo.chunkPushNotificationReceiptIds(receiptIds);
      const receipts: any = {};

      for (const chunk of receiptIdChunks) {
        const chunkReceipts = await this.expo.getPushNotificationReceiptsAsync(chunk);
        Object.assign(receipts, chunkReceipts);
      }

      this.logger.log(`[EXPO PUSH] Retrieved ${Object.keys(receipts).length} receipt(s)`);
      return { receipts };
    } catch (error) {
      this.logger.error(`[EXPO PUSH] Error getting receipts:`, error.message);
      return { receipts: {}, error: error.message };
    }
  }
}
