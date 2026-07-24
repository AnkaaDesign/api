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
| `presence:enter` | c→s | `{entityType, entityId}` | user opened an edit form / mutating action |
| `presence:leave` | c→s | `{entityType, entityId}` | released (also auto on disconnect) |
| `presence:update` | s→c | `{entityType, entityId, editors[]}` | who is editing (de-duped by user) |
| `entity:changed` | c→s→c | `{entityType, entityId, changedFields}` | rebroadcast so others invalidate cache |
| `attention:push` | s→c | PushedAttention (see below) | manual / server-pushed warning |
| `attention:dismiss` | s→c | `{id}` | clear a pushed warning |

Presence is in-memory (`Map<entityKey, Map<socketId, editor>>`), no DB. Auto-released on
disconnect via a per-socket reverse index.

**PushedAttention** (matches the web `PushedAttention` in `lib/attention/engine.ts`):
```ts
{ id, entityType, entityId, target:{level,field?}, priority, message?, fromUserName?,
  expiresAt?, cadence:{ blinkCount, intervalMs, pulseMs, soundEnabled, tone, cooldownMs } }
```

---

## 3. HTTP endpoints

All under the global JWT guard (`@UserId()` = authenticated caller).

- `POST /attention/warnings` — manual "Enviar aviso". Body = `SendWarningInput`
  (`{entityType, entityId, target, recipientUserIds[], message?, tone?, blinkCount?, cooldownMs?, expiresInMs?, fromUserName?}`).
  Delivers `attention:push` to each online recipient (sender excluded). **DONE.**
- `GET /attention/ack` — the caller's persisted acks (for the client to hydrate its cooldown
  state cross-device). **DONE (needs migration).**
- `PUT /attention/ack` — upsert one ack `{ruleId, entityType, entityId, snoozeUntil?, acknowledged?, lastFiredAt?}`. **DONE (needs migration).**

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
| Manual warnings `POST /attention/warnings` | ✅ implemented |
| `AttentionAck` model + `GET/PUT /attention/ack` + service | ✅ implemented (needs `migrate dev`) |
| Web server-backed ack store | ✅ implemented (localStorage stays as offline cache) |
| `AttentionRule`/`Preference` DB + admin config UI | ⬜ planned (§4.2) |
| Time-trigger cron (R2) | ⬜ planned (§5) |
| Server summary + nav unification | ⬜ planned (§6) |
