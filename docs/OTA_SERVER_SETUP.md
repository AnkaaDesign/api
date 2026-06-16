# OTA Updates — Server-Side Setup (API)

This is the **server side** of the self-hosted Expo OTA system. It explains what
the API does, what must exist on the production host, and how an OTA bundle
published from a dev machine becomes live.

- The **mobile/build/publish** side is documented in `mobile/docs/DEPLOYMENT.md`
  and `mobile/docs/OTA_SELF_HOSTED_UPDATES.md`.
- This file is the thing to follow when "set up OTA on the server" is the task.

---

## 1. What the API serves

The OTA server lives in `src/modules/system/update/` and implements the Expo
Updates protocol (v0/v1). It exposes two **public** (pre-auth) routes:

| Route | Purpose | Auth | Rate limit |
|---|---|---|---|
| `GET /updates/manifest` | Returns the manifest for a given `platform` + `runtime-version` | `@Public` | `@ReadRateLimit` |
| `GET /updates/assets` | Serves the JS bundle and individual assets | `@Public` | `@NoRateLimit` |

These MUST stay public — the app queries them before any user is logged in.

The mobile app is configured to poll:
`https://api.ankaadesign.com.br/updates/manifest` (see `mobile/app.json` →
`expo.updates.url`). So in production the API must be reachable at that host over
HTTPS, and `/updates/*` must NOT be blocked by auth middleware or the reverse proxy.

---

## 2. Where update files live on disk

The API reads published bundles from a root folder, **one sub-folder per
runtimeVersion (fingerprint)**:

```
<UPDATES_ROOT>/
  <iosFingerprint>/        # e.g. 34b965c6...
    metadata.json
    _expo/...
    assets/...
    expo-publish.json      # sidecar: createdAt + git commit
  <androidFingerprint>/    # e.g. 394c7c52...
    metadata.json
    _expo/...
    assets/...
    expo-publish.json
```

**Root resolution** (`update.service.ts`):
```
UPDATES_ROOT  (env var, if set)
   else  <process.cwd()>/updates     ← cwd = the API root where `node dist/main.js` runs
```

In the repo, `/updates/*` is **gitignored** (only `/updates/.gitkeep` is tracked) —
published bundles are deploy artifacts, never committed.

---

## 3. Production environment variables

Set these on the prod API host (in the API's `.env` / process manager env):

| Var | Required? | What it does |
|---|---|---|
| `UPDATES_ROOT` | Recommended | Absolute path to the updates folder. Set this so it doesn't depend on the process cwd. e.g. `/srv/api/updates` (or wherever the API is deployed). |
| `UPDATES_PUBLIC_URL` | Recommended | Public origin used to build asset URLs in the manifest, e.g. `https://api.ankaadesign.com.br`. If unset, the API derives it from `X-Forwarded-Proto` / `X-Forwarded-Host` (so nginx must forward those). |
| `EXPO_UPDATES_PRIVATE_KEY_PATH` | Optional | Absolute path to a PEM RSA private key to **sign** manifests (code signing). Only needed once code signing is enabled in the app (see §6). |

> If you rely on the cwd default instead of `UPDATES_ROOT`, make sure the process
> manager starts the API with its working directory at the API root, or the
> folder will resolve somewhere unexpected.

---

## 4. One-time server setup checklist

1. **Create the updates folder** at the path you'll use:
   ```bash
   mkdir -p /srv/api/updates        # match UPDATES_ROOT
   ```
2. **Set env vars** (`UPDATES_ROOT`, `UPDATES_PUBLIC_URL`) and restart the API.
3. **Reverse proxy (nginx):** ensure `/updates/` is proxied to the API and
   forwards proto/host headers. Asset responses can be large — don't buffer-cap
   them. Example:
   ```nginx
   location /updates/ {
       proxy_pass http://127.0.0.1:3030;
       proxy_set_header Host              $host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header X-Forwarded-Host  $host;
       proxy_read_timeout 120s;
       client_max_body_size 0;     # allow large asset transfers
   }
   ```
4. **Smoke test** (no auth needed):
   ```bash
   curl -s -H "expo-platform: android" \
        -H "expo-runtime-version: <androidFingerprint>" \
        https://api.ankaadesign.com.br/updates/manifest | head
   ```
   A 404 here means no bundle is published for that fingerprint yet (expected
   until the first publish); a 200 multipart response means it's working.

---

## 5. Publishing flow (how a bundle gets here)

Done from a dev machine (see `mobile/docs/DEPLOYMENT.md` §5). Summary:

```bash
# on the dev machine, in mobile/
npm run ota:publish     # exports JS → ../api/updates/<fingerprint>/  (local copy)

# then push the folders to the prod API host:
rsync -avz --delay-updates ../api/updates/ <user>@<host>:<UPDATES_ROOT>/
#   --delay-updates makes the swap near-atomic so the API never reads a
#   half-copied folder.
```

The API auto-detects new folders (it reads them per request, with a manifest
cache keyed on `metadata.json` mtime — a new/updated folder is picked up with no
restart).

> **TODO when setting up:** fill in the real `<user>@<host>:<UPDATES_ROOT>` for
> the prod box and record it here so the rsync command is copy-pasteable.

---

## 6. Code signing (optional, recommended for production)

Currently updates are protected by TLS only (no manifest signature). To add
integrity signing:

1. Generate an RSA keypair; keep the private key on the prod host only.
2. Add the **public** cert to the app (`mobile/app.json` `updates.codeSigning…`)
   and ship it in a **new native build** (changes the fingerprint).
3. Set `EXPO_UPDATES_PRIVATE_KEY_PATH=/secure/path/key.pem` on the API.
   When the client sends `expo-expect-signature`, the manifest is signed and the
   signature returned in the multipart header.

Until step 2's build is in the field, leave signing disabled.

---

## 7. Operational notes

- **Old fingerprint folders are never pruned** — over time `UPDATES_ROOT` accrues
  one folder per native build. Delete stale ones manually when disk grows (keep
  the fingerprints of binaries still in the field).
- **The `system/deployment` module is NOT this** — it's an unrelated (and largely
  dead) git/systemd deploy feature. OTA = `system/update` only.
- **A manifest 404 for a fingerprint that should exist** = the published folder
  name doesn't match the runtimeVersion the app requests. Verify the app's
  embedded fingerprint equals the published folder name (the classic drift bug;
  see `mobile/docs/DEPLOYMENT.md`).
