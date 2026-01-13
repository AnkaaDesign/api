import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppService as WhatsAppClientService } from '../../whatsapp/whatsapp.service';
import { User, Notification } from '../../../../types';
import { NOTIFICATION_CHANNEL } from '../../../../constants';

/**
 * Interface for WhatsApp delivery result
 */
export interface WhatsAppDeliveryResult {
  success: boolean;
  messageId?: string;
  deliveredAt?: Date;
  error?: string;
}

/**
 * Interface for phone validation result
 */
export interface PhoneValidationResult {
  valid: boolean;
  formatted?: string;
  error?: string;
}

/**
 * Interface for user existence check
 */
export interface WhatsAppUserCheck {
  exists: boolean;
  phoneNumber?: string;
  error?: string;
}

/**
 * Interface for delivery status tracking
 */
export interface DeliveryStatusUpdate {
  deliveryId: string;
  status: 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'RETRYING';
  errorMessage?: string;
  deliveredAt?: Date;
}

/**
 * WhatsApp Notification Service
 * Handles sending notifications via WhatsApp with proper formatting,
 * validation, error handling, and delivery tracking
 */
@Injectable()
export class WhatsAppNotificationService {
  private readonly logger = new Logger(WhatsAppNotificationService.name);

  // Retry configuration
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_DELAY_MS = 5000; // 5 seconds
  private readonly RETRY_BACKOFF_MULTIPLIER = 2;

  // Rate limiting configuration
  private readonly RATE_LIMIT_PER_MINUTE = 20;
  private messageSentTimestamps: number[] = [];

