import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Notification, User, NotificationPreference } from '../../../types';
import {
  NOTIFICATION_CHANNEL,
  SECTOR_PRIVILEGES,
  NOTIFICATION_TYPE,
  ENTITY_TYPE,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
} from '../../../constants';
import { Prisma } from '@prisma/client';

// Import services (these need to be created separately or already exist)
import { EmailService } from '../mailer/services/email.service';
import { NotificationQueueService } from './notification-queue.service';
import { NotificationGatewayService } from './notification-gateway.service';
import { PushService } from '../push/push.service';
import { BaileysWhatsAppService } from '../whatsapp/baileys-whatsapp.service';
import { NotificationFilterService } from './notification-filter.service';
import { NotificationAggregationService } from './notification-aggregation.service';

/**
 * Delivery status enum matching Prisma schema
 */
export enum DELIVERY_STATUS {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
}

/**
 * Interface for notification queue jobs
 */
export interface NotificationQueueJob {
  notificationId: string;
  deliveryId: string;
  channel: NOTIFICATION_CHANNEL;
  userId: string;
  attempts: number;
}

/**
 * Interface for channel delivery result
 */
export interface ChannelDeliveryResult {
  channel: NOTIFICATION_CHANNEL;
  success: boolean;
  deliveryId?: string;
  error?: string;
}

