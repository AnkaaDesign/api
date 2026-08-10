# Auth refresh-token rollout & fix

## Why users kept getting logged out (two independent bugs)

1. **Short access token + no refresh token.** Production was running the
   **development** env (`.env` → `.env.development`): `JWT_EXPIRATION="7d"` and the
   throwaway dev secret. With no refresh mechanism anywhere, every user was forced
   to fully re-login roughly weekly.
2. **The auth guard turned transient backend faults into `401`.**
   `auth.guard.ts` runs a DB lookup on every request; its old catch-all converted
   *any* thrown error (incl. a momentary DB/network hiccup) into
   `401 "Token inválido ou expirado"`, and every client treats `401` as "log out".
   This is the "it logs me out when the internet glitches" symptom.

Both are now fixed in code. **Bug #2's fix (guard) ships with the API and needs no
config.** Bug #1's fix is the refresh-token flow below.

## What changed in code

- **API**: new `RefreshToken` model (hashed, per-device, revocable) + migration
  `20260721010000_add_refresh_tokens`. Login issues a short access token **and** a
  long opaque refresh token. `POST /auth/refresh` is now **public** and exchanges a
  refresh token for a fresh access token (works after the access token expired).
  Logout / admin-logout revoke refresh tokens. Guard `401` narrowed to real
  JWT-verify failures only.
- **Web** & **Mobile**: store the refresh token; on `401`, single-flight refresh +
  retry the original request; only log out if the refresh itself fails. `5xx`/network
  errors keep the session.

New env vars (see `.env.example`):
- `JWT_ACCESS_EXPIRATION` (default `1h`) — access-token lifetime.
- `JWT_REFRESH_EXPIRATION_DAYS` (default `60`) — refresh-token lifetime.
- `JWT_EXPIRATION` is now **deprecated / unused** for the access-token lifetime.

## Rollout order (do NOT skip the sequencing)

### 1. Apply the DB migration
```bash
# on the server, in api/
pnpm prisma migrate deploy   # applies 20260721010000_add_refresh_tokens
```

### 2. Fix the server env (this is the root misconfig)
The server was loading the dev config. Set these **on the production server's active
env** (the file `docker-compose.yml` loads via `env_file: - .env`):
- `JWT_SECRET` → the **real production secret** (NOT the dev placeholder
  `dev-jwt-secret-...`). ⚠️ Changing the secret invalidates all current access
  tokens → **everyone re-logs in once**. Do this now (one-time), not later.
  Refresh tokens are opaque hashes, independent of `JWT_SECRET`, so future secret
  rotations won't force logouts once clients hold refresh tokens.
- `JWT_ACCESS_EXPIRATION` → **start at `"7d"`** (see step 5 for why), not `1h` yet.
- `JWT_REFRESH_EXPIRATION_DAYS` → `"60"`.

> If the server's `.env` is a symlink to `.env.development` (as on the dev machine),
> repoint it to `.env.production` — but first confirm `.env.production` has the
> correct `DATABASE_URL`, Redis, and other prod values, since switching swaps **all**
> vars, not just JWT.

### 3. Deploy the API
Ship the API with the migration applied and the env above.

### 4. Deploy the new web client
Web adoption is immediate (served from the server) — as soon as it's live, web users
get refresh tokens and stop being logged out.

### 5. Ship the new mobile client, THEN tighten the access TTL
Mobile installs lag (OTA / app store). While `JWT_ACCESS_EXPIRATION="7d"`:
- **Old** clients (no refresh support) keep working exactly as before (weekly login).
- **New** clients store the refresh token and refresh silently.

Once the new mobile build is broadly adopted, set `JWT_ACCESS_EXPIRATION="1h"` and
restart the API (env-only change, no code redeploy). Now access tokens are short and
refresh silently everywhere. **Do not set `1h` before mobile adoption**, or laggard
old-app users would be logged out hourly.

## Optional housekeeping
- Add a periodic cleanup of expired/revoked `RefreshToken` rows (e.g. a daily job
  deleting `expiresAt < now() OR revokedAt IS NOT NULL AND revokedAt < now() - 30d`).

---

# Post-mortem — 2026-08-10: the logouts never actually stopped

The rollout above shipped, and the shop floor kept logging in ~3-4 times a day.
Measured over 15 days of production logs:

| client | logins/day | `/auth/refresh`/day |
|---|---|---|
| Flutter app (`Dart/3.12`) | ~40 | ~1-17 |
| Web (`Mozilla/*`)         | ~1-7 | ~100-130 |

Web was renewing normally. The app was not renewing at all — it re-authenticated
instead. One user (32 logins in 8 days) had 32 refresh tokens in `RefreshToken`,
**all active, none ever revoked, none ever used**. The server was handing out
refresh tokens the app then never presented.

## Three causes, all required to be fixed

### 1. `JWT_ACCESS_EXPIRATION` was never set in production
Step 5 above says to tighten it *after* mobile adoption. It was never set at all —
so `auth.service.ts` fell through to its `'1h'` code default. Access tokens lived
one hour, which meant the refresh path ran on *every* app open and any weakness in
it turned into a login prompt.

**Fixed:** `JWT_ACCESS_EXPIRATION="30d"`, `JWT_REFRESH_EXPIRATION_DAYS="365"` in the
production `.env`, and the code defaults raised to match so a missing variable can
never again mean "log everyone out hourly". A short access TTL only bounds the
window for a *stolen* token — it does not bound a terminated employee, because the
guard re-reads the user (and `isUserEmployed`) on every single request.

### 2. The app could not produce its refresh token
Cold-start traces show the app sending an expired access token (401 body =
"Token inválido ou expirado", so the token *was* read back from storage) and then
making **zero** `/auth/refresh` calls before dropping to the login screen. The
access token survived the restart; its refresh token did not. They were two keys in
`flutter_secure_storage` written back-to-back.

**Fixed:** both values now live in ONE json blob under ONE key
(`ankaa:auth:session`), so "access token without refresh token" cannot be
represented. Writes are read back and retried. Android auto-backup is off (it
restores the encrypted prefs file without the Keystore key that decrypts it) and
iOS uses `first_unlock` so a background launch on a locked handset can still read
the session.

### 3. Every layer treated "I couldn't refresh" as "the session is over"
- `dio_client`: no refresh token in hand → `dead` → logout, *without ever asking
  the server*.
- `auth_controller._restore()` / `refreshUser()`: any 401 → `_clearSession()`,
  which threw away the still-valid refresh token — undoing the interceptor's own
  "don't log out on transient failures" logic.

**Fixed:** exactly one signal ends a session — the server answering 401 to
`/auth/refresh`. A missing refresh token, a network failure, a 5xx, a timeout and a
replayed request that 401s again all keep the session. The refresh itself retries
3× with backoff. Covered by `test/core/auth_refresh_flow_test.dart` in the app repo.

## Known trade-off
With a 30-day access token, `adminLogoutUser` (revoke refresh tokens + clear
`sessionToken`) no longer forces a still-employed user off within the hour — the
guard does not check `sessionToken`, so their current access token stays valid until
it expires. Deactivating/terminating the account *is* immediate. If instant forced
logout matters, add a `sessionsInvalidatedAt` column on `User` and reject tokens
whose `iat` predates it — the guard already loads the user, so it costs nothing.
