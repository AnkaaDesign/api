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
import { Logger, forwardRef, Inject, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { isUserEmployed } from '@utils/contract';
import {
  entityChangedSchema,
  presenceEnterSchema,
  presenceLeaveSchema,
  type AttentionEntityType,
} from '@schemas/attention';

/**
 * Attention WebSocket Gateway (namespace: `attention`)
 *
 * Deliberately ISOLATED from the notifications gateway so it can never disrupt
 * notification delivery. Carries the two attention topics:
 *
 *   • PRESENCE ("is-editing") — bidirectional, and the system's PRIMARY guard against
 *     concurrent-edit overrides. Clients announce `presence:enter` / `presence:leave`
 *     around any mutating surface (edit form, inline edit, right-click action). The
 *     gateway is the single source of truth for who holds an entity and SINCE WHEN.
 *
 *   • ATTENTION (server → client) — manual / server-pushed warnings targeted at
 *     specific users (`attention:push` / `attention:dismiss`) and entity-change
 *     signals (`entity:changed`) that tell clients to invalidate their query cache.
 *
 * Auth + room model mirror the notifications gateway: JWT handshake → `user:{id}`,
 * `sector:{sectorId}`, `admin` rooms.
 *
 * ---------------------------------------------------------------------------
 * PRESENCE LIFECYCLE — why each piece exists
 * ---------------------------------------------------------------------------
 * `refs`      One tab can announce the same entity from several places at once (the
 *             detail page registers it, then an inline field starts editing). Without
 *             refcounting the first `leave` would drop the whole tab's presence while
 *             the other announcer is still live, silently unlocking the record.
 *
 * `since`     The "WHEN" half of "who and when is editing". Captured on the FIRST
 *             announce and preserved across refs so the UI can say "editando há 4 min"
 *             rather than resetting every time a field is focused.
 *
 * `lastSeen`  Heartbeat freshness. Socket.io's disconnect fires within ~85 s
 *             (pingTimeout 60 s + pingInterval 25 s), but a frozen/backgrounded mobile
 *             tab can keep a socket nominally alive far longer while the user is gone.
 *             The client heartbeats every 20 s; anything older than PRESENCE_TTL_MS is
 *             swept, so a stale editor cannot lock a record indefinitely.
 *
 * Snapshot    Presence used to be push-on-change only, so a client that connected AFTER
 * on connect  someone started editing saw an EMPTY registry until that editor happened
 *             to leave — i.e. the guard silently failed for exactly the person arriving
 *             second, who is the one it exists to protect. `presence:sync` closes that.
 */
@WebSocketGateway({
  namespace: 'attention',
})
export class AttentionGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AttentionGateway.name);

  /** Evict an editor whose tab stopped heartbeating this long ago. */
  private static readonly PRESENCE_TTL_MS = 45_000;
  /** How often the sweeper looks for stale editors. */
  private static readonly SWEEP_INTERVAL_MS = 15_000;
  /** Upper bound on entities one socket may hold, so a buggy/hostile client cannot
   * grow the registry without limit. Generous: a bulk action announces one per row. */
  private static readonly MAX_ENTITIES_PER_SOCKET = 500;

  private sweepTimer: NodeJS.Timeout | null = null;

  /** entityKey → the entity + its current editors (keyed by socketId). */
  private presence = new Map<
    string,
    {
      entityType: AttentionEntityType;
      entityId: string;
      editors: Map<string, PresenceRecord>;
    }
  >();

  /** socketId → set of entityKeys it holds (O(1) disconnect cleanup). */
  private socketPresence = new Map<string, Set<string>>();

  /** entityKey → signature of the last payload emitted, so an unchanged editor list
   * never re-broadcasts. Presence updates fan out to every client; without this a
   * refcount bump or heartbeat would re-render every open table for every user. */
  private lastEmitted = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => UserRepository))
    private readonly userRepository: UserRepository,
  ) {}

  afterInit() {
    this.sweepTimer = setInterval(() => this.sweepStale(), AttentionGateway.SWEEP_INTERVAL_MS);
    // Never hold the process open just for the sweeper.
    this.sweepTimer.unref?.();
    this.logger.log('Attention WebSocket Gateway initialized (presence TTL sweeper active)');
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
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

      // Hand the fresh socket the current registry immediately. Presence is
      // otherwise push-on-change, so a client connecting AFTER an edit began would
      // believe the record is free — the guard failing precisely for the person it
      // protects. Pushed as an event (not only as a `presence:sync` ack) so clients
      // without ack support — the Flutter app — get it on the same contract.
      client.emit('presence:snapshot', { entities: this.snapshot() });
    } catch (err) {
      this.logger.warn(`Attention connection rejected: ${(err as Error).message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const keys = this.socketPresence.get(client.id);
    if (!keys) return;
    for (const key of keys) {
      const entry = this.presence.get(key);
      if (!entry) continue;
      entry.editors.delete(client.id);
      if (entry.editors.size === 0) {
        this.presence.delete(key);
        this.lastEmitted.delete(key);
      }
      this.emitPresence(key);
    }
    this.socketPresence.delete(client.id);
  }

  // -------------------------------------------------------------------------
  // Presence (is-editing)
  // -------------------------------------------------------------------------

  @SubscribeMessage('presence:enter')
  handlePresenceEnter(@MessageBody() body: unknown, @ConnectedSocket() client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return { success: false, error: 'unauthenticated' };

    const parsed = presenceEnterSchema.safeParse(body);
    if (!parsed.success) return { success: false, error: 'invalid_payload' };
    const { entityType, entityId, clientId } = parsed.data;

    const key = this.entityKey(entityType, entityId);
    let held = this.socketPresence.get(client.id);
    if (!held) {
      held = new Set();
      this.socketPresence.set(client.id, held);
    }
    if (!held.has(key) && held.size >= AttentionGateway.MAX_ENTITIES_PER_SOCKET) {
      this.logger.warn(`Presence cap reached for socket ${client.id} (user ${userId})`);
      return { success: false, error: 'too_many_entities' };
    }

    let entry = this.presence.get(key);
    if (!entry) {
      entry = { entityType, entityId, editors: new Map() };
      this.presence.set(key, entry);
    }

    const now = Date.now();
    const existing = entry.editors.get(client.id);
    if (existing) {
      // Same tab announcing again (a second field started editing) — bump the refcount
      // and keep the ORIGINAL `since` so "editando há X" measures the real session.
      existing.refs += 1;
      existing.lastSeen = now;
    } else {
      entry.editors.set(client.id, {
        userId,
        userName: (client.data.userName as string) ?? 'Alguém',
        clientId: clientId ?? client.id,
        since: now,
        lastSeen: now,
        refs: 1,
      });
    }

    held.add(key);
    this.emitPresence(key);
    return { success: true };
  }

  @SubscribeMessage('presence:leave')
  handlePresenceLeave(@MessageBody() body: unknown, @ConnectedSocket() client: Socket) {
    if (!client.data.userId) return { success: false, error: 'unauthenticated' };

    const parsed = presenceLeaveSchema.safeParse(body);
    if (!parsed.success) return { success: false, error: 'invalid_payload' };
    const key = this.entityKey(parsed.data.entityType, parsed.data.entityId);

    const entry = this.presence.get(key);
    if (entry) {
      const record = entry.editors.get(client.id);
      if (record) {
        record.refs -= 1;
        // Only actually release when the last announcer in this tab lets go.
        if (record.refs <= 0) entry.editors.delete(client.id);
      }
      if (entry.editors.size === 0) {
        this.presence.delete(key);
        this.lastEmitted.delete(key);
        this.socketPresence.get(client.id)?.delete(key);
      } else if (!entry.editors.has(client.id)) {
        this.socketPresence.get(client.id)?.delete(key);
      }
      this.emitPresence(key);
    } else {
      this.socketPresence.get(client.id)?.delete(key);
    }
    return { success: true };
  }

  /**
   * Keep-alive for every entity this socket holds. Without it a frozen tab keeps its
   * lock until socket.io finally gives up on the connection.
   */
  @SubscribeMessage('presence:heartbeat')
  handlePresenceHeartbeat(@ConnectedSocket() client: Socket) {
    if (!client.data.userId) return { success: false, error: 'unauthenticated' };
    const keys = this.socketPresence.get(client.id);
    if (!keys) return { success: true };
    const now = Date.now();
    for (const key of keys) {
      const record = this.presence.get(key)?.editors.get(client.id);
      if (record) record.lastSeen = now;
    }
    return { success: true };
  }

  /**
   * Full registry snapshot for a client that just connected. Presence is otherwise
   * push-on-change, which leaves an arriving client blind to edits already in progress.
   */
  @SubscribeMessage('presence:sync')
  handlePresenceSync(@ConnectedSocket() client: Socket) {
    if (!client.data.userId) return { success: false, error: 'unauthenticated' };
    const entities = this.snapshot();
    // Emitted AND returned: clients that support ack callbacks can use the return
    // value, everyone else just listens for `presence:snapshot`.
    client.emit('presence:snapshot', { entities });
    return { success: true, entities };
  }

  private snapshot() {
    return [...this.presence.values()].map(entry => ({
      entityType: entry.entityType,
      entityId: entry.entityId,
      editors: this.serializeEditors(entry.editors),
    }));
  }

  /**
   * A client that just mutated an entity tells the server; the server rebroadcasts
   * `entity:changed` to every OTHER connected client so they invalidate their query
   * cache and re-evaluate attention.
   *
   * NOTE: server-originated mutations (crons, the bank webhook, mobile clients) do NOT
   * come through here — they call `AttentionService.notifyEntityChanged`, which reaches
   * `broadcastEntityChanged` below. This handler only covers the web client's own writes.
   */
  @SubscribeMessage('entity:changed')
  handleEntityChanged(@MessageBody() body: unknown, @ConnectedSocket() client: Socket) {
    // Authenticated callers only — this fans out to every connected browser and each
    // one turns it into a query invalidation, so an unauthenticated or malformed emit
    // is a free cache-stampede trigger.
    if (!client.data.userId) return { success: false, error: 'unauthenticated' };

    const parsed = entityChangedSchema.safeParse(body);
    if (!parsed.success) return { success: false, error: 'invalid_payload' };

    client.broadcast.emit('entity:changed', {
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      changedFields: parsed.data.changedFields ?? [],
    });
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** `TYPE id` — a NUL separator so an id containing ':' can never be re-split
   * into the wrong (entityType, entityId) pair. The previous `split(':')` let a client
   * forge presence onto another entity by embedding ':' in entityType. */
  private entityKey(entityType: string, entityId: string): string {
    return `${entityType} ${entityId}`;
  }

  private serializeEditors(editors: Map<string, PresenceRecord>): SerializedEditor[] {
    return [...editors.values()]
      .sort((a, b) => a.since - b.since)
      .map(e => ({ clientId: e.clientId, userId: e.userId, userName: e.userName, since: e.since }));
  }

  /**
   * Broadcast the current editor list for an entity to EVERY connected client — not
   * just those in a per-entity room. Viewers (the detail page, table rows) never
   * "enter" as editors, so a room-scoped emit would never reach them and the badge
   * would never show. Presence changes are rare (a form opening/closing) AND are
   * de-duplicated below, so a global emit stays cheap; each client stores it keyed by
   * entity and renders only what it shows.
   */
  private emitPresence(key: string) {
    const entry = this.presence.get(key);
    const editors = entry ? this.serializeEditors(entry.editors) : [];

    // Suppress no-op broadcasts (refcount bumps, heartbeats, repeat announces): every
    // client re-renders its tables on a presence update, so an unchanged list is pure
    // wasted work across the whole fleet.
    const signature = editors.map(e => `${e.clientId}@${e.since}`).join('|');
    if (this.lastEmitted.get(key) === signature) return;
    if (signature) this.lastEmitted.set(key, signature);
    else this.lastEmitted.delete(key);

    // `entry` is gone once the last editor leaves, so recover the address from the key.
    const sep = key.indexOf(' ');
    const entityType = entry?.entityType ?? key.slice(0, sep);
    const entityId = entry?.entityId ?? key.slice(sep + 1);

    this.server.emit('presence:update', { entityType, entityId, editors });
  }

  /** Evict editors whose tab stopped heartbeating (frozen tab, sleeping laptop, killed
   * process that never sent a clean disconnect). */
  private sweepStale() {
    const cutoff = Date.now() - AttentionGateway.PRESENCE_TTL_MS;
    const touched: string[] = [];

    for (const [key, entry] of this.presence) {
      let removed = false;
      for (const [socketId, record] of entry.editors) {
        if (record.lastSeen < cutoff) {
          entry.editors.delete(socketId);
          this.socketPresence.get(socketId)?.delete(key);
          removed = true;
        }
      }
      if (removed) touched.push(key);
    }

    for (const key of touched) {
      if (this.presence.get(key)?.editors.size === 0) {
        this.presence.delete(key);
      }
      this.emitPresence(key);
    }

    if (touched.length > 0) {
      this.logger.debug(`Presence sweep released ${touched.length} stale entit(y|ies)`);
    }
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

  /** Tell clients an entity changed so they invalidate their query cache. Used by
   * domain services for server-originated writes (crons, webhooks, mobile clients). */
  broadcastEntityChanged(entityType: string, entityId: string, changedFields?: string[]) {
    this.server.emit('entity:changed', { entityType, entityId, changedFields: changedFields ?? [] });
  }

  /** Who currently holds this entity — for HTTP callers that need a save-time check
   * without opening a socket. */
  getEditors(entityType: string, entityId: string): SerializedEditor[] {
    const entry = this.presence.get(this.entityKey(entityType, entityId));
    return entry ? this.serializeEditors(entry.editors) : [];
  }

  /** Which of these users currently have at least one connected attention socket.
   * Lets the caller distinguish a delivered push from one dropped into an empty room. */
  async filterOnlineUserIds(userIds: string[]): Promise<string[]> {
    const online: string[] = [];
    for (const id of userIds) {
      const sockets = await this.server.in(`user:${id}`).fetchSockets();
      if (sockets.length > 0) online.push(id);
    }
    return online;
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

interface PresenceRecord {
  userId: string;
  userName: string;
  /** Stable per-tab id supplied by the client — survives socket reconnects, unlike
   * socket.id, so a client can reliably exclude its OWN announcement. */
  clientId: string;
  /** When this tab FIRST announced (preserved across refcount bumps). */
  since: number;
  /** Last heartbeat — drives TTL eviction. */
  lastSeen: number;
  /** How many announcers in this tab currently hold the entity. */
  refs: number;
}

interface SerializedEditor {
  clientId: string;
  userId: string;
  userName: string;
  since: number;
}
