# Attention System — Server Side

Server-side design + implementation status for the Attention (blink/bip + presence)
system. The client design lives in `web/ATTENTION_SYSTEM_PLAN.md`; this doc is the
authority for everything under `api/src/modules/common/attention/` and the Prisma models.

The module is **deliberately isolated** from `NotificationModule` (its own namespace,
its own gateway) so it can never disrupt notification delivery.

---

## 1. Module layout

```
api/src/modules/common/attention/
  attention.gateway.ts       # socket.io namespace `attention` — presence + push + change
  attention.service.ts       # manual "send warning" dispatch + entity-change signalling
  attention-ack.service.ts   # server-side acknowledge / cooldown persistence (AttentionAck)
  attention.controller.ts    # POST /attention/warnings · GET/PUT /attention/ack
  attention.module.ts        # wiring (JwtModule, PrismaModule, forwardRef UserModule)
```

Registered in `app.module.ts` (`AttentionModule`, next to `NotificationModule`).

---

## 2. Real-time gateway (`attention` namespace)

JWT handshake + rooms mirror the notifications gateway: `user:{id}`, `sector:{sectorId}`,
`admin`. Events:

| Event | Dir | Payload | Purpose |
|---|---|---|---|
| `presence:enter` | c→s | `{entityType, entityId, clientId?}` | user opened an edit form / mutating action (refcounted per tab) |
| `presence:leave` | c→s | `{entityType, entityId}` | released one ref (also auto on disconnect / TTL) |
| `presence:heartbeat` | c→s | — | keep-alive for every entity this socket holds |
| `presence:sync` | c→s (ack) | — | full registry snapshot for a client that just connected |
| `presence:update` | s→c | `{entityType, entityId, editors[]}` | who is editing, each with `since` |
| `entity:changed` | c→s→c | `{entityType, entityId, changedFields}` | rebroadcast so others invalidate cache |
| `attention:push` | s→c | PushedAttention (see below) | manual / server-pushed warning |
| `attention:dismiss` | s→c | `{id}` | clear a pushed warning |

Every inbound payload is validated against `api/src/schemas/attention.ts` (entityType is
a closed enum) and requires an authenticated socket.

### Presence is the override guard

Presence is in-memory (`Map<entityKey, {entityType, entityId, editors: Map<socketId, record>}>`),
no DB. A record is `{userId, userName, clientId, since, lastSeen, refs}`:

- **`refs`** — one tab can hold the same entity from several places at once (the detail
  page plus an inline field). Refcounting stops the first `leave` from releasing a lock
  the other announcer still needs.
- **`since`** — when this tab FIRST announced, preserved across refcount bumps, so the UI
  can say *"editando há 4 min"* rather than resetting whenever another field is focused.
- **`lastSeen`** — updated by `presence:heartbeat` (client every 20 s). A sweeper runs every
  15 s and evicts anything older than `PRESENCE_TTL_MS` (45 s), so a frozen tab or a sleeping
  laptop cannot hold a record hostage until socket.io eventually times the connection out.

Released on: `presence:leave` (last ref), `handleDisconnect` (per-socket reverse index), or
the TTL sweep. `presence:update` is emitted only when the editor list actually **changes** —
it fans out to every client, and each one re-renders its tables on receipt.

`MAX_ENTITIES_PER_SOCKET` (500) bounds how much registry one socket can create.

**Snapshot on connect matters.** Presence is otherwise push-on-change, so a client that
connected *after* an edit began saw an empty registry until that editor happened to leave —
the guard failed silently for the person arriving second, who is exactly the one it protects.
`presence:sync` closes that; the web client calls it on every connect and reconnect.

**PushedAttention** (matches the web `PushedAttention` in `lib/attention/engine.ts`):
```ts
{ id, entityType, entityId, target:{level,field?}, priority, message?, fromUserName?,
  expiresAt?, cadence:{ blinkCount, intervalMs, pulseMs, soundEnabled, tone, cooldownMs } }
```

---

## 3. HTTP endpoints

All under the global JWT guard (`@UserId()` = authenticated caller).

All bodies are Zod-validated (`api/src/schemas/attention.ts` + `ZodValidationPipe`).

- `POST /attention/warnings` — manual "Enviar aviso". Body = `SendWarningInput`
  (`{entityType, entityId, target, recipientUserIds[], message?, tone?, blinkCount?, cooldownMs?, expiresInMs?}`).
  Delivers `attention:push` to each ONLINE recipient (sender excluded) and returns
  `{id, delivered, offline}` so the UI can stop claiming success for people who never got it.
  The sender's display name is resolved server-side from the authenticated user —
  `fromUserName` is deliberately NOT accepted, since it let a warning be attributed to anyone.
- `GET /attention/presence/:entityType/:entityId` — who holds this entity right now.
  In-memory lookup, no DB. Used as the **save-time** override check: by the time the user
  presses Salvar their socket may have dropped or missed events, so the write path asks the
  server rather than trusting local state.
- `GET /attention/ack` — the caller's persisted acks (for the client to hydrate its cooldown
  state cross-device).
- `PUT /attention/ack` — upsert one ack `{ruleId, entityType, entityId, snoozeUntil?, acknowledged?, lastFiredAt?}`.

---

## 4. Prisma models

