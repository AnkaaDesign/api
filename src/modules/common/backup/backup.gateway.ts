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
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';

/**
 * WebSocket Gateway for real-time backup progress updates
 * Clients can connect to receive live progress updates during backup operations
 */
@WebSocketGateway({
  namespace: 'backup-progress',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class BackupGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(BackupGateway.name);
  private activeBackups: Map<string, Set<string>> = new Map(); // backupId -> Set of client IDs

  afterInit(server: Server) {
    this.logger.log('Backup WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    // Remove client from all active backup subscriptions
    this.activeBackups.forEach((clients, backupId) => {
      clients.delete(client.id);
      if (clients.size === 0) {
        this.activeBackups.delete(backupId);
      }
    });
  }

  /**
   * Subscribe to backup progress updates
   */
  @SubscribeMessage('subscribe')
  handleSubscribe(@MessageBody() data: { backupId: string }, @ConnectedSocket() client: Socket) {
    const { backupId } = data;

    if (!this.activeBackups.has(backupId)) {
      this.activeBackups.set(backupId, new Set());
    }

    this.activeBackups.get(backupId).add(client.id);
    client.join(`backup-${backupId}`);

    this.logger.log(`Client ${client.id} subscribed to backup ${backupId}`);

    return { success: true, message: 'Subscribed to backup progress' };
  }

  /**
   * Unsubscribe from backup progress updates
   */
  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(@MessageBody() data: { backupId: string }, @ConnectedSocket() client: Socket) {
    const { backupId } = data;

    const clients = this.activeBackups.get(backupId);
    if (clients) {
      clients.delete(client.id);
      if (clients.size === 0) {
        this.activeBackups.delete(backupId);
      }
    }

    client.leave(`backup-${backupId}`);

    this.logger.log(`Client ${client.id} unsubscribed from backup ${backupId}`);

    return { success: true, message: 'Unsubscribed from backup progress' };
  }

  /**
   * Listen to backup progress events from EventEmitter
   * and broadcast to subscribed clients
   */
  @OnEvent('backup.progress')
  handleBackupProgress(data: {
    backupId: string;
    progress: number;
    filesProcessed?: number;
    totalFiles?: number;
    timestamp?: number;
    rate?: number;
    status?: string;
    completed?: boolean;
  }) {
    const room = `backup-${data.backupId}`;

    // Emit to all clients in the room
    this.server.to(room).emit('progress', data);

    // Log significant milestones
    if (data.progress % 25 === 0 || data.completed) {
      this.logger.log(
        `Backup ${data.backupId} progress: ${data.progress}%${
          data.completed ? ' - Completed' : ''
        }`,
      );
    }

    // Clean up if backup is completed
    if (data.completed) {
      this.activeBackups.delete(data.backupId);
    }
  }

  /**
   * Get list of active backups with progress
   */
  @SubscribeMessage('getActiveBackups')
  handleGetActiveBackups() {
    const activeBackupIds = Array.from(this.activeBackups.keys());
    return {
      success: true,
      data: activeBackupIds,
    };
  }
}
