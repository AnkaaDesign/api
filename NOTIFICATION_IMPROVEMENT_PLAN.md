# Notification System — Improvement Plan

Cross-package: `api/`, `web/`, `mobile_migration/` (Flutter). Schemas are duplicated across
packages, not shared — every contract change lands in three places.

Status legend: **[V]** verified directly in this session · **[R]** reported by analysis agent
with `file:line`, not independently re-run.

---

## 1. Symptom → root cause

| Reported symptom | Root cause | Evidence |
|---|---|---|
| "accumulating too much" | **194 of 196 configs mark IN_APP `mandatory: true`** → `resolveChannelsForUser` seeds the channel set from mandatory channels and returns *mandatory only* when a user disables a type, so the in-app row is written regardless of preference. The whole preference system is decorative for in-app. | **[V]** seed count 196 IN_APP blocks / 194 mandatory; `notification-configuration.service.ts:770,779` |
| ″ | **Deduplication is off everywhere**: set on 1 of 196 configs, and that one is `0`, which fails the truthiness gate → skipped. Enforcement code is live and correct; only the data is missing. | **[V]** seed values all `null` + one `0`; gate at `notification-configuration.service.ts:958` |
| ″ | ~130 dispatch call sites, **majority broadcast** to every user in the allowed sectors with **no relevance filter** — not "are you assigned to this task", just "is your sector allowed". One `Notification` row created per recipient, synchronously. | **[R]** `notification-dispatch.service.ts:1434,1618-1667,2000` |
| "nobody presses mark as read" | Flutter has **no "mark all as read" affordance at all**. The only path to read-state is tapping a notification, which also force-navigates you away from the list. | **[R]** `notifications_drawer.dart:71-108` |
| "when mark it has no feedback" | No optimistic update on **either** client. Success toasts are blanket-suppressed for `/notifications*` on both (`axiosClient.ts:769,783`; `dio_client.dart:180-181`). Flutter closes the drawer before the response lands, so the result is unobservable. | **[R]** both clients |
| "takes a bunch of time as it's accumulated" | `markAllAsRead` is a **serial per-row loop** (one `create` + one changelog each ≈ 2000 round-trips) inside a **single 60s transaction**, capped at 1000 rows. Plus an unconditional `count()` on every list page, and **no `(userId, createdAt)` index** despite `ORDER BY createdAt DESC`. | **[R]** `notification.service.ts:965-1056`; `notification-prisma.repository.ts:282-293`; **[V]** schema has only `@@index([userId])`, `@@index([scheduledAt])` |
| "doesn't clean all, keeps displaying unread" | **Flutter never requests `include.seenBy`**, so `seen` is computed from two always-absent fields → **hard-false forever**. The server write succeeds; the refetch returns an identical-looking payload. | **[V]** no `seen`/`readAt` column on `Notification`; read state only in `SeenNotification`; `notifications_repository.dart:23-27`; `app_notification.dart:61` |
| ″ | The badge on **both** clients is derived from the *loaded page* (20 web / 50 Flutter), so it structurally cannot reflect true unread. A correct server endpoint exists with **zero callers**. | **[R]** `use-notification-center.ts:62-73`; `notifications_providers.dart:27-30`; unused `GET /notifications/user/:userId/unseen-count` |
| ″ | When `markAllAsRead` exceeds the tx timeout it **rolls back atomically** → zero rows written, generic 500, UI unchanged. | **[R]** `notification.service.ts:1050` |
| "in-app has no webhook" | **Correct for Flutter** — no notification socket, FCM only; IN_APP-only notifications appear solely on manual refresh. **Wrong for web** — it *is* subscribed, but socket cache writes target a non-matching react-query key and there is **no token rotation**, so it degrades to refresh-only after the first access-token refresh. | **[R]** Flutter: only `/attention` socket exists; web: `use-notification-socket.tsx:83,180,205,226,252`, `lib/socket.ts` has no `updateToken` (the attention socket does, at `attention-socket.ts:104-108`) |

**Estimated volume today** (agent estimate, assumptions stated): ~110–120 in-app rows/day for a
shop-floor PRODUCTION collaborator; **3–5×** that for ADMIN (`ADMIN` appears in 176/196 configs).
One unread week ≈ 600+; the 30-day retention floor ≈ 3,000.

---

## 2. Phases

Ordered so that each phase is shippable on its own and earlier phases de-risk later ones.
Volume reduction (Phase 4) is the biggest *felt* relief but is deliberately **after** read-state
correctness — cutting the inflow while "read" still doesn't work leaves the existing pile.

