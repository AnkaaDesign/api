# Install / Deep-Link Deployment

Nginx + static-serving rules for the self-hosted app install system and the
iOS/Android deep-link verification files.

## Shared contract

| Thing | Value |
| --- | --- |
| Web / universal-link domain | `https://ankaadesign.com.br` (+ `www.`) |
| API base | `https://api.ankaadesign.com.br` |
| iOS appID | `VDN4DBVKPJ.com.ankaadesign.management` |
| Android package | `com.ankaadesign.management` |
| Custom scheme | `ankaadesign://` |
| Install page (SPA route, opens in browser) | `https://ankaadesign.com.br/install` |
| Binaries served by API | `/install/version`, `/install/manifest.plist`, `/install/ios/app.ipa`, `/install/android/app.apk` on `api.ankaadesign.com.br` |

## Verification files (`.well-known/`)

Two identical mirrors exist and must stay byte-for-byte in sync:

- `web/public/.well-known/` — built into `web/dist/.well-known/` by Vite
  (Vite copies everything in `public/` verbatim; default `publicDir: "public"`,
  no override — confirmed `web/dist/.well-known/` already contains both files).
  Served by nginx as the **document root** of `ankaadesign.com.br`. This copy is
  **authoritative** for iOS Universal Links (it's the `associatedDomains` host).
- `api/public/.well-known/` — served at the API root by NestJS
  `app.useStaticAssets(publicPath)` (no prefix → mounted at `/`) in
  `api/src/main.ts`, so `https://api.ankaadesign.com.br/.well-known/*` also
  resolves. Mirror only; **not** authoritative for iOS.

Status (verified): both AASA and both `assetlinks.json` are valid JSON, contain
the correct appID / package, and the AASA path components do **not** match
`/install` (so the install page always opens in the browser). See
`web/public/.well-known/README.md` for the Android-fingerprint dependency.

## Nginx — `ankaadesign.com.br` (the SPA / web host)

The SPA uses an `index.html` fallback. The two `.well-known` files **must bypass
that fallback** with exact-match `location =` blocks, otherwise Apple/Google
receive the SPA's HTML instead of JSON and verification fails. `location =`
(exact match) is evaluated before the prefix/`try_files` block, so ordering is
safe, but keep them above the SPA `location /` for clarity.

```nginx
server {
    listen 443 ssl http2;
    server_name ankaadesign.com.br www.ankaadesign.com.br;

    # ... ssl_certificate / ssl_certificate_key ...

    root /var/www/ankaa/web/dist;
    index index.html;

    # --- Deep-link verification files: serve as JSON, bypass SPA fallback ---
    location = /.well-known/apple-app-site-association {
        default_type application/json;
        add_header Cache-Control "no-cache";
        try_files $uri =404;          # never fall through to index.html
    }

    location = /.well-known/assetlinks.json {
        default_type application/json;
        add_header Cache-Control "no-cache";
        try_files $uri =404;
    }

    # --- SPA fallback: every client route (including /install) -> index.html ---
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Notes:
- `/install` is a **client-side SPA route**. It deliberately has no special
  block — it falls through `try_files $uri $uri/ /index.html` and is rendered by
  the React app in the browser. Do not deep-link it into the app.
- `apple-app-site-association` has **no** file extension and must be sent with
  `Content-Type: application/json` and **no** redirect — hence `default_type`
  and the exact-match location.

## Nginx — `api.ankaadesign.com.br` (reverse proxy to Node API)

If the API is fronted by nginx, proxy the install binary routes and raise the
upload limits/timeouts so the admin can upload large `.ipa` / `.apk` files via
`POST /install/publish/{ios,android}` (multipart).

```nginx
server {
    listen 443 ssl http2;
    server_name api.ankaadesign.com.br;

    # ... ssl_certificate / ssl_certificate_key (valid cert required, see below) ...

    # Large APK/IPA uploads (admin publish) and downloads
    client_max_body_size 600M;        # APK/IPA can be hundreds of MB
    proxy_read_timeout   600s;        # don't time out big uploads/streams
    proxy_send_timeout   600s;
    proxy_request_buffering off;      # stream uploads straight to Node

    location / {
        proxy_pass         http://127.0.0.1:3000;   # Node API port
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

This single proxy covers `/install/version`, `/install/manifest.plist`,
`/install/ios/app.ipa`, `/install/android/app.apk`,
`/install/publish/{ios,android}`, and `/.well-known/*` (mirror) — all served by
the Node API. No special-casing needed beyond the body-size / timeout bumps.

## iOS `itms-services` requirement

The iOS over-the-air install uses the `itms-services://?action=download-manifest`
flow. Both the manifest **and** the referenced `.ipa` must be served over
**HTTPS with a valid (non-self-signed) certificate** — already true for
`api.ankaadesign.com.br`. The manifest (`/install/manifest.plist`) references the
absolute HTTPS URL of `/install/ios/app.ipa`; if either is HTTP or has a cert
error, iOS silently refuses the install. No action needed beyond keeping the cert
valid.

## Android signing → `assetlinks.json` dependency (the live blocker)

`assetlinks.json > sha256_cert_fingerprints` must equal the SHA-256 of the
keystore that signs the **release APK users install**. Today the release APK is
signed with an ephemeral / debug / EAS-managed key, so the fingerprint shifts
every build and **Android App Links auto-verify fails**. The custom scheme
`ankaadesign://` still opens the app from the install page's tap gesture, so
"open app if installed" keeps working; only silent HTTPS auto-open is degraded.

**Fix:** once the mobile team locks a permanent release keystore, paste its
SHA-256 fingerprint into `sha256_cert_fingerprints` in **both**
`web/public/.well-known/assetlinks.json` and
`api/public/.well-known/assetlinks.json`, redeploy, and re-verify. Full steps in
`web/public/.well-known/README.md`.
