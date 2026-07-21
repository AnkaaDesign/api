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
