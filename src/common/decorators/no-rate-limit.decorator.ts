import { SetMetadata } from '@nestjs/common';

/**
 * Decorator to skip rate limiting for specific endpoints
 */
export const NoRateLimit = () => SetMetadata('skipThrottle', true);

/**
 * Alias for NoRateLimit to match NestJS Throttler convention
 */
export const SkipThrottle = NoRateLimit;
