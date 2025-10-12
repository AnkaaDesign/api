import { Module } from '@nestjs/common';
import { ThrottlerModule as NestThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { CustomThrottlerGuard } from './custom-throttler.guard';
import { VerificationThrottlerGuard } from './verification-throttler.guard';
import { VerificationThrottlerService } from './verification-throttler.service';
import { RedisThrottlerStorage } from './redis-throttler-storage';

@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      useFactory: () => {
        const isDevelopment =
          process.env.NODE_ENV === 'development' || process.env.NODE_ENV === undefined;
        const isRateLimitDisabled = process.env.DISABLE_RATE_LIMITING === 'true';

        // If rate limiting is completely disabled, return minimal configuration
        if (isRateLimitDisabled) {
          return {
            throttlers: [
              {
                name: 'default',
                ttl: 60000,
                limit: 999999, // Effectively unlimited
              },
            ],
            skipIf: () => true, // Skip all rate limiting
            storage: new RedisThrottlerStorage(),
          };
        }

        return {
          throttlers: [
            {
              name: 'default',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 2000 : 300, // 2000 requests per minute in dev, 300 in production (increased from 60)
              blockDuration: isDevelopment ? 60000 : 300000, // 1 minute block in dev, 5 minutes in production
            },
            {
              name: 'short',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 50 : 5, // 50 requests per minute in dev, 5 in production
              blockDuration: 120000, // 2 minutes block in both dev and production
            },
            {
              name: 'medium',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 200 : 50, // 200 requests per minute in dev, 50 in production - increased for file uploads
              blockDuration: isDevelopment ? 60000 : 300000, // 1 minute block in dev, 5 minutes in production
            },
            {
              name: 'file_upload',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 1000 : 100, // 1000 uploads per minute in dev, 100 in production
              blockDuration: isDevelopment ? 120000 : 600000, // 2 minutes block in dev, 10 minutes in production
            },
            {
              name: 'long',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 1000 : 100, // 1000 requests per minute in dev, 100 in production - increased for file reads
              blockDuration: isDevelopment ? 60000 : 300000, // 1 minute block in dev, 5 minutes in production
            },
            // Verification-specific throttlers - development friendly
            {
              name: 'verification',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 100 : 3, // 100 attempts per minute in dev, 3 in production
              blockDuration: isDevelopment ? 60000 : 600000, // 1 minute block in dev, 10 minutes in production
            },
            {
              name: 'verification_send',
              ttl: 300000, // 5 minutes
              limit: isDevelopment ? 50 : 2, // 50 sends per 5 minutes in dev, 2 in production
              blockDuration: isDevelopment ? 300000 : 1800000, // 5 minutes block in dev, 30 minutes in production
            },
            {
              name: 'verification_strict',
              ttl: 30000, // 30 seconds
              limit: isDevelopment ? 20 : 1, // 20 attempts per 30 seconds in dev, 1 in production
              blockDuration: isDevelopment ? 30000 : 300000, // 30 seconds block in dev, 5 minutes in production
            },
            {
              name: 'verification_progressive',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 30 : 3, // 30 attempts in dev, 3 in production
              blockDuration: isDevelopment ? 60000 : 300000, // 1 minute block in dev, 5 minutes in production
            },
            {
              name: 'verification_ip',
              ttl: 3600000, // 1 hour
              limit: isDevelopment ? 200 : 10, // 200 attempts per hour in dev, 10 in production
              blockDuration: isDevelopment ? 300000 : 3600000, // 5 minutes block in dev, 1 hour in production
            },
            // Custom throttler for any custom rate limits
            {
              name: 'custom',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 2000 : 100, // Very permissive default for custom limits
              blockDuration: isDevelopment ? 60000 : 300000, // 1 minute block in dev, 5 minutes in production
            },
            // High-frequency throttlers for commonly accessed endpoints
            {
              name: 'high_frequency',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 2000 : 500, // 500 requests per minute in production - for endpoints called on every route change
              blockDuration: isDevelopment ? 60000 : 300000, // 1 minute block in dev, 5 minutes in production
            },
            {
              name: 'thumbnail_serve',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 2000 : 500, // 500 thumbnails per minute - allows 8+ per second for responsive UI
              blockDuration: isDevelopment ? 60000 : 300000, // 1 minute block in dev, 5 minutes in production
            },
            {
              name: 'file_serve',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 1000 : 200, // 200 file serves per minute
              blockDuration: isDevelopment ? 120000 : 600000, // 2 minutes block in dev, 10 minutes in production
            },
            {
              name: 'file_download',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 500 : 50, // 50 downloads per minute
              blockDuration: isDevelopment ? 120000 : 600000, // 2 minutes block in dev, 10 minutes in production
            },
            {
              name: 'dashboard',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 100 : 30, // 30 dashboard loads per minute - dashboards are expensive
              blockDuration: isDevelopment ? 60000 : 300000, // 1 minute block in dev, 5 minutes in production
            },
            {
              name: 'dashboard_unified',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 50 : 10, // 10 unified dashboard loads per minute - VERY expensive
              blockDuration: isDevelopment ? 120000 : 600000, // 2 minutes block in dev, 10 minutes in production
            },
            {
              name: 'statistics_heavy',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 100 : 15, // 15 heavy statistics per minute - complex queries
              blockDuration: isDevelopment ? 120000 : 600000, // 2 minutes block in dev, 10 minutes in production
            },
            {
              name: 'statistics_moderate',
              ttl: 60000, // 1 minute
              limit: isDevelopment ? 200 : 30, // 30 moderate statistics per minute
              blockDuration: isDevelopment ? 60000 : 300000, // 1 minute block in dev, 5 minutes in production
            },
          ],
          storage: new RedisThrottlerStorage(),
        };
      },
    }),
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    VerificationThrottlerService,
    VerificationThrottlerGuard,
  ],
  exports: [VerificationThrottlerService, VerificationThrottlerGuard],
})
export class ThrottlerModule {}
