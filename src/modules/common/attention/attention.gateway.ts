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
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { isUserEmployed } from '@utils/contract';

/**
 * Attention WebSocket Gateway (namespace: `attention`)
 *
 * Deliberately ISOLATED from the notifications gateway so it can never disrupt
 * notification delivery. Carries the two attention topics:
 *
 *   • PRESENCE ("is-editing") — bidirectional. Clients announce `presence:enter` /
 *     `presence:leave` for an entity (edit form open, or a mutating right-click
 *     action). The gateway keeps an in-memory registry and broadcasts
 *     `presence:update` to everyone viewing that entity. Auto-released on disconnect.
 *
 *   • ATTENTION (server → client) — manual / server-pushed warnings targeted at
 *     specific users (`attention:push` / `attention:dismiss`) and entity-change
 *     signals (`entity:changed`) that tell clients to invalidate their query cache.
 *
 * Auth + room model mirror the notifications gateway: JWT handshake → `user:{id}`,
 * `sector:{sectorId}`, `admin` rooms.
 */
@WebSocketGateway({
  namespace: 'attention',
  cors: { origin: '*', credentials: true },
})
export class AttentionGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AttentionGateway.name);

  /** entityKey (`TYPE:id`) → socketId → editor info. */
  private presence: Map<string, Map<string, { userId: string; userName: string }>> = new Map();
  /** socketId → set of entityKeys it is present on (fast disconnect cleanup). */
  private socketPresence: Map<string, Set<string>> = new Map();

  constructor(
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => UserRepository))
    private readonly userRepository: UserRepository,
  ) {}

  afterInit() {
    this.logger.log('Attention WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = await this.jwtService.verifyAsync(token, { secret: process.env.JWT_SECRET });
      if (!payload?.sub) {
        client.disconnect();
        return;
      }
      const user = await this.userRepository.findById(payload.sub, { include: { sector: true } });
      if (!user || !isUserEmployed(user)) {
        client.disconnect();
        return;
      }

      client.data.userId = user.id;
      client.data.userName = user.name;
      client.data.sectorId = user.sectorId;
      client.data.userRole = user.sector?.privileges;

      await client.join(`user:${user.id}`);
      if (user.sectorId) await client.join(`sector:${user.sectorId}`);
      if (user.sector?.privileges === 'ADMIN') await client.join('admin');
    } catch (err) {
      this.logger.warn(`Attention connection rejected: ${(err as Error).message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const keys = this.socketPresence.get(client.id);
    if (keys) {
      for (const key of keys) {
        const editors = this.presence.get(key);
        if (editors) {
          editors.delete(client.id);
          if (editors.size === 0) this.presence.delete(key);
          this.emitPresence(key);
        }
      }
      this.socketPresence.delete(client.id);
    }
  }

  // -------------------------------------------------------------------------
  // Presence (is-editing)
  // -------------------------------------------------------------------------

  @SubscribeMessage('presence:enter')
  async handlePresenceEnter(
    @MessageBody() data: { entityType: string; entityId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !data?.entityType || !data?.entityId) return { success: false };
    const key = `${data.entityType}:${data.entityId}`;

    await client.join(`presence:${key}`);
    let editors = this.presence.get(key);
    if (!editors) {
      editors = new Map();
      this.presence.set(key, editors);
    }
    editors.set(client.id, { userId, userName: (client.data.userName as string) ?? 'Alguém' });

    let keys = this.socketPresence.get(client.id);
    if (!keys) {
      keys = new Set();
      this.socketPresence.set(client.id, keys);
    }
    keys.add(key);

    this.emitPresence(key);
    return { success: true };
  }

  @SubscribeMessage('presence:leave')
  async handlePresenceLeave(
    @MessageBody() data: { entityType: string; entityId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!data?.entityType || !data?.entityId) return { success: false };
    const key = `${data.entityType}:${data.entityId}`;
    const editors = this.presence.get(key);
    if (editors) {
      editors.delete(client.id);
      if (editors.size === 0) this.presence.delete(key);
      this.emitPresence(key);
    }
    this.socketPresence.get(client.id)?.delete(key);
    await client.leave(`presence:${key}`);
    return { success: true };
  }

  /**
   * A client that just mutated an entity tells the server; the server rebroadcasts
   * `entity:changed` to every OTHER connected client so they invalidate their query
   * cache and re-evaluate attention. Keeps invalidation client-driven — no coupling
   * into the API's domain services required.
   */
  @SubscribeMessage('entity:changed')
  handleEntityChanged(
    @MessageBody() data: { entityType: string; entityId: string; changedFields?: string[] },
    @ConnectedSocket() client: Socket,
  ) {
    if (!data?.entityType || !data?.entityId) return { success: false };
    client.broadcast.emit('entity:changed', {
      entityType: data.entityType,
      entityId: data.entityId,
      changedFields: data.changedFields ?? [],
    });
    return { success: true };
  }

  /** Broadcast the current editor list for an entity to everyone viewing it. */
  private emitPresence(key: string) {
    const editors = this.presence.get(key);
    const [entityType, entityId] = key.split(':');
    // De-dupe by userId (a user may edit from several tabs).
    const byUser = new Map<string, string>();
    editors?.forEach((e) => byUser.set(e.userId, e.userName));
    this.server.to(`presence:${key}`).emit('presence:update', {
      entityType,
      entityId,
      editors: [...byUser.entries()].map(([userId, userName]) => ({ userId, userName })),
    });
  }

  // -------------------------------------------------------------------------
  // Server → client emitters (called by AttentionService)
  // -------------------------------------------------------------------------

  /** Push a manual/rule attention to specific users' engines. */
  pushToUsers(userIds: string[], payload: Record<string, unknown>) {
    for (const id of userIds) this.server.to(`user:${id}`).emit('attention:push', payload);
  }

  /** Push an attention to whole sectors (privilege-based rooms are per-sectorId, so
   * callers pass concrete sectorIds resolved from privileges). */
  pushToSectorIds(sectorIds: string[], payload: Record<string, unknown>) {
    for (const id of sectorIds) this.server.to(`sector:${id}`).emit('attention:push', payload);
  }

  dismissForUsers(userIds: string[], attentionId: string) {
    for (const id of userIds) this.server.to(`user:${id}`).emit('attention:dismiss', { id: attentionId });
  }

  /** Tell clients an entity changed so they invalidate their query cache. */
  broadcastEntityChanged(entityType: string, entityId: string, changedFields?: string[]) {
    this.server.emit('entity:changed', { entityType, entityId, changedFields: changedFields ?? [] });
  }

  private extractToken(client: Socket): string | null {
    const queryToken = client.handshake.query?.token as string | undefined;
    if (queryToken) return queryToken;
    const authHeader = client.handshake.headers?.authorization;
    if (authHeader) {
      const [type, token] = authHeader.split(' ');
      if (type === 'Bearer' && token) return token;
    }
    const auth = client.handshake.auth as { token?: string } | undefined;
    return auth?.token ?? null;
  }
}
