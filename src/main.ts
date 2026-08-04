// Setup module aliases first (production)
if (process.env.NODE_ENV === 'production') {
  require('module-alias/register');
}

// Import polyfills
import './polyfills';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { UserContextInterceptor } from './modules/common/interceptors';
import { GlobalExceptionFilter } from './common/filters';
import { securityConfig } from './common/config/security.config';
import { extname, join, normalize, resolve, sep } from 'path';
import { existsSync } from 'fs';
import helmet from 'helmet';
import * as express from 'express';
import * as qs from 'qs';
import 'tsconfig-paths/register';
import {
  handleMulterError,
  uploadSecurityMiddleware,
  uploadCleanupMiddleware,
} from './common/middleware/upload.middleware';
import { env } from './common/config/env.validation';
import { secretsManager } from './common/config/secrets.manager';
import { ServerOptions } from 'socket.io';

// Global error handlers to prevent crashes
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    console.error('Stack trace:', reason?.stack);
  }
  // Log the error but don't exit the process immediately
  // Let PM2 handle the restart if needed
});

process.on('uncaughtException', (error: Error) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error('Uncaught Exception thrown:', error);
    console.error('Stack trace:', error.stack);
  }
  // Give the process time to log before exiting
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

/**
 * Custom Socket.io adapter with enhanced CORS and security configuration
 * Configures Socket.io server with:
 * - CORS support for frontend origins
 * - WebSocket and polling transports
 * - Connection timeouts and ping intervals
 * - Path configuration for Socket.io endpoint
 */
class SocketIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions): any {
    // Get allowed origins from environment or security config
    const allowedOrigins = securityConfig.cors.origin;

    // Socket.io server configuration
    const serverOptions: ServerOptions = {
      ...options,
      // CORS configuration for WebSocket connections
      cors: {
        origin:
          typeof allowedOrigins === 'function'
            ? (origin, callback) => allowedOrigins(origin, callback)
            : allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization'],
      },
      // Transport protocols (WebSocket preferred, polling fallback)
      transports: ['websocket', 'polling'],
      // Socket.io endpoint path
      path: '/socket.io',
      // Connection settings
      pingTimeout: 60000, // 60 seconds
      pingInterval: 25000, // 25 seconds
      upgradeTimeout: 10000, // 10 seconds
      maxHttpBufferSize: 1e6, // 1MB
      // Allow HTTP long-polling fallback
      allowEIO3: true,
      // Cookie configuration
      cookie: false, // Use JWT in handshake instead of cookies
    };

    const server = super.createIOServer(port, serverOptions);

    if (process.env.NODE_ENV !== 'production') {
      console.log('Socket.io server configured:');
      console.log('  - Path: /socket.io');
      console.log('  - Transports: websocket, polling');
      console.log('  - CORS Origins:', allowedOrigins);
      console.log('  - Credentials: true');
    }

    return server;
  }
}