  constructor(
    private readonly whatsappClient: WhatsAppClientService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Send notification via WhatsApp
   * Main entry point for sending WhatsApp notifications
   *
   * @param notification - The notification to send
   * @param user - The user to send to
   * @param deliveryId - The delivery record ID for tracking
   * @returns Promise<WhatsAppDeliveryResult>
   */
  async sendNotification(
    notification: Notification,
    user: User,
    deliveryId: string,
  ): Promise<WhatsAppDeliveryResult> {
    this.logger.log(
      `Attempting to send WhatsApp notification ${notification.id} to user ${user.id}`,
    );

    try {
      // 1. Check if WhatsApp client is ready
      if (!this.whatsappClient.isReady()) {
        throw new Error('WhatsApp client is not ready. Please check connection status.');
      }

      // 2. Check user preferences before sending (only for automated notifications)
      // Manual notifications (with explicit channels set) bypass user preferences
      const isManualNotification = notification.channel && notification.channel.length > 0;

      if (!isManualNotification) {
        const canSend = await this.checkUserPreferences(user.id, notification.type);
        if (!canSend) {
          this.logger.log(
            `User ${user.id} has disabled WhatsApp notifications for type ${notification.type}`,
          );
          return {
            success: false,
            error: 'User has disabled WhatsApp notifications for this type',
          };
        }
      } else {
        this.logger.log(
          `Sending manual notification ${notification.id} - bypassing user preferences`,
        );
      }

      // 3. Get and validate user's WhatsApp phone number
      const phoneValidation = await this.validatePhoneNumber(user);
      if (!phoneValidation.valid) {
        throw new Error(phoneValidation.error || 'Invalid phone number');
      }

      // 4. Check if user exists on WhatsApp (optional check - errors are handled gracefully)
      const userCheck = await this.checkUserExists(phoneValidation.formatted!);
      if (!userCheck.exists && userCheck.error && !userCheck.error.includes('check error')) {
        // Only throw error if it's a definitive "not registered" error
        // Skip errors from the check itself (client issues, frame errors, etc.)
        throw new Error(userCheck.error);
      }

      // 5. Format the notification message
      const message = this.formatMessage(notification, user);

      // 6. Check rate limiting
      await this.checkRateLimit();

      // 7. Send the message
      await this.whatsappClient.sendMessage(phoneValidation.formatted!, message);

      // 8. Track delivery status
      const deliveredAt = new Date();
      await this.handleDeliveryStatus({
        deliveryId,
        status: 'DELIVERED',
        deliveredAt,
      });

      // 9. Emit success event
      this.eventEmitter.emit('whatsapp.notification.sent', {
        notificationId: notification.id,
        userId: user.id,
        phoneNumber: this.maskPhoneNumber(phoneValidation.formatted!),
        deliveryId,
        deliveredAt,
      });

      this.logger.log(
        `WhatsApp notification ${notification.id} sent successfully to user ${user.id}`,
      );

      return {
        success: true,
        deliveredAt,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to send WhatsApp notification ${notification.id} to user ${user.id}: ${error.message}`,
        error.stack,
      );

      // Handle the error and determine if retry is needed
      const shouldRetry = await this.handleErrors(error, deliveryId);

      if (shouldRetry) {
        // Queue for retry
        await this.queueRetry(notification, user, deliveryId);
      } else {
        // Mark as failed permanently
        await this.handleDeliveryStatus({
          deliveryId,
          status: 'FAILED',
          errorMessage: error.message,
        });
      }

      // Emit failure event
      this.eventEmitter.emit('whatsapp.notification.failed', {
        notificationId: notification.id,
        userId: user.id,
        deliveryId,
        error: error.message,
        failedAt: new Date(),
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Format notification as WhatsApp message
   * Creates a well-formatted message suitable for WhatsApp
   * Optimized for mobile viewing with clickable links
   *
   * @param notification - The notification to format
   * @param user - The recipient user
   * @returns Formatted message string
   */
  formatMessage(notification: Notification, user: User): string {
    // Build the message with proper formatting
    const lines: string[] = [];

    // Add title with emphasis (no greeting - straight to the point)
    if (notification.title) {
      lines.push(`*${notification.title}*`);
      lines.push('');
    }

    // Add message body
    if (notification.body) {
      lines.push(notification.body);
    }

    // Add metadata if available (optional fields)
    if (notification.metadata) {
      try {
        const metadata =
          typeof notification.metadata === 'string'
            ? JSON.parse(notification.metadata)
            : notification.metadata;

        // Add custom fields from metadata
        if (metadata.description) {
          lines.push('');
          lines.push(`_${metadata.description}_`);
        }

        if (metadata.dueDate) {
          lines.push('');
          lines.push(`*Prazo:* ${new Date(metadata.dueDate).toLocaleDateString('pt-BR')}`);
        }

        if (metadata.priority) {
          const priorityEmoji = this.getPriorityEmoji(metadata.priority);
          lines.push(`*Prioridade:* ${priorityEmoji} ${metadata.priority}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to parse notification metadata: ${error.message}`);
      }
    }

    // Add action URL as a clickable link (full URL for mobile deep linking)
    // Prefer universal link or mobile URL for WhatsApp (opens in mobile app)
    let actionUrlToUse = notification.actionUrl;

    // First, try to extract from metadata (preferred source)
    if (notification.metadata) {
      try {
        const metadata =
          typeof notification.metadata === 'string'
            ? JSON.parse(notification.metadata)
            : notification.metadata;

        // Prefer universal link (HTTPS URL that opens mobile app) for WhatsApp
        // Falls back to mobile deep link, then to web URL
        if (metadata.universalLink) {
          actionUrlToUse = metadata.universalLink;
        } else if (metadata.mobileUrl) {
          actionUrlToUse = metadata.mobileUrl;
        }
      } catch (error) {
        this.logger.warn(`Failed to extract mobile URL from metadata: ${error.message}`);
      }
    }

    // If actionUrl is still a JSON string (from generateNotificationActionUrl), parse it
    // This handles cases where metadata doesn't have universalLink but actionUrl is the JSON object
    if (actionUrlToUse && actionUrlToUse.startsWith('{')) {
      try {
        const parsedUrl = JSON.parse(actionUrlToUse);
        // Prefer universal link for WhatsApp (works on both web and mobile)
        if (parsedUrl.universalLink) {
          actionUrlToUse = parsedUrl.universalLink;
        } else if (parsedUrl.mobile) {
          actionUrlToUse = parsedUrl.mobile;
        } else if (parsedUrl.web) {
          actionUrlToUse = parsedUrl.web;
        }
      } catch (error) {
        this.logger.warn(`Failed to parse actionUrl as JSON: ${error.message}`);
      }
    }

    if (actionUrlToUse) {
      const baseUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'https://app.ankaa.com.br';
      let fullUrl = actionUrlToUse;

      // Build full URL if it's a relative path
      if (!actionUrlToUse.startsWith('http') && !actionUrlToUse.includes('://')) {
        fullUrl = `${baseUrl}${actionUrlToUse}`;
      }

      lines.push('');
      lines.push(`🔗 ${fullUrl}`);
    }

    // No footer - clean and simple message

    return lines.join('\n');
  }

  /**
   * Validate and format phone number
   * Ensures phone number is in the correct format for WhatsApp
   *
   * @param user - The user whose phone number to validate
   * @returns Promise<PhoneValidationResult>
   */
  async validatePhoneNumber(user: User): Promise<PhoneValidationResult> {
    try {
      // Check if user has a phone number
      if (!user.phone) {
        return {
          valid: false,
          error: 'User has no phone number registered',
        };
      }

      // Remove all non-digit characters
      const cleanPhone = user.phone.replace(/\D/g, '');

      // Basic validation - phone should be 10-15 digits
      if (cleanPhone.length < 10 || cleanPhone.length > 15) {
        return {
          valid: false,
          error: 'Phone number must be between 10 and 15 digits',
        };
      }

      // Format the phone number
      // If it doesn't start with country code, assume Brazil (+55)
      let formattedPhone = cleanPhone;
      if (!formattedPhone.startsWith('55') && cleanPhone.length <= 11) {
        formattedPhone = `55${cleanPhone}`;
      }

      // Validate format with regex
      const phoneRegex = /^\d{10,15}$/;
      if (!phoneRegex.test(formattedPhone)) {
        return {
          valid: false,
          error: 'Invalid phone number format',
        };
      }

      this.logger.log(
        `Phone number validated successfully for user ${user.id}: ${this.maskPhoneNumber(formattedPhone)}`,
      );

      return {
        valid: true,
        formatted: formattedPhone,
      };
    } catch (error: any) {
      this.logger.error(`Error validating phone number for user ${user.id}: ${error.message}`);
      return {
        valid: false,
        error: `Phone validation error: ${error.message}`,
      };
    }
  }

  /**
   * Check if WhatsApp user exists
   * Verifies that the phone number is registered on WhatsApp
   *
   * @param phoneNumber - The formatted phone number to check
   * @returns Promise<WhatsAppUserCheck>
   */
  async checkUserExists(phoneNumber: string): Promise<WhatsAppUserCheck> {
    try {
      // Check if client is ready
      if (!this.whatsappClient.isReady()) {
        // If client is not ready, skip check and assume user exists
        // We'll get an error when trying to send if they don't
        this.logger.warn('WhatsApp client not ready, skipping user existence check');
        return {
          exists: true,
          phoneNumber,
        };
      }

      // Format the chat ID
      const chatId = `${phoneNumber}@c.us`;

      // Check if the number is registered on WhatsApp
      const client = (this.whatsappClient as any).client;
      if (!client) {
        // If client is not initialized, skip check and assume user exists
        this.logger.warn('WhatsApp client not initialized, skipping user existence check');
        return {
          exists: true,
          phoneNumber,
        };
      }

      try {
        const isRegistered = await client.isRegisteredUser(chatId);

        if (!isRegistered) {
          this.logger.warn(
            `Phone number ${this.maskPhoneNumber(phoneNumber)} is not registered on WhatsApp`,
          );
          return {
            exists: false,
            error: 'Phone number is not registered on WhatsApp',
          };
        }

        this.logger.log(`WhatsApp user exists for phone ${this.maskPhoneNumber(phoneNumber)}`);

        return {
          exists: true,
          phoneNumber,
        };
      } catch (registrationError: any) {
        // If isRegisteredUser fails (e.g., "No LID for user"), log warning but proceed
        // We'll attempt to send the message anyway and handle the error there
        this.logger.warn(
          `Could not verify registration for ${this.maskPhoneNumber(phoneNumber)}: ${registrationError.message}. Will attempt to send anyway.`,
        );
        return {
          exists: true,
          phoneNumber,
        };
      }
    } catch (error: any) {
      this.logger.warn(
        `Error checking WhatsApp user existence for ${this.maskPhoneNumber(phoneNumber)}: ${error.message}. Will attempt to send anyway.`,
      );
      // Return true to allow message sending attempt
      return {
        exists: true,
        phoneNumber,
      };
    }
  }

  /**
   * Track message delivery status
   * Updates the delivery record in the database
   *
   * @param update - The delivery status update
   */
  async handleDeliveryStatus(update: DeliveryStatusUpdate): Promise<void> {
    try {
      this.logger.log(`Updating delivery status for ${update.deliveryId} to ${update.status}`);

      await this.prisma.notificationDelivery.update({
        where: { id: update.deliveryId },
        data: {
          status: update.status as any,
          errorMessage: update.errorMessage || null,
          sentAt: update.status === 'PROCESSING' ? new Date() : undefined,
          deliveredAt: update.deliveredAt || null,
          failedAt: update.status === 'FAILED' ? new Date() : null,
        },
      });

      // Emit tracking event
      this.eventEmitter.emit('whatsapp.delivery.status.updated', {
        deliveryId: update.deliveryId,
        status: update.status,
        timestamp: new Date(),
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to update delivery status for ${update.deliveryId}: ${error.message}`,
        error.stack,
      );
      // Don't throw - we don't want delivery tracking failures to break the flow
    }
  }

  /**
   * Handle WhatsApp errors
   * Determines error type and whether retry should be attempted
   *
   * @param error - The error that occurred
   * @param deliveryId - The delivery record ID
   * @returns Promise<boolean> - true if retry should be attempted
   */
  async handleErrors(error: any, deliveryId: string): Promise<boolean> {
    const errorMessage = error.message || error.toString();

    // Categorize errors and determine retry strategy

    // 1. Client not ready errors - should retry
    if (
      errorMessage.includes('not ready') ||
      errorMessage.includes('disconnected') ||
      errorMessage.includes('session')
    ) {
      this.logger.warn(
        `WhatsApp client error for delivery ${deliveryId}, will retry: ${errorMessage}`,
      );
      return true;
    }

    // 2. User not found errors - should not retry
    if (
      errorMessage.includes('not registered') ||
      errorMessage.includes('invalid phone') ||
      errorMessage.includes('no phone number')
    ) {
      this.logger.error(
        `User/phone error for delivery ${deliveryId}, will not retry: ${errorMessage}`,
      );
      return false;
    }

    // 3. Rate limit errors - should retry after delay
    if (errorMessage.includes('rate limit')) {
      this.logger.warn(`Rate limit error for delivery ${deliveryId}, will retry: ${errorMessage}`);
      return true;
    }

    // 4. User preferences disabled - should not retry
    if (errorMessage.includes('disabled')) {
      this.logger.log(
        `User preferences error for delivery ${deliveryId}, will not retry: ${errorMessage}`,
      );
      return false;
    }

    // 5. Network/temporary errors - should retry
    if (
      errorMessage.includes('timeout') ||
      errorMessage.includes('network') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ETIMEDOUT')
    ) {
      this.logger.warn(`Network error for delivery ${deliveryId}, will retry: ${errorMessage}`);
      return true;
    }

    // 6. Unknown errors - retry once to be safe
    this.logger.warn(`Unknown error for delivery ${deliveryId}, will retry once: ${errorMessage}`);
    return true;
  }

  /**
   * Queue retry for failed messages
   * Implements exponential backoff retry strategy
   *
   * @param notification - The notification to retry
   * @param user - The recipient user
   * @param deliveryId - The delivery record ID
   */
  private async queueRetry(
    notification: Notification,
    user: User,
    deliveryId: string,
  ): Promise<void> {
    try {
      // Get current retry count
      const delivery = await this.prisma.notificationDelivery.findUnique({
        where: { id: deliveryId },
      });

      if (!delivery) {
        this.logger.error(`Delivery record ${deliveryId} not found`);
        return;
      }

      // Get retry count from metadata
      const metadata = delivery.metadata as any || {};
      const retryCount = metadata.retryCount || 0;

      // Check if max retries exceeded
      if (retryCount >= this.MAX_RETRY_ATTEMPTS) {
        this.logger.warn(
          `Max retry attempts (${this.MAX_RETRY_ATTEMPTS}) reached for delivery ${deliveryId}`,
        );
        await this.handleDeliveryStatus({
          deliveryId,
          status: 'FAILED',
          errorMessage: 'Max retry attempts exceeded',
        });
        return;
      }

      // Update status to retrying
      await this.handleDeliveryStatus({
        deliveryId,
        status: 'RETRYING',
      });

      // Calculate retry delay with exponential backoff
      const delay = this.RETRY_DELAY_MS * Math.pow(this.RETRY_BACKOFF_MULTIPLIER, retryCount);

      this.logger.log(
        `Queueing retry ${retryCount + 1}/${this.MAX_RETRY_ATTEMPTS} for delivery ${deliveryId} in ${delay}ms`,
      );

      // Update retry count in metadata
      await this.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          metadata: {
            ...metadata,
            retryCount: retryCount + 1,
          },
        },
      });

