# Server Runbook — OTA Updates + Self-Hosted App Install

Instructions for the **Claude session running on the production server** to deploy and
configure (1) the self-hosted Expo OTA update server and (2) the self-hosted iOS/Android
app install system.

- **API**: `https://api.ankaadesign.com.br` (NestJS, this repo, behind nginx + pm2)
- **Web**: `https://ankaadesign.com.br` (Vite SPA, `web` repo, served by nginx from `web/dist`)
- The web app, AASA, and install landing page all live on `ankaadesign.com.br`.
- Detailed nginx snippets live in `api/INSTALL_DEPLOYMENT.md` (this repo).

---

## ⚠️ CRITICAL GOTCHA — persistent storage paths

Two API features write files to disk. Their **defaults live inside the build output**
(`dist/…`), which is **wiped on every `npm run build`**. You **MUST** point them at
persistent directories OUTSIDE the repo, or every deploy silently deletes the uploaded
`.ipa`/`.apk` and the published OTA bundle.

Set in the API's production environment (e.g. the pm2 ecosystem file / `.env.production`):

```bash
INSTALL_DIR=/var/www/ankaa/install-binaries     # stores AnkaaDesign.ipa, AnkaaDesign.apk, meta.json
INSTALL_PUBLIC_URL=https://api.ankaadesign.com.br   # (default already correct)
UPDATES_ROOT=/var/www/ankaa/updates             # stores OTA bundles per runtimeVersion
```

Then: `mkdir -p /var/www/ankaa/install-binaries /var/www/ankaa/updates` and make them
writable by the API process user. These dirs survive deploys.

---

## 1. Deploy the code

```bash
# API (this repo)
cd ~/ankaa/api && git pull origin main
npm ci
npm run build
pm2 restart ankaa-api   # or: npm run start:prod under your process manager

# WEB
cd ~/ankaa/web && git pull origin main
npm ci
npm run build           # emits web/dist, INCLUDING dist/.well-known/*
# deploy dist to the nginx web root (rsync/symlink per your setup)

# MOBILE (pull only — not deployed; keeps scripts/keystore config in sync)
cd ~/ankaa/mobile && git pull origin main
```

The `InstallModule` auto-creates `INSTALL_DIR` on boot. **No database migration** is needed
for either feature.

---

## 2. nginx

Apply the blocks from `api/INSTALL_DEPLOYMENT.md`, summarised:

**`api.ankaadesign.com.br`** (allow large admin uploads to `/install/publish/*`):
```nginx
client_max_body_size 600M;
proxy_read_timeout 600s;
proxy_request_buffering off;
# ensure /install/* and /updates/* proxy to the Node API (usually already covered by `location /`)
```

**`ankaadesign.com.br`** (serve the deep-link verification files correctly — they MUST
bypass the SPA `try_files … /index.html` fallback, or Apple/Google receive HTML and
verification fails):
```nginx
location = /.well-known/apple-app-site-association { default_type application/json; add_header Cache-Control "no-cache"; try_files $uri =404; }
location = /.well-known/assetlinks.json            { default_type application/json; add_header Cache-Control "no-cache"; try_files $uri =404; }
location / { try_files $uri $uri/ /index.html; }   # /install falls through here (SPA route)
```

Then: `nginx -t && systemctl reload nginx`.

---

## 3. Publish binaries (install system)

Binaries are **built on the developer's Mac** (Xcode archive → ad-hoc `.ipa`; local gradle
`assembleRelease` → `.apk`) and pushed to the API. From the dev machine:

```bash
ANKAA_ADMIN_TOKEN=<admin-jwt> mobile/scripts/publish-install.sh ios     build/ipa/AnkaaDesign.ipa 1.0 7
ANKAA_ADMIN_TOKEN=<admin-jwt> mobile/scripts/publish-install.sh android app-release.apk            1.0 6
```

**Server-side manual fallback** (if the upload endpoint is unavailable): place the binary in
`$INSTALL_DIR/<platform>/` and edit `$INSTALL_DIR/meta.json`:
```json
{ "ios":     { "version": "1.0", "build": 7, "file": "ios/AnkaaDesign.ipa" },
  "android": { "version": "1.0", "build": 6, "file": "android/app-release.apk" } }
```

---

## 4. Publish an OTA update (runtimeVersion 7)

OTA delivers JS-only changes to already-installed shells. From the **mobile** repo:

```bash
cd ~/ankaa/mobile
npm run ota:verify       # confirm runtimeVersion alignment (currently "7")
npm run ota:publish      # exports the JS bundle + writes it to the OTA store
```

Inspect `mobile/scripts/publish-ota.mjs` to confirm whether it writes directly into
`UPDATES_ROOT` on this server or uploads remotely, and that signing keys
(`EXPO_UPDATES_PRIVATE_KEY_PATH`, `EXPO_UPDATES_KEY_ID`) are set if signature is expected.
A native rebuild is required only when native code or `runtimeVersion` changes — not for
plain JS updates.

---

## 5. Android App Links fingerprint (one-time, after the keystore is locked)

The dev generates ONE permanent release keystore (`mobile/scripts/generate-release-keystore.sh`).
Its stable SHA-256 must be pinned in **both** mirrors:
- `web/public/.well-known/assetlinks.json`
- `api/public/.well-known/assetlinks.json`

After updating, redeploy web + restart API. Until then, Android auto-open (App Links) won't
verify, but the custom scheme `ankaadesign://` still opens the app from the install page — so
core UX works regardless.

---

## 6. Verify

```bash
curl -s https://api.ankaadesign.com.br/install/version            # {ios:{...available}, android:{...}}
curl -sI https://api.ankaadesign.com.br/install/ios/app.ipa       # 200 + application/octet-stream (once published)
curl -s  https://api.ankaadesign.com.br/install/manifest.plist    # itms-services plist XML
curl -sI https://ankaadesign.com.br/.well-known/apple-app-site-association   # 200 + content-type application/json (NOT text/html)
curl -sI https://ankaadesign.com.br/.well-known/assetlinks.json              # 200 + application/json
curl -s  "https://api.ankaadesign.com.br/updates/manifest" -H "expo-platform: ios" -H "expo-runtime-version: 7"   # OTA manifest or 404 "No update available"
```

If the AASA returns `content-type: text/html`, the nginx exact-match block in step 2 is
missing — the SPA fallback is swallowing it and iOS Universal Links will not work.

---

## Quick reference — what runs where

| Task | Where | Command |
|---|---|---|
| Deploy API / web | server | `git pull && npm ci && npm run build && pm2 restart` |
| Persistent dirs/env | server | set `INSTALL_DIR`, `UPDATES_ROOT`, `INSTALL_PUBLIC_URL` |
| nginx `.well-known` + upload limit | server | `api/INSTALL_DEPLOYMENT.md` |
| Build `.ipa` / `.apk` | dev Mac | Xcode archive / `npm run android:apk` |
| Publish binary | dev Mac | `mobile/scripts/publish-install.sh` |
| Publish OTA JS | mobile repo | `npm run ota:publish` |
| Generate keystore | dev Mac (once) | `mobile/scripts/generate-release-keystore.sh` |
