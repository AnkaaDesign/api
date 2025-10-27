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

// Global error handlers to prevent crashes
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  console.error('Stack trace:', reason?.stack);
  // Log the error but don't exit the process immediately
  // Let PM2 handle the restart if needed
});

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception thrown:', error);
  console.error('Stack trace:', error.stack);
  // Give the process time to log before exiting
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

async function bootstrap() {
  try {
    // Validate secrets before starting the application
    secretsManager.validateSecrets();

    const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Configure query string parser to handle bracket notation from axios
  app.set('query parser', (str: string) => {
    return qs.parse(str, {
      depth: 10,
      arrayLimit: 100,
      parameterLimit: 1000,
      parseArrays: true,
      allowDots: true,  // Changed to true to support array[0].field notation
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

  // Regular JSON parser for all other routes (skip for multipart/form-data)
  app.use((req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    // Skip JSON parsing for multipart/form-data (handled by multer)
    if (contentType.includes('multipart/form-data')) {
      return next();
    }
    return express.json()(req, res, next);
  });

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

  app.useGlobalPipes(validationPipe);
  app.useGlobalInterceptors(new UserContextInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Upload error handling middleware
  app.use(handleMulterError);
  app.use(uploadCleanupMiddleware);

  // No global prefix - API runs on subdomain (api.ankaa.live, test.api.ankaa.live)
  // app.setGlobalPrefix('api'); // REMOVED: Using subdomain architecture

    const port = env.API_PORT ?? env.PORT ?? 3030;
    // Try without specifying host to let Node.js handle it
    await app.listen(port);

    // Signal PM2 that app is ready
    if (process.send) {
      process.send('ready');
    }

    console.log(`Application is running on port ${port}`);
  } catch (error: any) {
    console.error('Failed to start application:', error);
    console.error('Stack trace:', error.stack);
    // Exit with error code so PM2 can restart
    process.exit(1);
  }
}

// Start the application with error handling
bootstrap().catch((error) => {
  console.error('Bootstrap failed:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
});
