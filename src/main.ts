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
import { join } from 'path';
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
        origin: typeof allowedOrigins === 'function'
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

    // Configure query string parser to handle bracket notation from axios
    app.set('query parser', (str: string) => {
      return qs.parse(str, {
        depth: 10,
        arrayLimit: 100,
        parameterLimit: 1000,
        parseArrays: true,
        allowDots: true, // Changed to true to support array[0].field notation
        strictNullHandling: true,
        decoder: (value, defaultDecoder, charset, type) => {
          // Handle boolean strings
          if (value === 'true') return true;
          if (value === 'false') return false;
          // Handle numeric strings for pagination
          if (type === 'value' && /^\d+$/.test(value)) {
            return parseInt(value, 10);
          }
          return defaultDecoder(value, defaultDecoder, charset);
        },
      });
    });

    // Capture raw body for webhook signature verification
    // This must be done BEFORE any JSON parsing
    app.use((req: any, res, next) => {
      if (req.url === '/deployments/webhook' && req.method === 'POST') {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          data += chunk;
        });
        req.on('end', () => {
          req.rawBody = Buffer.from(data, 'utf8');
          req.body = JSON.parse(data);
          next();
        });
      } else {
        next();
      }
    });

    // Manually configure body parser with 50MB limit for messages with base64 images
    // This runs AFTER webhook handler so webhook can manually parse its body
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }))

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

    // Serve favicon and other static assets from public directory
    const publicPath = join(__dirname, '..', '..', 'public');
    app.useStaticAssets(publicPath, {
      setHeaders: res => {
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
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
      const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
      const host = process.env.API_URL || `http://localhost:${port}`;

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
