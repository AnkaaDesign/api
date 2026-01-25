import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, forwardRef, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { NotificationRepository } from './repositories/notification.repository';
import { NotificationDeliveryRepository } from './repositories/notification-delivery.repository';
import { NOTIFICATION_CHANNEL } from '@constants';

/**
 * WebSocket Gateway for real-time notification delivery
 *
 * Features:
 * - JWT authentication on connection via handshake
 * - User-to-socket mapping for targeted notifications (supports multiple devices)
 * - Sector-based room subscriptions for broadcast notifications
 * - Admin room for broadcasting to all administrators
 * - Online/offline user tracking
 * - Automatic delivery tracking via NotificationDelivery
 * - Pending notifications sent on connect
 * - Reconnection handling
 * - Unread count updates
 *
 * Events emitted to clients:
 * - notification:new - New notification created
 * - notification:read - Notification marked as read
 * - notification:delivered - Notification delivered via socket
 * - notification:count - Unread notification count update
 * - connection:success - Successful connection confirmation
 *
 * Events handled from clients:
 * - mark.read - Mark notification as read
 * - mark.delivered - Mark notification as delivered (acknowledgment)
 */
@WebSocketGateway({
  namespace: 'notifications',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  // Map userId to array of socket IDs (supports multiple devices per user)
  private userSockets: Map<string, Set<string>> = new Map();

  // Map socketId to userId for quick lookup on disconnect
  private socketUsers: Map<string, string> = new Map();

  // Track online users
  private onlineUsers: Set<string> = new Set();

  constructor(
    private readonly jwtService: JwtService,
    private readonly userRepository: UserRepository,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => NotificationRepository))
    private readonly notificationRepository: NotificationRepository,
    @Inject(forwardRef(() => NotificationDeliveryRepository))
    private readonly deliveryRepository: NotificationDeliveryRepository,
  ) {}

  afterInit(server: Server) {
    this.logger.log('Notification WebSocket Gateway initialized');
  }

  /**
   * Handle new client connection
   * Authenticates user via JWT and sets up room subscriptions
   */
  async handleConnection(client: Socket) {
    try {
      // Extract and validate JWT token from handshake
      const token = this.extractTokenFromHandshake(client);

      if (!token) {
        this.logger.warn(`Connection rejected: No token provided (${client.id})`);
        client.disconnect();
        return;
      }

      // Verify JWT token
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });

      if (!payload || !payload.sub) {
        this.logger.warn(`Connection rejected: Invalid token (${client.id})`);
        client.disconnect();
        return;
      }

      const userId = payload.sub;

      // Verify user exists and is active
      const user = await this.userRepository.findById(userId, {
        include: { sector: true },
      });

      if (!user) {
        this.logger.warn(`Connection rejected: User not found (${userId})`);
        client.disconnect();
        return;
      }

      if (!user.isActive) {
        this.logger.warn(`Connection rejected: User inactive (${userId})`);
        client.disconnect();
        return;
      }

      // Store user information in socket data
      client.data.userId = userId;
      client.data.userEmail = user.email;
      client.data.userName = user.name;
      client.data.sectorId = user.sectorId;
      client.data.userRole = user.sector?.privileges;

      // Track user-socket mapping
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(client.id);
      this.socketUsers.set(client.id, userId);

      // Mark user as online
      this.onlineUsers.add(userId);

      // Join user to personal notification room
      await this.joinUserRoom(client, userId);

      // Join user to sector room if they have a sector
      if (user.sectorId) {
        const sectorRoom = `sector:${user.sectorId}`;
        await client.join(sectorRoom);
        this.logger.log(`User ${user.name} (${userId}) joined sector room: ${sectorRoom}`);
      }

      // Join user to admin room if they have admin privileges
      if (user.sector?.privileges === 'ADMIN') {
        await client.join('admin');
        this.logger.log(`User ${user.name} (${userId}) joined admin room`);
      }

      this.logger.log('Socket.io client authenticated and connected', {
        socketId: client.id,
        userId,
        userName: user.name,
        sectorId: user.sectorId,
        role: user.sector?.privileges,
        totalUserConnections: this.userSockets.get(userId)!.size,
        transport: client.conn.transport.name,
        timestamp: new Date(),
      });

      // Send pending notifications on connect
      await this.sendPendingNotifications(client, userId);

      // Get and send unread notification count
      const unreadCount = await this.getUnreadCount(userId);
      client.emit('notification:count', { count: unreadCount });

      this.logger.log('Initial notification state sent to client', {
        socketId: client.id,
        userId,
        unreadCount,
      });

      // Notify client of successful connection
      client.emit('connection:success', {
        userId,
        userName: user.name,
        connectedAt: new Date().toISOString(),
        unreadCount,
      });

      // Emit event for connection tracking
      this.eventEmitter.emit('socket.user.connected', {
        socketId: client.id,
        userId,
        userName: user.name,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error('Socket.io connection error', {
        socketId: client.id,
        error: error.message,
        stack: error.stack,
      });
      client.disconnect();
    }
  }

  /**
   * Handle client disconnection
   * Cleans up user-socket mappings and room subscriptions
   */
  handleDisconnect(client: Socket) {
    const userId = this.socketUsers.get(client.id);

    if (userId) {
      // Remove socket from user's socket set
      const userSocketSet = this.userSockets.get(userId);
      if (userSocketSet) {
        userSocketSet.delete(client.id);

        const remainingConnections = userSocketSet.size;
        const isFullyDisconnected = remainingConnections === 0;

        this.logger.log('Socket.io client disconnected', {
          socketId: client.id,
          userId,
          remainingConnections,
          userFullyOffline: isFullyDisconnected,
          timestamp: new Date(),
        });

        // If user has no more active connections, mark as offline
        if (isFullyDisconnected) {
          this.userSockets.delete(userId);
          this.onlineUsers.delete(userId);

          // Emit event for full user disconnection
          this.eventEmitter.emit('socket.user.disconnected', {
            userId,
            timestamp: new Date(),
          });
          this.logger.log(`User ${userId} is now offline (all connections closed)`);
        } else {
          this.logger.log(
            `Client disconnected: ${client.id} | User: ${userId} | Remaining connections: ${userSocketSet.size}`,
          );
        }
      }

      // Remove socket-user mapping
      this.socketUsers.delete(client.id);
    } else {
      this.logger.log(`Client disconnected: ${client.id} (unauthenticated)`);
    }
  }

  /**
   * Handle mark.read event from client
   * Marks a notification as read by the user
   */
  @SubscribeMessage('mark.read')
  async handleMarkAsRead(
    @MessageBody() data: { notificationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;

    if (!userId) {
      return { success: false, error: 'Unauthorized' };
    }

    try {
      this.logger.log(`Notification marked as read: ${data.notificationId} by user ${userId}`);

      // Check if notification exists
      const notification = await this.notificationRepository.findById(data.notificationId);

      if (!notification) {
        return { success: false, error: 'Notification not found' };
      }

      // Emit notification:read event to all user's devices
      this.sendNotificationToUser(userId, {
        type: 'notification:read',
        notificationId: data.notificationId,
        readAt: new Date().toISOString(),
      });

      // Update unread count
      const unreadCount = await this.getUnreadCount(userId);
      this.sendNotificationToUser(userId, {
        type: 'notification:count',
        count: unreadCount,
      });

      return { success: true, notificationId: data.notificationId };
    } catch (error) {
      this.logger.error(`Error marking notification as read: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle mark.delivered event from client
   * Marks a notification as delivered (acknowledgment from client)
   */
  @SubscribeMessage('mark.delivered')
  async handleMarkAsDelivered(
    @MessageBody() data: { notificationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;

    if (!userId) {
      return { success: false, error: 'Unauthorized' };
    }

    try {
      await this.markAsDelivered(data.notificationId);

      this.logger.log(
        `Notification ${data.notificationId} acknowledged as delivered by user ${userId}`,
      );

      return { success: true, notificationId: data.notificationId };
    } catch (error) {
      this.logger.error(`Error marking notification as delivered: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle notification:seen event from client (legacy support)
   * @deprecated Use mark.read instead
   */
  @SubscribeMessage('notification:seen')
  async handleNotificationSeen(
    @MessageBody() data: { notificationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    return this.handleMarkAsRead(data, client);
  }

  /**
   * Handle notification:remind event from client
   * Sends a reminder for a specific notification
   */
  @SubscribeMessage('notification:remind')
  async handleNotificationRemind(
    @MessageBody() data: { notificationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;

    if (!userId) {
      return { success: false, error: 'Unauthorized' };
    }

    this.logger.log(`Notification reminder requested: ${data.notificationId} by user ${userId}`);

    return { success: true, notificationId: data.notificationId };
  }

  /**
   * Send notification to a specific user
   * Delivers to all connected devices for that user and marks as delivered
   *
   * @param userId - Target user ID
   * @param notification - Notification data to send
   */
  async sendNotification(userId: string, notification: any): Promise<void> {
    const userRoom = `user:${userId}`;
    const eventType = 'notification:new';

    // Emit to all user's connected devices
    this.server.to(userRoom).emit(eventType, notification);

    // Mark as delivered via WebSocket if user is online
    if (this.isUserOnline(userId) && notification.id) {
      try {
        await this.markAsDelivered(notification.id);
      } catch (error) {
        this.logger.warn(
          `Failed to mark notification ${notification.id} as delivered: ${error.message}`,
        );
      }
    }

    // Update unread count after sending notification
    try {
      const unreadCount = await this.getUnreadCount(userId);
      this.server.to(userRoom).emit('notification:count', { count: unreadCount });
      this.logger.log(`Updated notification count for user ${userId}: ${unreadCount}`);
    } catch (error) {
      this.logger.warn(`Failed to update notification count for user ${userId}: ${error.message}`);
    }

    const socketCount = this.userSockets.get(userId)?.size || 0;
    this.logger.log(
      `Notification sent to user ${userId} (${socketCount} devices) | Event: ${eventType}`,
    );
  }

  /**
   * Send notification to a specific user (legacy method)
   * Delivers to all connected devices for that user
   *
   * @param userId - Target user ID
   * @param notification - Notification data to send
   */
  async sendNotificationToUser(userId: string, notification: any): Promise<void> {
    const userRoom = `user:${userId}`;
    const eventType = notification.type || 'notification:new';

    this.server.to(userRoom).emit(eventType, notification);

    // Update unread count if this is a new notification
    if (eventType === 'notification:new') {
      try {
        const unreadCount = await this.getUnreadCount(userId);
        this.server.to(userRoom).emit('notification:count', { count: unreadCount });
        this.logger.log(`Updated notification count for user ${userId}: ${unreadCount}`);
      } catch (error) {
        this.logger.warn(`Failed to update notification count for user ${userId}: ${error.message}`);
      }
    }

    const socketCount = this.userSockets.get(userId)?.size || 0;
    this.logger.log(
      `Notification sent to user ${userId} (${socketCount} devices) | Event: ${eventType}`,
    );
  }

  /**
   * Send notification to multiple users in a room
   *
   * @param roomName - Room name (e.g., 'admin', 'sector:123')
   * @param notification - Notification data to send
   */
  async sendToRoom(roomName: string, notification: any): Promise<void> {
    const eventType = notification.type || 'notification:new';

    this.server.to(roomName).emit(eventType, notification);

    this.logger.log(`Notification sent to room: ${roomName} | Event: ${eventType}`);
  }

  /**
   * Send notification to multiple sectors
   * Broadcasts to all users in the specified sectors
   *
   * @param sectors - Array of sector IDs
   * @param notification - Notification data to send
   */
  sendNotificationToSectors(sectors: string[], notification: any): void {
    const eventType = notification.type || 'notification:new';

    sectors.forEach(sectorId => {
      const sectorRoom = `sector:${sectorId}`;
      this.server.to(sectorRoom).emit(eventType, notification);
    });

    this.logger.log(`Notification broadcast to ${sectors.length} sectors | Event: ${eventType}`);
  }

  /**
   * Broadcast notification to all admin users
   *
   * @param notification - Notification data to send
   */
  async broadcastToAdmins(notification: any): Promise<void> {
    // Support both 'type' and 'event' field names for flexibility
    const eventType = notification.event || notification.type || 'notification:new';

    this.logger.debug(`Broadcasting to admins: event="${notification.event}", type="${notification.type}", resolved="${eventType}"`);

    this.server.to('admin').emit(eventType, notification);

    this.logger.log(`Notification broadcast to all admins | Event: ${eventType}`);
  }

  /**
   * Broadcast notification to all connected users
   *
   * @param notification - Notification data to send
   */
  broadcastToAll(notification: any): void {
    const eventType = notification.type || 'notification:new';
    this.server.emit(eventType, notification);

    this.logger.log(
      `Notification broadcast to all users | Event: ${eventType} | Total online: ${this.onlineUsers.size}`,
    );
  }

  /**
   * Join user to their personal notification room
   *
   * @param client - Socket client
   * @param userId - User ID
   */
  async joinUserRoom(client: Socket, userId: string): Promise<void> {
    const userRoom = `user:${userId}`;
    await client.join(userRoom);
    this.logger.log(`Client ${client.id} joined user room: ${userRoom}`);
  }

  /**
   * Mark notification as delivered when sent via socket
   *
   * @param notificationId - Notification ID
   */
  async markAsDelivered(notificationId: string): Promise<void> {
    try {
      // Check if delivery record exists for WebSocket channel
      const existingDelivery = await this.deliveryRepository.findByNotificationAndChannel(
        notificationId,
        NOTIFICATION_CHANNEL.IN_APP,
      );

      if (existingDelivery) {
        // Update existing delivery record
        await this.deliveryRepository.update(existingDelivery.id, {
          status: 'DELIVERED',
          deliveredAt: new Date(),
        });
      } else {
        // Create new delivery record
        await this.deliveryRepository.create({
          notificationId,
          channel: NOTIFICATION_CHANNEL.IN_APP,
          status: 'DELIVERED',
          deliveredAt: new Date(),
        });
      }

      this.logger.log(`Notification ${notificationId} marked as delivered via WebSocket`);
    } catch (error) {
      this.logger.error(
        `Failed to mark notification ${notificationId} as delivered: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Send pending (unread) notifications to user on connection
   *
   * @param client - Socket client
   * @param userId - User ID
   */
  private async sendPendingNotifications(client: Socket, userId: string): Promise<void> {
    try {
      // Get unread notifications for user
      const pendingNotifications = await this.notificationRepository.findMany({
        where: {
          userId,
          seenBy: {
            none: {
              userId,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 50, // Limit to 50 most recent
      });

      if (pendingNotifications.data.length > 0) {
        this.logger.log(
          `Sending ${pendingNotifications.data.length} pending notifications to user ${userId}`,
        );

        // Send each pending notification
        for (const notification of pendingNotifications.data) {
          client.emit('notification:new', notification);

          // Mark as delivered
          await this.markAsDelivered(notification.id);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to send pending notifications to user ${userId}: ${error.message}`);
    }
  }

  /**
   * Get unread notification count for a user
   *
   * @param userId - User ID
   * @returns Unread count
   */
  async getUnreadCount(userId: string): Promise<number> {
    try {
      const result = await this.notificationRepository.findMany({
        where: {
          userId,
          seenBy: {
            none: {
              userId,
            },
          },
        },
      });

      return result.meta.totalRecords;
    } catch (error) {
      this.logger.error(`Failed to get unread count for user ${userId}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get count of online users
   */
  getOnlineUsersCount(): number {
    return this.onlineUsers.size;
  }

  /**
   * Get online users list
   */
  getOnlineUsers(): string[] {
    return Array.from(this.onlineUsers);
  }

  /**
   * Check if a specific user is online
   */
  isUserOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }

  /**
   * Get connection count for a specific user
   */
  getUserConnectionCount(userId: string): number {
    return this.userSockets.get(userId)?.size || 0;
  }

  /**
   * Extract JWT token from socket handshake
   * Supports token in query params, auth header, or auth object
   */
  private extractTokenFromHandshake(client: Socket): string | null {
    // Try to get token from query parameters
    const queryToken = client.handshake.query.token as string;
    if (queryToken) {
      return queryToken;
    }

    // Try to get token from authorization header
    const authHeader = client.handshake.headers.authorization;
    if (authHeader) {
      const [type, token] = authHeader.split(' ');
      if (type === 'Bearer' && token) {
        return token;
      }
    }

    // Try to get token from auth object (some clients send it this way)
    const auth = client.handshake.auth as any;
    if (auth?.token) {
      return auth.token;
    }

    return null;
  }
}