async function bootstrap() {
  try {
    // Validate secrets before starting the application
    secretsManager.validateSecrets();

    // Create NestJS app with disabled automatic body parser
    // We'll configure it manually with custom limits for large payloads (messages with images)
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      bodyParser: false, // Disable automatic body parser
    });

    // Configure Socket.io adapter for WebSocket support
    app.useWebSocketAdapter(new SocketIoAdapter(app));

    // Configure query string parser to handle bracket notation from axios.
    // Numeric coercion is INTENTIONALLY NOT done here — query schemas that
    // need numbers must opt in via z.coerce.number(). The previous blanket
    // /^\d+$/ coercion silently broke z.string() params that received all-
    // digit input (FITID search, CNPJ filter, amount filter) by turning the
    // input into a Number before Zod validation.
    app.set('query parser', (str: string) => {
      return qs.parse(str, {
        depth: 10,
        arrayLimit: 100,
        parameterLimit: 1000,
        parseArrays: true,
        allowDots: true, // Changed to true to support array[0].field notation
        strictNullHandling: true,
        decoder: (value, defaultDecoder, charset, type) => {
          // Handle boolean strings (safe — Zod schemas expecting strings can
          // re-coerce via z.preprocess if a literal "true"/"false" payload is
          // needed; none currently exist).
          if (value === 'true') return true;
          if (value === 'false') return false;
          return defaultDecoder(value, defaultDecoder, charset);
        },
      });
    });

    // Capture raw body for webhook signature verification
    // This must be done BEFORE any JSON parsing
    app.use((req: any, res, next) => {
      const isWebhookRoute =
        req.method === 'POST' &&
        (req.url === '/deployments/webhook' || req.url === '/webhooks/sicredi');

      if (isWebhookRoute) {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        req.on('end', () => {
          const rawBody = Buffer.concat(chunks);
          req.rawBody = rawBody;
          try {
            req.body = JSON.parse(rawBody.toString('utf8'));
          } catch {
            req.body = {};
          }
          req._body = true;
          next();
        });
        req.on('error', (err: Error) => next(err));
      } else {
        next();
      }
    });

    // Manually configure body parser with 50MB limit for messages with base64 images
    // This runs AFTER webhook handler so webhook can manually parse its body
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Security headers with Helmet
    // Temporarily disable some security features for debugging
    const helmetConfig = {
      ...securityConfig.helmet,
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    };
    app.use(helmet(helmetConfig));

    const validationPipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    });

    // CORS configuration with security settings
    app.enableCors(securityConfig.cors);

    // Upload security middleware
    app.use(uploadSecurityMiddleware);

    // Configure static file serving with security headers for uploads
    const uploadPath = env.UPLOAD_DIR || join(__dirname, '..', '..', 'uploads');
    app.useStaticAssets(uploadPath, {
      prefix: '/uploads/',
      // Security headers for static files
      setHeaders: (res, path) => {
        // Prevent execution of uploaded files
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', 'attachment');
        res.setHeader('X-Frame-Options', 'DENY');

        // Cache control for uploaded files
        if (path.includes('/temp/')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
        }
      },
    });

    // Serve files storage directory (FILES_ROOT) for LAN/offline access
    // In production, files are normally served by nginx via CDN (arquivos.ankaadesign.com.br)
    // This static route enables direct access from the API server when CDN is unreachable
    // (e.g., mobile/web apps on local network without internet)
    const filesRoot = env.FILES_ROOT || join(__dirname, '..', '..', 'files');
    app.useStaticAssets(filesRoot, {
      prefix: '/files/storage/',
      setHeaders: (res, filePath) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Access-Control-Allow-Origin', '*');
        // Allow inline display for images and PDFs
        const ext = filePath.split('.').pop()?.toLowerCase() || '';
        const inlineTypes = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'pdf'];
        if (!inlineTypes.includes(ext)) {
          res.setHeader('Content-Disposition', 'attachment');
        }
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
      },
    });

    // Serve favicon and other static assets from public directory
    const publicPath = join(__dirname, '..', '..', 'public');
    app.useStaticAssets(publicPath, {
      setHeaders: res => {
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
      },
    });

    // ------------------------------------------------------------------
    // Truck Studio 3D assets (/studio-assets/)
    //
    // This mount is forced, not a convenience. The Studio's geometry cannot
    // live in the repository: models/vehicles/trailer.glb alone is ~300 MB and
    // GitHub hard-rejects any blob over 100 MB, so the whole tree is
    // gitignored. It therefore exists only on the disk of whoever authored it,
    // and a fresh deploy 404s on every model. Serving it out of an rsync'd
    // directory (STUDIO_ASSETS_ROOT) is what makes a clean checkout deployable.
    //
    // These files are PUBLIC on purpose. Like the three mounts above, this is
    // plain Express middleware registered before app.init(), so it never
    // reaches Nest's APP_GUARD — express.static ends the response without ever
    // calling next(), and no guard, interceptor or filter runs. That is the
    // intended behaviour here: truck geometry and HDRIs carry no customer
    // data, and three.js loaders cannot attach an Authorization header to the
    // sub-requests a GLB triggers for its own buffers and textures. The
    // invariant to protect is on the other side: nothing but public artwork
    // may ever be rsync'd into this root.
    //
    // uploadSecurityMiddleware (above) only matches paths containing /upload
    // or /files, so /studio-assets/ does not collide with it.
    // ------------------------------------------------------------------
    const studioAssetsRoot = resolve(
      env.STUDIO_ASSETS_ROOT || join(__dirname, '..', '..', 'studio-assets'),
    );

    // Pre-compressed brotli negotiation.
    //
    // Only two families are worth precompressing, and this was MEASURED — do
    // not extend the list on intuition:
    //   trailer.glb   300 MB -> ~40 MB (13% of original)
    //   sky.hdr       5.6 MB ->  4.0 MB (71% of original)
    // Everything else lands at 88-100%: a GLB's bulk is already-compressed
    // WebP/JPEG textures embedded in its binary chunk, and binary FBX deflates
    // its own vertex arrays internally. Re-compressing those spends CPU on both
    // ends to save nothing.
    //
    // Compression is NEVER done on the fly. Running brotli over a 300 MB body
    // once per request would pin a core for the length of the transfer; the
    // .br siblings are built offline (see .env.example) and shipped by the same
    // rsync that publishes the tree. When no sibling exists we fall through
    // untouched and the identity file is served.
    app.use(
      '/studio-assets',
      (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();

        const acceptEncoding = req.headers['accept-encoding'];
        if (
          typeof acceptEncoding !== 'string' ||
          !/(?:^|,)\s*br\s*(?:;|,|$)/i.test(acceptEncoding)
        ) {
          return next();
        }

        // A ranged request must not be answered with a precompressed body: the
        // 206 would carry bytes N..M of the BROTLI stream while the client is
        // asking for bytes N..M of the GLB, and no browser reassembles that.
        // Ranged readers get the identity file, where send()'s own 206 is
        // correct — which is the whole point of keeping ranges working.
        if (req.headers.range) return next();

        // Express strips the mount path, so req.url here is the sub-path.
        // Rewriting it is safe: the router re-prepends the removed prefix to
        // whatever req.url holds when next() runs.
        const queryAt = req.url.indexOf('?');
        const encodedPath = queryAt === -1 ? req.url : req.url.slice(0, queryAt);
        const querySuffix = queryAt === -1 ? '' : req.url.slice(queryAt);

        let decodedPath: string;
        try {
          decodedPath = decodeURIComponent(encodedPath);
        } catch {
          // Malformed percent-encoding. Hand it on so express.static answers
          // with its own 400 rather than us inventing a second error shape.
          return next();
        }

        // A NUL truncates the path at the syscall boundary, so "x.glb\0.sh"
        // would satisfy the extension test below and then stat a different file.
        if (decodedPath.includes('\0')) return next();
        if (!/\.(?:glb|hdr)$/i.test(decodedPath)) return next();

        // Mirror send()'s own refusals before we stamp anything on the
        // response: it 403s any up-level segment and, under the default
        // dotfiles:'ignore', 404s any dot-prefixed one. Setting
        // Content-Encoding first would leave that error body labelled brotli,
        // and the browser would surface a decode failure instead of the status.
        if (/(?:^|[\\/])\./.test(decodedPath)) return next();

        // Traversal guard. This middleware does its own filesystem probe, so it
        // cannot lean on express.static's containment check — a "%2e%2e%2f"
        // chain would otherwise let a caller test for files outside the root and
        // read the answer off the Content-Encoding header. normalize() collapses
        // the interior "..", the strip removes what is left pointing above the
        // root, and the prefix test is the belt to that suspenders.
        const relativePath = normalize(decodedPath).replace(/^(?:\.\.[\\/])+/, '');
        const filePath = join(studioAssetsRoot, relativePath);
        if (filePath !== studioAssetsRoot && !filePath.startsWith(studioAssetsRoot + sep)) {
          return next();
        }

        if (!existsSync(`${filePath}.br`)) return next();

        res.setHeader('Content-Encoding', 'br');
        // The URL now has two representations. Only the brotli one needs Vary:
        // a cache that stored the identity body and replays it to a br-capable
        // client is still handing over something that client can read, but the
        // reverse would be undecodable garbage.
        res.setHeader('Vary', 'Accept-Encoding');
        req.url = `${encodedPath}.br${querySuffix}`;
        next();
      },
    );

    // Content types the Studio serves, derived explicitly from the extension.
    // Two reasons not to rely on the default lookup: mime@1.6.0 does not know
    // .hdr (RGBELoader needs image/vnd.radiance) or .ktx2, and the alternative
    // fix — patching express.static.mime — mutates a singleton SHARED with the
    // /uploads/, /files/storage/ and public/ mounts above, so a change made for
    // the Studio would silently change what those serve too.
    // setHeaders runs before send() picks a type and send()'s type() returns
    // early when Content-Type is already set, so what we write here wins.
    const STUDIO_CONTENT_TYPES: Record<string, string> = {
      glb: 'model/gltf-binary',
      gltf: 'model/gltf+json',
      bin: 'application/octet-stream',
      fbx: 'application/octet-stream',
      drc: 'application/octet-stream',
      hdr: 'image/vnd.radiance',
      exr: 'image/x-exr',
      ktx2: 'image/ktx2',
      webp: 'image/webp',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      svg: 'image/svg+xml',
      json: 'application/json',
      wasm: 'application/wasm',
      js: 'text/javascript; charset=utf-8',
    };

    app.useStaticAssets(studioAssetsRoot, {
      prefix: '/studio-assets/',
      setHeaders: (res, filePath) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');

        // Wide-open CORS. The Studio runs on the web origin and pulls these
        // through three.js loaders (fetch/XHR, not <script>), and there is no
        // secret in a truck mesh worth an origin allow-list.
        res.setHeader('Access-Control-Allow-Origin', '*');
        // Cross-origin readers can otherwise only see the CORS-safelisted
        // response headers, which do not include Content-Length — GLTFLoader's
        // onProgress then reports total=0 and every loading bar sits at 0% until
        // a 300 MB file lands all at once. Content-Range/Accept-Ranges are
        // exposed for the same reason on ranged reads.
        res.setHeader(
          'Access-Control-Expose-Headers',
          'Content-Length, Content-Range, Accept-Ranges',
        );

        // A full year, immutable. This is safe ONLY BECAUSE the version lives
        // in the path (/studio-assets/v1/..., v2/...), which makes each URL a
        // promise that its bytes never change; a new build ships as a new vN
        // directory. Start overwriting files inside a live vN and this becomes
        // a year-long stale-cache bug with no cache-buster left to pull.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

        // DELIBERATELY NO Content-Disposition. The /uploads/ and /files/storage/
        // mounts above force `attachment` because their payloads are untrusted
        // user files that must never render in place. Here the payloads ARE
        // meant to render: `attachment` would turn every <img> of a
        // manufacturer logo into a download prompt and stop three.js from
        // loading anything at all.

        // Strip the .br that the negotiation middleware may have appended, so
        // the type describes the DECODED entity rather than its envelope.
        // (Without this the .br responses would carry no Content-Type at all.)
        const realPath = filePath.endsWith('.br') ? filePath.slice(0, -3) : filePath;
        const contentType = STUDIO_CONTENT_TYPES[extname(realPath).slice(1).toLowerCase()];
        if (contentType) {
          res.setHeader('Content-Type', contentType);
        }
      },
    });

    app.useGlobalPipes(validationPipe);
    app.useGlobalInterceptors(new UserContextInterceptor());
    app.useGlobalFilters(new GlobalExceptionFilter());

    // Upload error handling middleware
    app.use(handleMulterError);
    app.use(uploadCleanupMiddleware);

    // No global prefix - API runs on subdomain (api.ankaadesign.com.br, test.api.ankaadesign.com.br)
    // app.setGlobalPrefix('api'); // REMOVED: Using subdomain architecture

    const port = env.API_PORT ?? env.PORT ?? 3030;
    // Bind to 0.0.0.0 to accept connections from all interfaces (IPv4)
    await app.listen(port, '0.0.0.0');

    // Signal PM2 that app is ready
    if (process.send) {
      process.send('ready');
    }

    if (process.env.NODE_ENV !== 'production') {
      const host = env.API_URL || `http://localhost:${port}`;

      console.log(`Application is running on port ${port}`);
      console.log(`HTTP API: ${host}`);
      console.log(`WebSocket Endpoints:`);
      console.log(`  - Notifications: ${host}/socket.io?namespace=/notifications`);
      console.log(`  - Base URL: ${host}/socket.io`);
      console.log(`\nWebSocket Authentication:`);
      console.log(`  - Method: JWT token in handshake`);
      console.log(`  - Query param: ?token=<JWT_TOKEN>`);
      console.log(`  - Auth header: Authorization: Bearer <JWT_TOKEN>`);
      console.log(`  - Auth object: { auth: { token: <JWT_TOKEN> } }`);
    }
  } catch (error: any) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Failed to start application:', error);
      console.error('Stack trace:', error.stack);
    }
    // Exit with error code so PM2 can restart
    process.exit(1);
  }
}

// Start the application with error handling
bootstrap().catch(error => {
  if (process.env.NODE_ENV !== 'production') {
    console.error('Bootstrap failed:', error);
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
});