### Phase 1 — Make "read" true and fast · API · ~1 day
1. **Rewrite `markAllAsRead`** (`notification.service.ts:965-1056`): one `findMany({select:{id}})`
   → one `seenNotification.createMany({ skipDuplicates: true })` → one aggregate ChangeLog row.
   Delete the two diagnostic `count()` calls (`:971`,`:977`) that exist only to write log lines.
   Paginate outside the transaction instead of the 1000-row cap.
2. **`upsert` instead of `findFirst`→`create`** (`notification.service.ts:887-907`,
   `notification-tracking.service.ts:60-80`), keyed on `userId_notificationId`. Today a
   double-click races to P2002 and surfaces as a 500.
3. **Migration**: `@@index([userId, createdAt])` on `Notification`, `@@index([notificationId])`
   on `SeenNotification`.
4. **Make the list `count()` opt-in** via a `withTotal` flag (`notification-prisma.repository.ts:282-293`).
5. **Fix the `unread` filter** — it emits `seenBy: { none: {} }` ("seen by nobody") instead of
   scoping to the requester (`api/src/schemas/notification.ts:432-438`, mirror in
   `web/src/schemas/notification.ts`). It also can't use the unique index without the leading column.
6. **Bound `getUnseenNotifications`** — currently an unbounded `findMany` with nested includes.

### Phase 2 — Make the badge honest · all three · ~0.5 day
- Wire the existing `GET /notifications/user/:userId/unseen-count` into both badges; keep the
  page-derived count only as an offline fallback.
- Web already **receives** `notification:count` over the socket and throws it away
  (`SocketNotificationsListener` discards it) — feed it to the badge.

### Phase 3 — Mark-as-read UX parity · web + Flutter · ~1 day
- **Flutter**: add `include.seenBy` to `list()` **and compare `seen.userId` to the current user**.
  Do *not* use `seenBy.isNotEmpty` — sector-wide notifications would flip to read for everyone the
  moment one person opens one.
- **Flutter**: add `markAllSeen()` + a "Marcar todas como lidas" action in the drawer header.
- **Both**: optimistic update with rollback on failure.
- **Both**: allow a success toast for the *explicit bulk* action only; keep per-item marking silent.
- **Flutter**: drop the full 50-row refetch after every tap once optimistic updates land.
- **Port from web** (already correct there): invalidate the `["notifications"]` **prefix**, which
  subsumes every filtered variant of the list key (`use-notification.ts:181-183`). This is the one
  reason web does not show mobile's stale-unread symptom.

### Phase 4 — Volume, data-only · API seed + one cron · ~0.5 day · **biggest immediate relief**
No application code changes; lowest deploy risk.
1. **Flip `IN_APP.mandatory` `true`→`false`** on the 194 configs (keep `enabled`/`defaultOn`).
   This alone makes the entire existing, already-initialized preference system function.
   ⚠️ See Decision 1.
2. **Set `deduplicationWindow`** (30–120 min) on the 34 `task.field.*` + 44 `service_order.*`
   configs. **Never `0`** — falsy silently disables the check.
3. **Set `maxFrequencyPerDay`** (3–5) on the same families. This check *is* per-recipient.
4. **Trim `targetRule.allowedSectors`** — `ADMIN` on 176/196 is why admins drown.
5. **Retention**: run daily instead of monthly (`notification-scheduler.service.ts:229`), and drop
   or relax the `sentAt: { not: null }` guard — any notification whose deliveries all failed is
   **never purged today**. Add a purge for notification ChangeLog rows (2 per mark-as-read,
   currently uncovered).
6. **One-time backlog clear** — see Decision 3.

### Phase 5 — Volume, targeting · API code · ~2–3 days · **highest ceiling**
- `service_order.*.production` (~55 rows/day/user, the single biggest bucket) → route to the SO
  assignee + sector manager via `dispatchByConfigurationToUsers`.
- `task.field.*` → route to `task.responsibles`. The pattern already exists at
  `task-field-tracker.service.ts:175` for `task.assigned`.

### Phase 6 — Real-time parity · ~1.5 days
- **Web, highest value/effort ratio**: add `updateNotificationSocketToken` mirroring
  `attention-socket.ts:104-108`. Without it, socket.io replays the stale handshake token on
  reconnect, the gateway disconnects it, and after 5 attempts web is silently refresh-only until a
  page reload. Raise `maxReconnectAttempts` toward the attention socket's `Infinity`, and
  invalidate on every `connect` to close the drop→reconnect gap.