      // Schedule retry
      setTimeout(async () => {
        this.logger.log(`Retrying delivery ${deliveryId}`);
        await this.sendNotification(notification, user, deliveryId);
      }, delay);

      // Emit retry event
      this.eventEmitter.emit('whatsapp.notification.retry', {
        notificationId: notification.id,
        userId: user.id,
        deliveryId,
        retryCount: retryCount + 1,
        delay,
        timestamp: new Date(),
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to queue retry for delivery ${deliveryId}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Check user preferences before sending
   *
   * @param userId - The user ID
   * @param notificationType - The notification type
   * @returns Promise<boolean> - true if user accepts WhatsApp notifications
   */
  private async checkUserPreferences(userId: string, notificationType: string): Promise<boolean> {
    try {
      // Check if user has specific preferences for this notification type
      const userPreference = await this.prisma.userNotificationPreference.findFirst({
        where: {
          userId,
          notificationType: notificationType as any,
        },
      });

      // If user has preferences, check if WhatsApp is enabled
      if (userPreference) {
        // If disabled entirely, return false
        if (!userPreference.enabled) {
          return false;
        }

        // Check if WhatsApp channel is in the enabled channels
        const channels = userPreference.channels as any[];
        return channels.includes(NOTIFICATION_CHANNEL.WHATSAPP);
      }

      // If no user preference, check global default
      const defaultPreference = await this.prisma.notificationPreference.findFirst({
        where: {
          notificationType: notificationType as any,
        },
      });

      if (defaultPreference) {
        if (!defaultPreference.enabled) {
          return false;
        }

        const channels = defaultPreference.channels as any[];
        return channels.includes(NOTIFICATION_CHANNEL.WHATSAPP);
      }

      // If no preferences found, default to false (opt-in approach for WhatsApp)
      return false;
    } catch (error: any) {
      this.logger.error(`Error checking user preferences for user ${userId}: ${error.message}`);
      // On error, default to false to be safe
      return false;
    }
  }

  /**
   * Check rate limiting to prevent spam
   * Implements a simple sliding window rate limiter
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove timestamps older than 1 minute
    this.messageSentTimestamps = this.messageSentTimestamps.filter(
      timestamp => timestamp > oneMinuteAgo,
    );

    // Check if rate limit exceeded
    if (this.messageSentTimestamps.length >= this.RATE_LIMIT_PER_MINUTE) {
      const oldestTimestamp = this.messageSentTimestamps[0];
      const waitTime = oldestTimestamp + 60000 - now;

      this.logger.warn(
        `Rate limit exceeded. Wait ${Math.ceil(waitTime / 1000)} seconds before sending more messages.`,
      );

      throw new Error(
        `Rate limit exceeded. Maximum ${this.RATE_LIMIT_PER_MINUTE} messages per minute. Please try again in ${Math.ceil(waitTime / 1000)} seconds.`,
      );
    }

    // Add current timestamp
    this.messageSentTimestamps.push(now);
  }

  /**
   * Mask phone number for privacy in logs
   * In development mode, shows full number for debugging
   *
   * @param phone - The phone number to mask
   * @returns Masked phone number (or full number in dev mode)
   */
  private maskPhoneNumber(phone: string): string {
    // Show full number in development mode for debugging
    if (process.env.NODE_ENV === 'development') {
      return phone;
    }

    if (phone.length <= 4) return phone;
    const start = phone.slice(0, 2);
    const end = phone.slice(-2);
    const middle = '*'.repeat(phone.length - 4);
    return `${start}${middle}${end}`;
  }

  /**
   * Get emoji for priority level
   *
   * @param priority - The priority level
   * @returns Emoji string
   */
  private getPriorityEmoji(priority: string): string {
    const priorityMap: { [key: string]: string } = {
      URGENT: '🔴',
      HIGH: '🟠',
      MEDIUM: '🟡',
      LOW: '🟢',
      CRITICAL: '🚨',
    };

    return priorityMap[priority.toUpperCase()] || '📌';
  }

  /**
   * Send bulk WhatsApp notifications
   * Useful for sending to multiple users
   *
   * @param notifications - Array of notification/user/deliveryId tuples
   * @returns Promise with results
   */
  async sendBulkNotifications(
    notifications: Array<{
      notification: Notification;
      user: User;
      deliveryId: string;
    }>,
  ): Promise<{ success: number; failed: number }> {
    this.logger.log(`Sending ${notifications.length} bulk WhatsApp notifications`);

    const results = await Promise.allSettled(
      notifications.map(({ notification, user, deliveryId }) =>
        this.sendNotification(notification, user, deliveryId),
      ),
    );

    const success = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - success;

    this.logger.log(
      `Bulk WhatsApp notifications completed: ${success} succeeded, ${failed} failed`,
    );

    return { success, failed };
  }
}