### 4.1 AttentionAck — server-side cooldown / "already saw it" (IMPLEMENTED)

Isolation choice: `userId` is a plain `String` + index, **no `@relation` to `User`**, so the
(very large) `User` model is never touched. Orphaned acks are harmless and pruned by the
client's stale-record cleanup; add the FK later if cascade-on-user-delete is wanted.

```prisma
model AttentionAck {
  id           String    @id @default(uuid())
  userId       String
  ruleId       String    // rule id, or `push:{warningId}` for manual warnings
  entityType   String
  entityId     String
  snoozeUntil  DateTime?
  acknowledged Boolean   @default(false)
  lastFiredAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@unique([userId, ruleId, entityId])
  @@index([userId])
}
```

**To apply (run in your environment — NOT run automatically):**
```
cd api
npx prisma migrate dev --name attention_ack     # creates the table in your DB
npx prisma generate                              # regenerate client (already done here)
```
The service compiles against the generated client now; it only needs the table to exist at
runtime. Until the migration runs, the endpoints will error at query time (the client falls
back to localStorage, so the UI keeps working).

### 4.2 AttentionRule / AttentionRulePreference — config tier (PLANNED, not yet added)

Add when building the admin rules editor (moves rules out of `web/src/lib/attention/rules.ts`).

```prisma
model AttentionRule {
  id            String   @id @default(uuid())
  name          String
  entityType    String
  enabled       Boolean  @default(true)
  priority      Int      @default(0)
  targetSectors String[] // SectorPrivileges values
  predicate     Json     // PredicateNode
  target        Json     // AttentionTarget
  ack           String   // 'onView' | 'onResolve' | 'cycleThenCooldown'
  cadence       Json     // AttentionCadence
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model AttentionRulePreference {
  id        String   @id @default(uuid())
  userId    String
  ruleId    String
  muted     Boolean  @default(false)
  soundMuted Boolean @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, ruleId])
}
```

Endpoints: `GET/POST/PUT/DELETE /attention/rules` (ADMIN), `GET/PUT /attention/rule-preferences`
(per user). Web: serve rules to the client (replacing the code constants as a seed), clone the
admin editor from `web/src/pages/administration/notifications/configurations/*`, add a prefs tab
to `web/src/pages/profile/notification-preferences.tsx`.

---

## 5. Time-trigger cron (PLANNED)

Rules like R2 ("forecast date arrived") depend on time passing, which is not an event. Add a
`@Cron` (every 5–15 min) that queries tasks crossing a boundary this window and emits
`entity:changed` (or a targeted `attention:push`) so connected clients re-evaluate. Reuse the
existing `NotificationCooldown` model for dedup. This is the ONLY periodic server work; it is a
coarse indexed query, not per-client polling. Client-loaded tasks already re-evaluate live at
each reconcile, so the cron only matters for tasks nobody currently has on screen (and the nav
badge).

---

## 6. Server attention summary / nav unification (PLANNED)

`GET /attention/summary` → per-user counts of entities matching attention rules (evaluated
server-side using the user's `Sector.privileges`), pushed on change + cron. Feeds the nav-menu
blink for entities not on screen, letting `web/src/hooks/common/use-nav-activity.ts` drop its
polling cut source and unify on the engine.

---

## 7. Status summary

| Piece | Status |
|---|---|
| Gateway (presence + push + change) | ✅ implemented, api tsc clean |
| Presence: refcount · `since` · heartbeat + TTL sweep · snapshot-on-connect | ✅ implemented |
| Payload validation (Zod, closed entityType enum) on socket + HTTP | ✅ implemented |
| Manual warnings `POST /attention/warnings` (+ delivered/offline reporting) | ✅ implemented |
| `GET /attention/presence/:type/:id` (save-time guard) | ✅ implemented |
| `AttentionAck` model + `GET/PUT /attention/ack` + service | ✅ implemented — **migration NOT applied**, see below |
| Web server-backed ack store | ✅ implemented (localStorage stays as offline cache) |
| Server summary `GET /attention/summary` | ✅ implemented (TASK only, hand-written Prisma counts) |
| `AttentionRule`/`Preference` DB + admin config UI | ⬜ planned (§4.2) |
| Time-trigger cron (R2) | ⬜ planned (§5) |
| Per-user mute / sound preference | ⬜ **not built — no off switch exists** |
| Server-emitted `entity:changed` from domain services | ⬜ `notifyEntityChanged` exists but has no callers |
| Nav unification (retire the polling cut source) | ⬜ planned (§6) |

### Known deployment constraints

1. **Migrations are not applied automatically.** `20260724130000_add_attention_ack` must be
   applied with `pnpm db:migrate:deploy` BEFORE restarting the API. Run `npx prisma migrate status` first.
   Without the table, ack endpoints 500; the client degrades to localStorage and — since
   `/attention` is now skip-listed in the web axios interceptor — does so silently.
2. **Single API instance only.** Presence lives in process memory and every broadcast is
   `server.emit`. With pm2 `instances > 1` and no `@socket.io/redis-adapter`, users on
   different workers cannot see each other's presence — and the guard would report
   "nobody else is editing" when that is false, which is the worst possible failure
   direction. Confirm pm2 `instances: 1`, or add the Redis adapter (Redis is already
   deployed) plus nginx sticky sessions, before scaling out.