- **Web**: socket handlers must invalidate the `["notifications"]` prefix rather than
  `setQueryData` on `notificationKeys.list()` (no params), which never matches the center's
  parameterized key. Drop the phantom `isSeenByUser` shape. Delete the three client emits that
  have no server handler (`notification:mark-read`, `notification:mark-all-read`,
  `notification:count-request` vs the gateway's `mark.read` / `mark.delivered`).
- **Flutter**: new `lib/core/notifications/notification_socket.dart` structurally copied from
  `core/attention/attention_socket.dart` — namespace `/notifications`, `setAuth({token})`,
  infinite reconnect, `onConnected` → invalidate the list. `socket_io_client` is already in
  `pubspec.yaml`; no new dependency. The server contract (`notification:new`,
  `notification:count`) already exists and works.
- **Decision 5**: channel policy for a backgrounded/killed Flutter app.

### Phase 7 — Consolidation / debt · ~1 day
- **Resolve the 3 duplicate routes** left after the route-shadowing fix: `GET /notifications`,
  `GET /notifications/reminders/stats`, `POST /notifications/reminders/process`. In particular
  `NotificationApiController.getNotifications` is shadowed and documents an `isRead` contract that
  **never ships at runtime** — delete it or make it the winner deliberately.
- **Unify mark-read.** Web calls `POST /notifications/:id/mark-as-read`; Flutter calls
  `POST /seen-notifications/mark-as-read/:id`. These are **not equivalent** — only the Flutter path
  writes ChangeLog entries and emits the gateway seen-broadcast. Pick one; sync all three packages.
  ⚠️ Decision 4.
- **Collapse the three overlapping reminder crons** into one (`notification-scheduler.service.ts:105`,
  `notification-reminder.scheduler.ts:29`, `notification-reminder-scheduler.service.ts:384` all scan
  `SeenNotification.remindAt`).
- **Smooth the 07:00 burst** — work-hours deferral parks everything overnight and the
  EVERY_MINUTE scheduler dumps the whole backlog at once.
- **~2,900 lines of dead machinery**: `notification-filter.service.ts`, `task-notification.service.ts`,
  `notification-recipient-resolver.service.ts`, `notification-channel-resolver.service.ts` are
  registered but never injected. Delete or wire.
  ⚠️ **`notification-aggregation.service.ts` (873 lines) must NOT simply be switched on** — as
  written, `flushGroup` creates a summary row but never removes or hides the N grouped rows, so it
  produces **N+1**. It also bails on `HIGH`/`URGENT`, which covers ~half the configs. Treat it as
  60%-done, not a switch.
- **Remove the phantom `batchingEnabled`** — settable in the admin UI, read by nothing.

---

## 3. Decisions needed before implementation

1. **Mandatory in-app allowlist.** Flipping all 194 lets a user silence *anything*, including
   safety/compliance warnings. Which event families must stay mandatory? (Suggested: warnings,
   PPE expiry, mandatory-signature ceremonies.)
2. **Dedup semantics.** `checkDeduplication` keys on `(configKey, entityId)` **globally**, not
   per-recipient — a 60-min window on `task.field.observation` suppresses that key for that task
   for *everyone*, including someone who hasn't seen the first one. Acceptable?
3. **Existing backlog.** Purge outright at a cutoff date, or mark-all-read for every user and let
   retention drain it?
4. **Audit trail on read.** The current Flutter path writes 2 ChangeLog rows per mark-as-read
   (and 2 per item in mark-all). Keep that audit trail, or drop it for read-state?
5. **Mobile channel policy.** Even with a Flutter notification socket, a backgrounded app needs
   PUSH. Make PUSH default-on alongside IN_APP, or accept foreground-only socket delivery?

---

## 4. Expected effect

| Metric | Today | After Phase 4 | After Phase 5 |
|---|---|---|---|
| In-app rows/day, shop-floor collaborator | ~115 | ~30–40 | ~15 |
| In-app rows/day, ADMIN | ~400–600 | ~120–200 | ~60 |
| Mark-all-as-read at 3,000 unread | times out, writes nothing | single `createMany` | ″ |
| Badge accuracy | capped at page size | authoritative server count | ″ |
| Flutter unread display | permanently stuck | correct | ″ |
| Flutter live delivery | FCM only | ″ | socket + FCM (Phase 6) |

Estimates carry the agent's stated assumptions (~15 tasks in flight, ~3 tracked field edits per
task/day, ~4 SO transitions per task/day). Treat the ratios as more reliable than the absolutes.

## 5. Suggested first ship

**Phase 4 (data-only) + Phase 1 items 1–3 + Phase 3 Flutter `include.seenBy`.**
That is one seed edit, one cron expression, one migration, one service rewrite, and one line in the
Flutter repository — and it addresses five of the six reported symptoms without touching the
dispatch topology or the socket layer.
