import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { BaileysWhatsAppService } from '../../whatsapp/baileys-whatsapp.service';
import { WhatsAppMessageFormatterService, WhatsAppMessageFormat } from './whatsapp-message-formatter.service';
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
    @Inject('WhatsAppService')
    private readonly whatsappClient: BaileysWhatsAppService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly formatter: WhatsAppMessageFormatterService,
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
      const messageFormat = this.formatMessage(notification, user);

      // 6. Check rate limiting
      await this.checkRateLimit();

      // 7. Send the message (text-only for now - buttons disabled until properly tested)
      const textToSend = messageFormat.fallbackText || messageFormat.text;
      await this.whatsappClient.sendMessage(phoneValidation.formatted!, textToSend);

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
   * Creates a beautiful, professional message using the formatter service
   * Optimized for mobile viewing with clickable links and interactive buttons
   *
   * @param notification - The notification to format
   * @param user - The recipient user
   * @returns Formatted message with optional buttons
   */
  formatMessage(notification: Notification, user: User): WhatsAppMessageFormat {
    try {
      // Parse metadata
      let metadata: any = {};
      if (notification.metadata) {
        try {
          metadata =
            typeof notification.metadata === 'string'
              ? JSON.parse(notification.metadata)
              : notification.metadata;
        } catch (error) {
          this.logger.warn(`Failed to parse notification metadata: ${error.message}`);
        }
      }

      // Get the action URL
      const url = this.extractActionUrl(notification, metadata);

      // Build data object for formatter
      // For specific formatters, include all metadata plus url
      const data = {
        ...metadata,
        url,
      };

      // Use specific formatter based on notification type
      // Convert to string to handle both enum and string types
      const type = String(notification.type || '');

      // Task notifications
      if (type === 'task.created') {
        return this.formatter.formatTaskCreated(data);
      }
      if (type === 'task.status' || type === 'task.status.changed') {
        return this.formatter.formatTaskStatusChanged(data);
      }
      if (type === 'task.deadline' || type === 'task.deadline.approaching') {
        return this.formatter.formatTaskDeadlineApproaching(data);
      }
      if (type === 'task.overdue') {
        return this.formatter.formatTaskOverdue(data);
      }

      // Order notifications
      if (type === 'order.created') {
        return this.formatter.formatOrderCreated(data);
      }
      if (type === 'order.overdue') {
        return this.formatter.formatOrderOverdue(data);
      }

      // Stock notifications
      if (type === 'stock.low') {
        return this.formatter.formatStockLow(data);
      }
      if (type === 'stock.critical') {
        return this.formatter.formatStockCritical(data);
      }
      if (type === 'stock.out') {
        return this.formatter.formatStockOut(data);
      }
      if (type === 'stock.reorder' || type === 'item.needing.order') {
        return this.formatter.formatItemNeedingOrder(data);
      }

      // Service Order notifications
      if (type === 'service-order.created' || type === 'serviceOrder.created') {
        return this.formatter.formatServiceOrderCreated(data);
      }
      if (type === 'service-order.status.changed' || type === 'serviceOrder.status.changed') {
        return this.formatter.formatServiceOrderStatusChanged(data);
      }
      if (type === 'service-order.artwork-waiting-approval' || type === 'serviceOrder.artworkWaitingApproval') {
        return this.formatter.formatArtworkWaitingApproval(data);
      }

      // Fallback to generic formatter
      // Pass only the original metadata, not the data object with title/body
      return this.formatter.formatGenericNotification({
        title: notification.title || 'Notificação',
        body: notification.body || '',
        url,
        metadata, // Pass original metadata only
        importance: notification.importance as any,
      });
    } catch (error: any) {
      this.logger.error(`Error formatting WhatsApp message: ${error.message}`, error.stack);

      // Fallback to simple formatting if formatter fails
      return this.formatSimpleMessage(notification, user);
    }
  }

  /**
   * Extract action URL from notification
   * Handles various URL formats and sources
   *
   * Priority for WhatsApp (to support "open in app if installed, otherwise web"):
   * 1. universalLink (HTTPS URL that iOS/Android can intercept to open app)
   * 2. webUrl (full web URL - fallback for browser)
   * 3. web (from parsed JSON)
   * 4. fallback construction from relative path
   *
   * Universal links (https://domain.com/app/...) work because:
   * - If app is installed: iOS/Android intercepts and opens the app directly
   * - If app is not installed: Opens in browser, which handles the redirect
   */
  private extractActionUrl(notification: Notification, metadata: any): string {
    let actionUrlToUse = notification.actionUrl;

    // For WhatsApp, prefer universal links to support "open in app if installed"
    // Universal links are HTTPS URLs that iOS/Android can intercept
    // Priority: universalLink > webUrl > web (from JSON)
    if (metadata.universalLink) {
      actionUrlToUse = metadata.universalLink;
    } else if (metadata.webUrl) {
      actionUrlToUse = metadata.webUrl;
    } else if (metadata.url && metadata.url.startsWith('http')) {
      actionUrlToUse = metadata.url;
    }

    // If actionUrl is a JSON string, parse it and prefer universal link
    if (actionUrlToUse && actionUrlToUse.startsWith('{')) {
      try {
        const parsedUrl = JSON.parse(actionUrlToUse);
        // For WhatsApp, prefer universal link (opens app if installed, otherwise web)
        if (parsedUrl.universalLink) {
          actionUrlToUse = parsedUrl.universalLink;
        } else if (parsedUrl.web) {
          actionUrlToUse = parsedUrl.web;
        } else if (parsedUrl.mobile) {
          // Mobile URLs (custom scheme) won't work in WhatsApp browser
          // Skip and try to construct a web URL below
          actionUrlToUse = null;
        }
      } catch (error) {
        this.logger.warn(`Failed to parse actionUrl as JSON: ${error.message}`);
      }
    }

    // Build full URL if it's a relative path
    if (actionUrlToUse) {
      // Use WEB_APP_URL as the canonical base URL
      const baseUrl = process.env.WEB_APP_URL || process.env.WEB_BASE_URL || 'https://ankaadesign.com.br';

      // Check if URL is already complete (has protocol)
      if (!actionUrlToUse.startsWith('http://') && !actionUrlToUse.startsWith('https://')) {
        // Skip mobile scheme URLs - they won't work in WhatsApp
        if (actionUrlToUse.startsWith('ankaadesign://') || actionUrlToUse.includes('://')) {
          this.logger.warn(`Skipping non-HTTP URL for WhatsApp: ${actionUrlToUse}`);
          return '';
        }
        // If it looks like a domain (www.example.com), add https://
        if (actionUrlToUse.startsWith('www.') || actionUrlToUse.match(/^[a-z0-9-]+\.(com|br|net|org)/i)) {
          actionUrlToUse = `https://${actionUrlToUse}`;
        }
        // Otherwise, treat as relative path and prepend base URL
        else if (!actionUrlToUse.startsWith('/')) {
          actionUrlToUse = `${baseUrl}/${actionUrlToUse}`;
        } else {
          actionUrlToUse = `${baseUrl}${actionUrlToUse}`;
        }
      }
    }

    return actionUrlToUse || '';
  }

  /**
   * Simple message formatter - fallback when formatter service fails
   */
  private formatSimpleMessage(notification: Notification, user: User): WhatsAppMessageFormat {
    const lines: string[] = [];

    if (notification.title) {
      lines.push(`*${notification.title}*`);
      lines.push('');
    }

    if (notification.body) {
      lines.push(notification.body);
    }

    // Extract URL
    let metadata: any = {};
    try {
      metadata =
        typeof notification.metadata === 'string'
          ? JSON.parse(notification.metadata)
          : notification.metadata || {};
    } catch (error) {
      // Ignore parsing errors
    }

    const url = this.extractActionUrl(notification, metadata);
    const text = lines.join('\n');

    return {
      text,
      fallbackText: url ? `${text}\n\n🔗 ${url}` : text,
    };
  }

  /**
   * Validate and format phone number for WhatsApp
   * Intelligently handles Brazilian phone number formats and ensures
   * the number is properly formatted for WhatsApp API
   *
   * Brazilian phone number formats:
   * - 8 digits: Old landline format (XXXX-XXXX) - requires DDD
   * - 9 digits: Mobile without DDD (9XXXX-XXXX) - requires DDD
   * - 10 digits: Landline with DDD (XX XXXX-XXXX)
   * - 11 digits: Mobile with DDD (XX 9XXXX-XXXX)
   * - 12 digits: Landline with country code (55 XX XXXX-XXXX)
   * - 13 digits: Mobile with country code (55 XX 9XXXX-XXXX)
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

      // Format the phone number using the intelligent formatter
      const formattedPhone = this.formatBrazilianPhoneNumber(user.phone);

      if (!formattedPhone) {
        return {
          valid: false,
          error: 'Invalid phone number format. Expected Brazilian phone number with 10-13 digits.',
        };
      }

      // Validate the formatted number
      const validation = this.validateBrazilianPhoneNumber(formattedPhone);

      if (!validation.valid) {
        return {
          valid: false,
          error: validation.error,
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
   * Intelligently format a Brazilian phone number
   * Handles various input formats and normalizes to WhatsApp format (55XXXXXXXXXXX)
   *
   * @param phone - Raw phone number string
   * @returns Formatted phone number or null if invalid
   */
  private formatBrazilianPhoneNumber(phone: string): string | null {
    // Remove all non-digit characters
    let cleanPhone = phone.replace(/\D/g, '');

    // Remove leading zeros (some formats include 0 before DDD)
    cleanPhone = cleanPhone.replace(/^0+/, '');

    // Handle different lengths
    const length = cleanPhone.length;

    // Already has Brazil country code (55)
    if (cleanPhone.startsWith('55')) {
      // 12 digits: 55 + DDD (2) + landline (8) = valid
      // 13 digits: 55 + DDD (2) + mobile (9) = valid
      if (length === 12 || length === 13) {
        return cleanPhone;
      }
      // Invalid length with country code
      return null;
    }

    // No country code - need to add 55
    switch (length) {
      case 10:
        // Landline with DDD: XX XXXX-XXXX -> 55XXXXXXXXXX
        return `55${cleanPhone}`;

      case 11:
        // Mobile with DDD: XX 9XXXX-XXXX -> 55XXXXXXXXXXX
        // Verify it's a mobile number (3rd digit should be 9)
        if (cleanPhone.charAt(2) === '9') {
          return `55${cleanPhone}`;
        }
        // Could be a landline in some regions with extra digit, still valid
        return `55${cleanPhone}`;

      case 8:
        // Old landline format without DDD - cannot process without DDD
        this.logger.warn(
          `Phone number has only 8 digits (no DDD): ${this.maskPhoneNumber(cleanPhone)}`,
        );
        return null;

      case 9:
        // Mobile without DDD - cannot process without DDD
        this.logger.warn(
          `Phone number has only 9 digits (no DDD): ${this.maskPhoneNumber(cleanPhone)}`,
        );
        return null;

      default:
        // Invalid length
        this.logger.warn(
          `Phone number has invalid length (${length} digits): ${this.maskPhoneNumber(cleanPhone)}`,
        );
        return null;
    }
  }

  /**
   * Validate a formatted Brazilian phone number
   * Checks DDD validity and number format
   *
   * @param phone - Formatted phone number (with country code 55)
   * @returns Validation result
   */
  private validateBrazilianPhoneNumber(phone: string): { valid: boolean; error?: string } {
    // Must start with Brazil country code
    if (!phone.startsWith('55')) {
      return { valid: false, error: 'Phone number must have Brazil country code (55)' };
    }

    // Extract DDD (area code) - 2 digits after country code
    const ddd = phone.substring(2, 4);
    const dddNumber = parseInt(ddd, 10);

    // Valid Brazilian DDDs range from 11 to 99
    // Main DDDs: 11-19 (SP), 21-28 (RJ/ES), 31-38 (MG), 41-49 (PR/SC), 51-55 (RS),
    // 61-69 (DF/GO/MT/MS/AC/RO), 71-79 (BA/SE), 81-89 (PE/AL/PB/RN/CE/PI/MA), 91-99 (PA/AM/RR/AP)
    if (dddNumber < 11 || dddNumber > 99) {
      return { valid: false, error: `Invalid DDD (area code): ${ddd}` };
    }

    // Validate the local number part
    const localNumber = phone.substring(4);
    const localLength = localNumber.length;

    // Local number should be 8 (landline) or 9 (mobile) digits
    if (localLength !== 8 && localLength !== 9) {
      return { valid: false, error: `Invalid local number length: ${localLength} digits` };
    }

    // Mobile numbers should start with 9
    if (localLength === 9 && localNumber.charAt(0) !== '9') {
      return { valid: false, error: 'Mobile numbers must start with 9' };
    }

    // All validations passed
    return { valid: true };
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

      // Format the chat ID (use @s.whatsapp.net for Baileys multi-device)
      const chatId = `${phoneNumber}@s.whatsapp.net`;

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

    // 0. sendSeen/markedUnread errors - message was actually sent, no retry needed
    // These errors occur AFTER the message is delivered, during WhatsApp's internal "mark as seen" step
    if (
      errorMessage.includes('markedUnread') ||
      errorMessage.includes('sendSeen')
    ) {
      this.logger.log(
        `sendSeen error for delivery ${deliveryId} - message was sent successfully, no retry needed`,
      );
      // Update status to DELIVERED since the message was actually sent
      await this.handleDeliveryStatus({
        deliveryId,
        status: 'DELIVERED',
        deliveredAt: new Date(),
      });
      return false;
    }

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

    // 2.5. LID errors - WhatsApp internal issue, should not retry
    // This error occurs when WhatsApp doesn't have a Local ID mapping for the contact
    // Retrying won't help - the user needs to open the chat manually in WhatsApp Web
    if (
      errorMessage.includes('No LID for user') ||
      errorMessage.includes('Lid is missing') ||
      errorMessage.includes('Failed to send message to any phone variant')
    ) {
      this.logger.error(
        `WhatsApp LID error for delivery ${deliveryId}, will not retry: ${errorMessage}`,
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
      const metadata = (delivery.metadata as any) || {};
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