/**
 * Core notification dispatch orchestrator service
 * This service coordinates all notification channels and manages the entire dispatch workflow
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: NotificationQueueService,
    private readonly gatewayService: NotificationGatewayService,
    private readonly emailService: EmailService,
    private readonly pushService: PushService,
    @Inject('WhatsAppService')
    private readonly whatsappService: BaileysWhatsAppService,
    private readonly eventEmitter: EventEmitter2,
    private readonly filterService: NotificationFilterService,
    private readonly aggregationService: NotificationAggregationService,
  ) {}

  /**
   * Main dispatch method - orchestrates the entire notification delivery process
   *
   * @param notificationId - The ID of the notification to dispatch
   * @throws NotFoundException if notification doesn't exist
   * @throws InternalServerErrorException if dispatch fails critically
   */
  async dispatchNotification(notificationId: string): Promise<void> {
    this.logger.log(`Starting notification dispatch for ID: ${notificationId}`);

    try {
      // 1. Load notification from database with necessary relations
      const notification = await this.loadNotification(notificationId);

      if (!notification) {
        throw new NotFoundException(`Notification with ID ${notificationId} not found`);
      }

      // 2. Check if already sent
      if (notification.sentAt) {
        this.logger.warn(
          `Notification ${notificationId} was already sent at ${notification.sentAt}`,
        );
        return;
      }

      // 3. Check if scheduled for future
      if (notification.scheduledAt && new Date(notification.scheduledAt) > new Date()) {
        this.logger.log(
          `Notification ${notificationId} is scheduled for ${notification.scheduledAt}, skipping dispatch`,
        );
        return;
      }

      // 3.5. Check work hours restriction (7:30 - 18:00)
      // Only apply to non-urgent notifications to allow critical alerts
      if (
        notification.importance !== 'URGENT' &&
        !this.isWithinWorkHours()
      ) {
        const nextWorkHourStart = this.getNextWorkHourStart();
        this.logger.warn(
          `Notification ${notificationId} blocked - outside work hours (7:30-18:00). ` +
          `Rescheduling for ${nextWorkHourStart.toISOString()}`,
        );

        // Reschedule for next work period
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: { scheduledAt: nextWorkHourStart },
        });

        return;
      }

      // 4. Determine target users based on sectors/privileges
      const targetUsers = await this.getTargetUsers(notification);

      if (targetUsers.length === 0) {
        this.logger.warn(`No target users found for notification ${notificationId}`);
        // Mark as sent even though no users (to avoid re-processing)
        await this.updateNotificationSentAt(notificationId);
        return;
      }

      this.logger.log(
        `Found ${targetUsers.length} target users for notification ${notificationId}`,
      );

      // 5. Process each user and dispatch to their preferred channels
      const deliveryResults: ChannelDeliveryResult[] = [];

      for (const user of targetUsers) {
        try {
          const userDeliveryResults = await this.dispatchToUser(notification, user);
          deliveryResults.push(...userDeliveryResults);
        } catch (error) {
          this.logger.error(
            `Failed to dispatch notification to user ${user.id}: ${error.message}`,
            error.stack,
          );
          // Continue with other users even if one fails
        }
      }

      // 6. Update notification as sent
      await this.updateNotificationSentAt(notificationId);

      // 7. Emit event for notification dispatched
      this.eventEmitter.emit('notification.dispatched', {
        notificationId,
        targetUserCount: targetUsers.length,
        deliveryResults,
        dispatchedAt: new Date(),
      });

      this.logger.log(
        `Successfully dispatched notification ${notificationId} to ${targetUsers.length} users`,
      );
    } catch (error) {
      this.logger.error(
        `Critical error dispatching notification ${notificationId}: ${error.message}`,
        error.stack,
      );

      // Emit failure event
      this.eventEmitter.emit('notification.dispatch.failed', {
        notificationId,
        error: error.message,
        failedAt: new Date(),
      });

      throw new InternalServerErrorException(`Failed to dispatch notification: ${error.message}`);
    }
  }

  /**
   * Dispatch notification to a specific user across their preferred channels
   */
  private async dispatchToUser(
    notification: Notification,
    user: User,
  ): Promise<ChannelDeliveryResult[]> {
    this.logger.log(`Dispatching notification ${notification.id} to user ${user.id}`);

    const results: ChannelDeliveryResult[] = [];

    // 1. Determine channels to use
    // If notification has explicit channels set (e.g., from admin), use those
    // Otherwise, get user's preferred channels based on preferences
    let channels: NOTIFICATION_CHANNEL[];

    if (notification.channel && notification.channel.length > 0) {
      this.logger.log(
        `Using notification-specified channels for user ${user.id}: ${notification.channel.join(', ')}`,
      );
      channels = notification.channel as NOTIFICATION_CHANNEL[];
    } else {
      channels = await this.getUserChannels(
        user.id,
        notification.type,
        notification.actionType || undefined,
      );
    }

    if (channels.length === 0) {
      this.logger.log(
        `User ${user.id} has no enabled channels for notification type ${notification.type}`,
      );
      return results;
    }

    this.logger.log(
      `User ${user.id} will receive notification via channels: ${channels.join(', ')}`,
    );

    // 2. Dispatch to each channel with error isolation
    for (const channel of channels) {
      try {
        const result = await this.dispatchToChannel(notification, user, channel);
        results.push(result);
      } catch (error) {
        this.logger.error(
          `Failed to dispatch to channel ${channel} for user ${user.id}: ${error.message}`,
          error.stack,
        );

        // Create failed delivery record
        const deliveryId = await this.createDeliveryRecord(
          notification.id,
          channel,
          DELIVERY_STATUS.FAILED,
          error.message,
        );

        results.push({
          channel,
          success: false,
          deliveryId,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Dispatch notification to a specific channel
   */
  private async dispatchToChannel(
    notification: Notification,
    user: User,
    channel: NOTIFICATION_CHANNEL,
  ): Promise<ChannelDeliveryResult> {
    this.logger.log('Dispatching notification to channel', {
      notificationId: notification.id,
      userId: user.id,
      channel,
      deliveryAttempt: 1,
    });

    // Create delivery record
    const deliveryId = await this.createDeliveryRecord(
      notification.id,
      channel,
      DELIVERY_STATUS.PENDING,
    );

    this.logger.debug('Delivery record created', {
      deliveryId,
      notificationId: notification.id,
      channel,
      status: DELIVERY_STATUS.PENDING,
    });

    try {
      // Route to appropriate channel handler
      switch (channel) {
        case NOTIFICATION_CHANNEL.IN_APP:
          await this.handleInAppChannel(notification, user, deliveryId);
          break;

        case NOTIFICATION_CHANNEL.EMAIL:
          await this.handleEmailChannel(notification, user, deliveryId);
          break;

        case NOTIFICATION_CHANNEL.WHATSAPP:
          await this.handleWhatsAppChannel(notification, user, deliveryId);
          break;

        case NOTIFICATION_CHANNEL.PUSH:
          // Push - sends to all registered devices (mobile + desktop)
          await this.handlePushChannel(notification, user, deliveryId);
          break;

        default:
          this.logger.error('Unsupported notification channel', {
            channel,
            notificationId: notification.id,
          });
          throw new Error(`Unsupported notification channel: ${channel}`);
      }

      this.logger.log('Notification delivered successfully', {
        notificationId: notification.id,
        userId: user.id,
        channel,
        deliveryId,
      });

      return {
        channel,
        success: true,
        deliveryId,
      };
    } catch (error) {
      this.logger.error('Delivery failed', {
        notificationId: notification.id,
        userId: user.id,
        channel,
        deliveryId,
        error: error.message,
        stack: error.stack,
      });

      // Update delivery record with failure
      await this.updateDeliveryStatus(deliveryId, DELIVERY_STATUS.FAILED, error.message);

      throw error;
    }
  }

  /**
   * Handle IN_APP channel - send immediately via WebSocket
   */
  private async handleInAppChannel(
    notification: Notification,
    user: User,
    deliveryId: string,
  ): Promise<void> {
    this.logger.log(`Sending in-app notification ${notification.id} to user ${user.id}`);

    await this.updateDeliveryStatus(deliveryId, DELIVERY_STATUS.PROCESSING);

    try {
      this.gatewayService.sendToUser(user.id, notification);

      await this.updateDeliveryStatus(deliveryId, DELIVERY_STATUS.DELIVERED, null, new Date());
    } catch (error) {
      await this.updateDeliveryStatus(deliveryId, DELIVERY_STATUS.FAILED, error.message);
      throw error;
    }
  }

  /**
   * Handle EMAIL channel - queue for async processing
   */
  private async handleEmailChannel(
    notification: Notification,
    user: User,
    deliveryId: string,
  ): Promise<void> {
    this.logger.log(`Queueing email notification ${notification.id} for user ${user.id}`);

    if (!user.email) {
      throw new Error(`User ${user.id} has no email address`);
    }

    await this.queueService.queueNotificationJob({
      notificationId: notification.id,
      deliveryId,
      channel: NOTIFICATION_CHANNEL.EMAIL,
      userId: user.id,
      attempts: 0,
    });

    await this.updateDeliveryStatus(deliveryId, DELIVERY_STATUS.PROCESSING);
  }

  /**
   * Handle WHATSAPP channel - queue for async processing
   */
  private async handleWhatsAppChannel(
    notification: Notification,
    user: User,
    deliveryId: string,
  ): Promise<void> {
    this.logger.log(`Queueing WhatsApp notification ${notification.id} for user ${user.id}`);

    if (!user.phone) {
      throw new Error(`User ${user.id} has no phone number for WhatsApp`);
    }

    await this.queueService.queueNotificationJob({
      notificationId: notification.id,
      deliveryId,
      channel: NOTIFICATION_CHANNEL.WHATSAPP,
      userId: user.id,
      attempts: 0,
    });

    await this.updateDeliveryStatus(deliveryId, DELIVERY_STATUS.PROCESSING);
  }

  /**
   * Handle PUSH channel - queue for async processing (handles both mobile and desktop)
   */
  private async handlePushChannel(
    notification: Notification,
    user: User,
    deliveryId: string,
  ): Promise<void> {
    this.logger.log(`Queueing push notification ${notification.id} for user ${user.id}`);

    await this.queueService.queueNotificationJob({
      notificationId: notification.id,
      deliveryId,
      channel: NOTIFICATION_CHANNEL.PUSH,
      userId: user.id,
      attempts: 0,
    });

    await this.updateDeliveryStatus(deliveryId, DELIVERY_STATUS.PROCESSING);
  }

  /**
   * Load notification from database with necessary relations
   */
  private async loadNotification(notificationId: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: {
        user: true,
        seenBy: {
          include: {
            user: true,
          },
        },
      },
    }) as Promise<Notification | null>;
  }

  /**
   * Get target users for a notification based on sectors and privileges
   *
   * Logic:
   * - If notification has userId, only send to that specific user
   * - If notification has no userId, it's a broadcast/system notification
   * - For broadcast, determine targets based on notification metadata
   *
   * @param notification - The notification to get targets for
   * @returns Array of target users
   */
  async getTargetUsers(notification: Notification): Promise<User[]> {
    try {
      // Case 1: Notification targeted to specific user
      if (notification.userId) {
        const user = await this.prisma.user.findUnique({
          where: { id: notification.userId },
          include: {
            sector: true,
            position: true,
            preference: true,
          },
        });

        if (!user) {
          this.logger.warn(
            `Target user ${notification.userId} not found for notification ${notification.id}`,
          );
          return [];
        }

        // Check if user is eligible
        if (!this.isUserEligible(user as User, notification)) {
          this.logger.log(`User ${user.id} is not eligible for notification ${notification.id}`);
          return [];
        }

        return [user as User];
      }

      // Case 2: Broadcast notification - determine targets based on metadata
      // For now, we'll implement basic logic. This can be extended based on your needs

      // Get all active users
      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
        },
        include: {
          sector: true,
          position: true,
          preference: true,
        },
      });

      // Filter users based on eligibility
      let eligibleUsers = users.filter(user => this.isUserEligible(user as User, notification)) as User[];

      // ✅ CRITICAL: Filter out the actor (user who performed the action)
      // Users should NEVER receive notifications for their own actions
      const actorId = this.extractActorId(notification);
      if (actorId) {
        const initialCount = eligibleUsers.length;
        eligibleUsers = eligibleUsers.filter(user => user.id !== actorId);

        if (eligibleUsers.length < initialCount) {
          this.logger.log(
            `Filtered out actor ${actorId} from notification ${notification.id} recipients (self-action)`,
          );
        }
      }

      return eligibleUsers;
    } catch (error) {
      this.logger.error(
        `Error getting target users for notification ${notification.id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Extract actor ID from notification metadata
   * The actor is the user who performed the action that triggered the notification
   *
   * @param notification - The notification to extract actor from
   * @returns Actor user ID or null if not found
   */
  private extractActorId(notification: Notification): string | null {
    const metadata = notification.metadata as any;

    if (!metadata) {
      return null;
    }

    // Try multiple possible fields where actor ID might be stored
    return (
      metadata.actorId ||
      metadata.userId ||
      metadata.changedById ||
      metadata.task?.createdById ||
      metadata.cut?.createdById ||
      metadata.order?.createdById ||
      metadata.vacation?.userId ||
      metadata.warning?.userId ||
      metadata.ppe?.userId ||
      null
    );
  }

  /**
   * Check if notification should be sent to a specific user
   * Combines user preference checks and role-based filtering
   *
   * @param user - The user to check
   * @param notification - The notification to check
   * @returns true if notification should be sent to user
   */
  async shouldSendToUser(user: User, notification: Notification): Promise<boolean> {
    try {
      // 1. User must be active
      if (!user.isActive) {
        this.logger.debug(`User ${user.id} is not active, skipping notification`);
        return false;
      }

      // 2. Check role-based filtering
      if (!this.filterByRole(user, notification)) {
        this.logger.debug(
          `User ${user.id} does not have required role for notification type ${notification.type}`,
        );
        return false;
      }

      // 3. Check user preferences
      const channels = await this.getUserChannels(
        user.id,
        notification.type,
        notification.actionType || undefined,
      );

      if (channels.length === 0) {
        this.logger.debug(
          `User ${user.id} has disabled all channels for notification type ${notification.type}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Error checking if notification should be sent to user ${user.id}: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Filter users by role/sector privileges
   * Uses NotificationFilterService to determine if user should receive notification
   *
   * @param user - The user to check
   * @param notification - The notification to check
   * @returns true if user has required role/privileges
   */
  filterByRole(user: User, notification: Notification): boolean {
    try {
      // Use the filter service to check if user can receive this notification
      return this.filterService.canUserReceive(user, notification);
    } catch (error) {
      this.logger.error(
        `Error filtering user ${user.id} by role for notification ${notification.id}: ${error.message}`,
        error.stack,
      );
      // On error, default to allowing (fail open for critical notifications)
      return true;
    }
  }

  /**
   * Check if user is eligible to receive a notification
   * Legacy method - now delegates to filterByRole
   *
   * Considerations:
   * - User must be active
   * - User must have the required privilege level (if specified)
   * - User's sector must match (if specified)
   *
   * @param user - The user to check
   * @param notification - The notification to check against
   * @returns true if user is eligible
   */
  isUserEligible(user: User, notification: Notification): boolean {
    // Must be active
    if (!user.isActive) {
      return false;
    }

    // Use role-based filtering
    return this.filterByRole(user, notification);
  }

  /**
   * Get user's preferred notification channels based on preferences
   *
   * Logic:
   * 1. Check if user has custom preferences for this notification type
   * 2. If not, use default preferences
   * 3. Handle mandatory notifications (can't be disabled)
   * 4. Respect user's channel preferences
   *
   * @param userId - The user ID
   * @param notificationType - The notification type
   * @param eventType - Optional event type for more specific preferences
   * @returns Array of enabled notification channels
   */
  async getUserChannels(
    userId: string,
    notificationType: string,
    eventType?: string,
  ): Promise<NOTIFICATION_CHANNEL[]> {
    try {
      // Get user preferences
      const userPreferences = await this.prisma.userNotificationPreference.findFirst({
        where: {
          userId,
          notificationType: notificationType as any,
          eventType: eventType || null,
        },
      });

      // If user has specific preferences, use them
      if (userPreferences) {
        // If mandatory, ignore user preference and use all channels
        if (userPreferences.isMandatory) {
          this.logger.log(
            `Notification type ${notificationType} is mandatory for user ${userId}, using all channels`,
          );
          return userPreferences.channels as NOTIFICATION_CHANNEL[];
        }

        // If disabled, return empty array
        if (!userPreferences.enabled) {
          this.logger.log(`User ${userId} has disabled notifications for type ${notificationType}`);
          return [];
        }

        // Return user's preferred channels
        return userPreferences.channels as NOTIFICATION_CHANNEL[];
      }

      // If no user preferences, get global default preferences
      const defaultPreference = await this.prisma.notificationPreference.findFirst({
        where: {
          notificationType: notificationType as any,
        },
      });

      if (defaultPreference) {
        // If mandatory, always send
        if (defaultPreference.isMandatory) {
          this.logger.log(
            `Notification type ${notificationType} is mandatory globally, using all channels`,
          );
          return defaultPreference.channels as NOTIFICATION_CHANNEL[];
        }

        // If default is disabled, return empty array
        if (!defaultPreference.enabled) {
          this.logger.log(`Default preference for type ${notificationType} is disabled`);
          return [];
        }

        return defaultPreference.channels as NOTIFICATION_CHANNEL[];
      }

      // If no preferences found, use a sensible default (IN_APP only)
      this.logger.log(
        `No preferences found for notification type ${notificationType}, defaulting to IN_APP`,
      );
      return [NOTIFICATION_CHANNEL.IN_APP];
    } catch (error) {
      this.logger.error(
        `Error getting user channels for user ${userId}, type ${notificationType}: ${error.message}`,
        error.stack,
      );

      // On error, default to IN_APP to ensure user gets some notification
      return [NOTIFICATION_CHANNEL.IN_APP];
    }
  }

  /**
   * Create a notification delivery record
   *
   * @param notificationId - The notification ID
   * @param channel - The delivery channel
   * @param status - Initial status
   * @param errorMessage - Optional error message
   * @returns The created delivery record ID
   */
  private async createDeliveryRecord(
    notificationId: string,
    channel: NOTIFICATION_CHANNEL,
    status: DELIVERY_STATUS,
    errorMessage?: string,
  ): Promise<string> {
    try {
      const delivery = await this.prisma.notificationDelivery.create({
        data: {
          notificationId,
          channel: channel as any,
          status: status as any,
          errorMessage: errorMessage || null,
          sentAt: status === DELIVERY_STATUS.DELIVERED ? new Date() : null,
          deliveredAt: status === DELIVERY_STATUS.DELIVERED ? new Date() : null,
          failedAt: status === DELIVERY_STATUS.FAILED ? new Date() : null,
        },
      });

      return delivery.id;
    } catch (error) {
      this.logger.error(
        `Error creating delivery record for notification ${notificationId}, channel ${channel}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Update delivery record status
   *
   * @param deliveryId - The delivery record ID
   * @param status - New status
   * @param errorMessage - Optional error message
   * @param deliveredAt - Optional delivery timestamp
   */
  private async updateDeliveryStatus(
    deliveryId: string,
    status: DELIVERY_STATUS,
    errorMessage?: string | null,
    deliveredAt?: Date,
  ): Promise<void> {
    try {
      await this.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: status as any,
          errorMessage: errorMessage || null,
          sentAt: status === DELIVERY_STATUS.PROCESSING ? new Date() : undefined,
          deliveredAt: status === DELIVERY_STATUS.DELIVERED ? deliveredAt || new Date() : null,
          failedAt: status === DELIVERY_STATUS.FAILED ? new Date() : null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Error updating delivery status for delivery ${deliveryId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Update notification sentAt timestamp
   *
   * @param notificationId - The notification ID
   */
  private async updateNotificationSentAt(notificationId: string): Promise<void> {
    try {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          sentAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(
        `Error updating notification sentAt for ${notificationId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Create delivery records for multiple channels
   *
   * @param notificationId - The notification ID
   * @param channels - Array of channels to create records for
   */
  async createDeliveryRecords(
    notificationId: string,
    channels: NOTIFICATION_CHANNEL[],
  ): Promise<void> {
    this.logger.log(
      `Creating ${channels.length} delivery records for notification ${notificationId}`,
    );

    try {
      await this.prisma.notificationDelivery.createMany({
        data: channels.map(channel => ({
          notificationId,
          channel: channel as any,
          status: 'PENDING' as any,
        })),
      });
    } catch (error) {
      this.logger.error(
        `Error creating delivery records for notification ${notificationId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Dispatch multiple notifications in bulk
   * Processes them in parallel for better performance
   *
   * @param notificationIds - Array of notification IDs to dispatch
   * @returns Object with success and failure counts
   */
  async dispatchBulkNotifications(
    notificationIds: string[],
  ): Promise<{ success: number; failed: number; errors: Array<{ id: string; error: string }> }> {
    this.logger.log(`Starting bulk dispatch for ${notificationIds.length} notifications`);

    const results = await Promise.allSettled(
      notificationIds.map(id => this.dispatchNotification(id)),
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failedCount = results.filter(r => r.status === 'rejected').length;

    const errors = results
      .map((result, index) => ({
        id: notificationIds[index],
        result,
      }))
      .filter(({ result }) => result.status === 'rejected')
      .map(({ id, result }) => ({
        id,
        error: (result as PromiseRejectedResult).reason.message,
      }));

    this.logger.log(`Bulk dispatch completed: ${successCount} succeeded, ${failedCount} failed`);

    // Emit bulk dispatch event
    this.eventEmitter.emit('notification.bulk.dispatched', {
      total: notificationIds.length,
      success: successCount,
      failed: failedCount,
      errors,
      dispatchedAt: new Date(),
    });

    return {
      success: successCount,
      failed: failedCount,
      errors,
    };
  }

  /**
   * Queue channel delivery for a specific notification and user
   * This method is used to queue notification jobs for asynchronous processing
   *
   * @param notification - The notification to queue
   * @param user - The user to send to
   * @param channel - The channel to use
   * @returns The delivery ID
   */
  async queueChannelDelivery(
    notification: Notification,
    user: User,
    channel: NOTIFICATION_CHANNEL,
  ): Promise<string> {
    this.logger.log(
      `Queueing ${channel} delivery for notification ${notification.id} to user ${user.id}`,
    );

    try {
      // Create delivery record
      const deliveryId = await this.createDeliveryRecord(
        notification.id,
        channel,
        DELIVERY_STATUS.PENDING,
      );

      // Queue the job based on channel type
      await this.queueService.queueNotificationJob({
        notificationId: notification.id,
        deliveryId,
        channel,
        userId: user.id,
        attempts: 0,
      });

      this.logger.log(
        `Successfully queued ${channel} delivery ${deliveryId} for notification ${notification.id}`,
      );

      return deliveryId;
    } catch (error) {
      this.logger.error(
        `Failed to queue ${channel} delivery for notification ${notification.id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Handle delivery result for a specific channel
   * Updates delivery status and triggers retry logic if needed
   *
   * @param deliveryId - The delivery ID
   * @param success - Whether the delivery was successful
   * @param error - Error message if delivery failed
   * @param messageId - External message ID (for email, SMS, etc.)
   */
  async handleDeliveryResult(
    deliveryId: string,
    success: boolean,
    error?: string,
    messageId?: string,
  ): Promise<void> {
    this.logger.log(`Handling delivery result for ${deliveryId}: ${success ? 'SUCCESS' : 'FAILED'}`);

    try {
      // Get delivery record
      const delivery = await this.prisma.notificationDelivery.findUnique({
        where: { id: deliveryId },
        include: {
          notification: true,
        },
      });

      if (!delivery) {
        this.logger.warn(`Delivery ${deliveryId} not found`);
        return;
      }

      if (success) {
        // Update as delivered
        await this.updateDeliveryStatus(
          deliveryId,
          DELIVERY_STATUS.DELIVERED,
          null,
          new Date(),
        );

        // Emit success event
        this.eventEmitter.emit('notification.delivery.success', {
          deliveryId,
          notificationId: delivery.notificationId,
          channel: delivery.channel,
          deliveredAt: new Date(),
          messageId,
        });
      } else {
        // Update as failed
        await this.updateDeliveryStatus(
          deliveryId,
          DELIVERY_STATUS.FAILED,
          error || 'Unknown error',
        );

        // Emit failure event
        this.eventEmitter.emit('notification.delivery.failed', {
          deliveryId,
          notificationId: delivery.notificationId,
          channel: delivery.channel,
          error,
          failedAt: new Date(),
        });

        // Check if we should retry
        const metadata = delivery.metadata as any;
        const attempts = metadata?.attempts || 0;
        const maxRetries = 3;

        if (attempts < maxRetries) {
          this.logger.log(
            `Scheduling retry for delivery ${deliveryId} (attempt ${attempts + 1}/${maxRetries})`,
          );
          await this.retryFailedDelivery(deliveryId);
        } else {
          this.logger.warn(
            `Delivery ${deliveryId} has exceeded max retries (${maxRetries}), not retrying`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error handling delivery result for ${deliveryId}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Retry a failed delivery with exponential backoff
   *
   * @param deliveryId - The delivery ID to retry
   * @returns The new job ID if retry was queued
   */
  async retryFailedDelivery(deliveryId: string): Promise<string | null> {
    this.logger.log(`Retrying failed delivery ${deliveryId}`);

    try {
      // Delegate to queue service which has retry logic
      const job = await this.queueService.retryDelivery(deliveryId);

      if (job) {
        this.logger.log(`Successfully queued retry for delivery ${deliveryId}, job ID: ${job.id}`);
        return job.id.toString();
      } else {
        this.logger.warn(`Failed to queue retry for delivery ${deliveryId}`);
        return null;
      }
    } catch (error) {
      this.logger.error(
        `Error retrying failed delivery ${deliveryId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Aggregate similar notifications to reduce noise
   * Delegates to NotificationAggregationService
   *
   * @param notification - The notification to potentially aggregate
   * @returns true if notification was aggregated, false if it should be sent immediately
   */
  async aggregateNotifications(notification: Notification): Promise<boolean> {
    try {
      // Check if notification should be aggregated
      const shouldAggregate = await this.aggregationService.shouldAggregate(notification);

      if (!shouldAggregate) {
        this.logger.debug(
          `Notification ${notification.id} should not be aggregated, sending immediately`,
        );
        return false;
      }

      // Add to aggregation group
      await this.aggregationService.addToAggregation(notification);

      this.logger.log(
        `Notification ${notification.id} added to aggregation group, will be sent later`,
      );

      return true;
    } catch (error) {
      this.logger.error(
        `Error aggregating notification ${notification.id}: ${error.message}`,
        error.stack,
      );
      // On error, don't aggregate - send immediately
      return false;
    }
  }

  /**
   * Dispatch notification with aggregation check
   * This is a wrapper around dispatchNotification that checks for aggregation first
   *
   * @param notificationId - The notification ID
   * @returns true if notification was dispatched, false if it was aggregated
   */
  async dispatchWithAggregation(notificationId: string): Promise<boolean> {
    this.logger.log(`Dispatching notification ${notificationId} with aggregation check`);

    try {
      // Load notification
      const notification = await this.loadNotification(notificationId);

      if (!notification) {
        throw new NotFoundException(`Notification ${notificationId} not found`);
      }

      // Check if should be aggregated
      const wasAggregated = await this.aggregateNotifications(notification);

      if (wasAggregated) {
        this.logger.log(`Notification ${notificationId} was aggregated, not dispatching now`);
        return false;
      }

      // Not aggregated, dispatch normally
      await this.dispatchNotification(notificationId);
      return true;
    } catch (error) {
      this.logger.error(
        `Error dispatching notification ${notificationId} with aggregation: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get delivery statistics for a notification
   *
   * @param notificationId - The notification ID
   * @returns Delivery statistics
   */
  async getDeliveryStats(notificationId: string): Promise<{
    total: number;
    delivered: number;
    failed: number;
    pending: number;
    retrying: number;
    byChannel: Record<string, { delivered: number; failed: number; pending: number }>;
  }> {
    try {
      const deliveries = await this.prisma.notificationDelivery.findMany({
        where: { notificationId },
      });

      const stats = {
        total: deliveries.length,
        delivered: deliveries.filter(d => d.status === 'DELIVERED').length,
        failed: deliveries.filter(d => d.status === 'FAILED').length,
        pending: deliveries.filter(d => d.status === 'PENDING').length,
        retrying: deliveries.filter(d => d.status === 'RETRYING').length,
        byChannel: {} as Record<string, { delivered: number; failed: number; pending: number }>,
      };

      // Group by channel
      for (const delivery of deliveries) {
        const channel = delivery.channel;
        if (!stats.byChannel[channel]) {
          stats.byChannel[channel] = { delivered: 0, failed: 0, pending: 0 };
        }

        if (delivery.status === 'DELIVERED') {
          stats.byChannel[channel].delivered++;
        } else if (delivery.status === 'FAILED') {
          stats.byChannel[channel].failed++;
        } else {
          stats.byChannel[channel].pending++;
        }
      }

      return stats;
    } catch (error) {
      this.logger.error(
        `Error getting delivery stats for notification ${notificationId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Check if current time is within work hours (7:30 - 18:00)
   * Uses America/Sao_Paulo timezone
   *
   * @returns true if within work hours, false otherwise
   */
  private isWithinWorkHours(): boolean {
    const now = new Date();

    // Get current time in Sao Paulo timezone
    const saoPauloTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const hours = saoPauloTime.getHours();
    const minutes = saoPauloTime.getMinutes();

    // Work hours: 7:30 (7.5) to 18:00 (18.0)
    const currentTimeInHours = hours + minutes / 60;
    const workStartHour = 7.5; // 7:30
    const workEndHour = 18.0; // 18:00

    const isWithinHours = currentTimeInHours >= workStartHour && currentTimeInHours < workEndHour;

    this.logger.debug(
      `Work hours check: Current time ${hours}:${minutes.toString().padStart(2, '0')} ` +
      `(${currentTimeInHours.toFixed(2)}h) - Within hours: ${isWithinHours}`,
    );

    return isWithinHours;
  }

  /**
   * Calculate the next work hour start time (7:30 AM)
   * If current time is before 7:30, returns today at 7:30
   * If current time is after 7:30, returns tomorrow at 7:30
   *
   * @returns Date object for next 7:30 AM in Sao Paulo timezone
   */
  private getNextWorkHourStart(): Date {
    const now = new Date();

    // Get current time in Sao Paulo timezone
    const saoPauloTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const hours = saoPauloTime.getHours();
    const minutes = saoPauloTime.getMinutes();

    // Create next 7:30 AM
    const next730 = new Date(saoPauloTime);
    next730.setHours(7, 30, 0, 0);

    // If we're past 7:30 today (or exactly at/after 18:00), schedule for tomorrow
    const currentTimeInHours = hours + minutes / 60;
    if (currentTimeInHours >= 7.5) {
      // Add one day
      next730.setDate(next730.getDate() + 1);
    }

    this.logger.debug(`Next work hour start calculated as: ${next730.toISOString()}`);

    return next730;
  }
}
