import { Injectable, Logger } from '@nestjs/common';
import { NotificationGateway } from './notification.gateway';

/**
 * Service wrapper for NotificationGateway
 *
 * Provides a clean injectable service for other modules to send
 * real-time notifications without directly depending on the gateway.
 *
 * This service abstracts the WebSocket implementation details and
 * provides a simple API for notification delivery.
 */
@Injectable()
export class NotificationGatewayService {
  private readonly logger = new Logger(NotificationGatewayService.name);

  constructor(private readonly notificationGateway: NotificationGateway) {}

  /**
   * Send a notification to a specific user
   * Automatically delivered to all connected devices for that user
   *
   * @param userId - Target user ID
   * @param notification - Notification object to send
   *
   * @example
   * ```ts
   * await this.gatewayService.sendToUser('user-123', {
   *   id: 'notif-456',
   *   title: 'New Task Assigned',
   *   body: 'You have been assigned a new task',
   *   type: 'task',
   *   createdAt: new Date(),
   * });
   * ```
   */
  async sendToUser(userId: string, notification: any): Promise<void> {
    try {
      await this.notificationGateway.sendNotificationToUser(userId, {
        ...notification,
        type: 'notification:new',
      });
    } catch (error) {
      this.logger.error(`Failed to send notification to user ${userId}: ${error.message}`);
    }
  }

  /**
   * Send a notification update to a specific user
   *
   * @param userId - Target user ID
   * @param notification - Updated notification object
   *
   * @example
   * ```ts
   * await this.gatewayService.sendUpdateToUser('user-123', {
   *   id: 'notif-456',
   *   seenAt: new Date(),
   * });
   * ```
   */
  async sendUpdateToUser(userId: string, notification: any): Promise<void> {
    try {
      await this.notificationGateway.sendNotificationToUser(userId, {
        ...notification,
        type: 'notification:update',
      });
    } catch (error) {
      this.logger.error(`Failed to send notification update to user ${userId}: ${error.message}`);
    }
  }

  /**
   * Send a notification deletion event to a specific user
   *
   * @param userId - Target user ID
   * @param notificationId - ID of deleted notification
   *
   * @example
   * ```ts
   * await this.gatewayService.sendDeletionToUser('user-123', 'notif-456');
   * ```
   */
  async sendDeletionToUser(userId: string, notificationId: string): Promise<void> {
    try {
      await this.notificationGateway.sendNotificationToUser(userId, {
        id: notificationId,
        type: 'notification:delete',
        deletedAt: new Date(),
      });
    } catch (error) {
      this.logger.error(`Failed to send notification deletion to user ${userId}: ${error.message}`);
    }
  }

  /**
   * Broadcast notification to specific sectors
   * Useful for sector-wide announcements
   *
   * @param sectorIds - Array of sector IDs to broadcast to
   * @param notification - Notification object to send
   *
   * @example
   * ```ts
   * await this.gatewayService.broadcastToSectors(
   *   ['sector-1', 'sector-2'],
   *   {
   *     title: 'System Maintenance',
   *     body: 'Scheduled maintenance at 2 AM',
   *     importance: 'HIGH',
   *   }
   * );
   * ```
   */
  broadcastToSectors(sectorIds: string[], notification: any): void {
    try {
      this.notificationGateway.sendNotificationToSectors(sectorIds, {
        ...notification,
        type: 'notification:new',
      });
    } catch (error) {
      this.logger.error(`Failed to broadcast to sectors ${sectorIds.join(', ')}: ${error.message}`);
    }
  }

  /**
   * Broadcast notification to all connected users
   * Use sparingly for system-wide critical announcements
   *
   * @param notification - Notification object to send
   *
   * @example
   * ```ts
   * await this.gatewayService.broadcastToAll({
   *   title: 'Emergency Alert',
   *   body: 'Please evacuate the building immediately',
   *   importance: 'URGENT',
   * });
   * ```
   */
  broadcastToAll(notification: any): void {
    try {
      this.notificationGateway.broadcastToAll({
        ...notification,
        type: 'notification:new',
      });
    } catch (error) {
      this.logger.error(`Failed to broadcast to all users: ${error.message}`);
    }
  }

  /**
   * Get the count of currently online users
   *
   * @returns Number of online users
   */
  getOnlineUsersCount(): number {
    return this.notificationGateway.getOnlineUsersCount();
  }

  /**
   * Get list of online user IDs
   *
   * @returns Array of online user IDs
   */
  getOnlineUsers(): string[] {
    return this.notificationGateway.getOnlineUsers();
  }

  /**
   * Check if a specific user is currently online
   *
   * @param userId - User ID to check
   * @returns True if user is online, false otherwise
   */
  isUserOnline(userId: string): boolean {
    return this.notificationGateway.isUserOnline(userId);
  }

  /**
   * Get the number of active connections for a specific user
   * Users can have multiple connections (different devices/tabs)
   *
   * @param userId - User ID to check
   * @returns Number of active connections
   */
  getUserConnectionCount(userId: string): number {
    return this.notificationGateway.getUserConnectionCount(userId);
  }

  /**
   * Send notification when a notification is marked as seen
   * Updates all user's devices about the seen status
   *
   * @param userId - User who marked notification as seen
   * @param notificationId - Notification ID that was seen
   * @param seenAt - Timestamp when notification was seen
   */
  async notifyNotificationSeen(userId: string, notificationId: string, seenAt: Date): Promise<void> {
    try {
      // Fetch the updated notification with seenBy relationship
      const notification = await this.notificationGateway['notificationRepository'].findById(
        notificationId,
        {
          include: {
            seenBy: {
              include: {
                user: true,
              },
            },
          },
        },
      );

      if (notification) {
        // Send as notification:update so frontend receives it
        await this.notificationGateway.sendNotificationToUser(userId, {
          ...notification,
          type: 'notification:update',
        });
      }

      // Also update the count
      try {
        const unreadCount = await this.notificationGateway.getUnreadCount(userId);
        await this.notificationGateway.sendNotificationToUser(userId, {
          type: 'notification:count',
          count: unreadCount,
        });
      } catch (countError) {
        this.logger.warn(`Failed to update notification count for user ${userId}: ${countError.message}`);
      }
    } catch (error) {
      this.logger.error(`Failed to notify notification seen for user ${userId}: ${error.message}`);
    }
  }

  /**
   * Get comprehensive gateway statistics
   *
   * @returns Gateway statistics object
   */
  getGatewayStats(): {
    onlineUsers: number;
    totalConnections: number;
    averageConnectionsPerUser: number;
  } {
    const onlineUsers = this.getOnlineUsersCount();
    const onlineUserIds = this.getOnlineUsers();
    const totalConnections = onlineUserIds.reduce(
      (sum, userId) => sum + this.getUserConnectionCount(userId),
      0,
    );

    return {
      onlineUsers,
      totalConnections,
      averageConnectionsPerUser: onlineUsers > 0 ? totalConnections / onlineUsers : 0,
    };
  }
}
