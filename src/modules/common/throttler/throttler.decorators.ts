import { SetMetadata } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';

// Basic rate limiting decorators - adjusted for development
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === undefined;
const isRateLimitDisabled = process.env.DISABLE_RATE_LIMITING === 'true';

export const AuthRateLimit = () =>
  Throttle({
    short: {
      limit: isDevelopment ? 50 : 5, // 50 per minute in dev, 5 in production
      ttl: 60000,
    },
  });

export const WriteRateLimit = () =>
  Throttle({
    medium: {
      limit: isDevelopment ? 200 : 30, // 200 per minute in dev, 30 in production - increased for file uploads
      ttl: 60000,
    },
  });

export const ReadRateLimit = () =>
  Throttle({
    long: {
      limit: isDevelopment ? 1000 : 100, // 1000 per minute in dev, 100 in production - increased for file reads
      ttl: 60000,
    },
  });

export const FileUploadRateLimit = () =>
  Throttle({
    file_upload: {
      limit: isDevelopment ? 1000 : 100, // 1000 uploads per minute in dev, 100 in production - very permissive for single uploads
      ttl: 60000,
    },
  });
export const NoRateLimit = () => SkipThrottle();
export const FileOperationBypass = () => SkipThrottle({ default: true }); // Bypasses ALL throttlers for file operations
export const DevelopmentBypass = () =>
  isRateLimitDisabled ? SkipThrottle() : Throttle({ default: { limit: 1, ttl: 1 } });
export const CustomRateLimit = (limit: number, ttl: number = 60000) =>
  Throttle({ custom: { limit, ttl } });

// Enhanced verification rate limiting decorators - development friendly
const isDevelopmentMode =
  process.env.NODE_ENV === 'development' || process.env.NODE_ENV === undefined;

export const VerificationRateLimit = () =>
  Throttle({
    verification: {
      limit: isDevelopmentMode ? 100 : 3, // 100 attempts per minute in dev, 3 in production
      ttl: 60000,
    },
  });

export const VerificationSendRateLimit = () =>
  Throttle({
    verification_send: {
      limit: isDevelopmentMode ? 50 : 2, // 50 sends per 5 minutes in dev, 2 in production
      ttl: 300000,
    },
  });

export const StrictVerificationRateLimit = () =>
  Throttle({
    verification_strict: {
      limit: isDevelopmentMode ? 20 : 1, // 20 attempts per 30 seconds in dev, 1 in production
      ttl: 30000,
    },
  });

// Progressive verification rate limiting (gets stricter with each failure)
export const ProgressiveVerificationRateLimit = () =>
  Throttle({
    verification_progressive: {
      limit: isDevelopmentMode ? 30 : 3,
      ttl: 60000,
      blockDuration: isDevelopmentMode ? 60000 : 300000, // 1 minute block in dev, 5 minutes in production
    },
  });

// IP-based verification rate limiting (stricter for unregistered IPs)
export const IpVerificationRateLimit = () =>
  Throttle({
    verification_ip: {
      limit: isDevelopmentMode ? 200 : 10, // 200 attempts per hour in dev, 10 in production
      ttl: 3600000,
    },
  });

// High-frequency endpoint rate limiters - for commonly accessed endpoints
export const HighFrequencyRateLimit = () =>
  Throttle({
    high_frequency: {
      limit: isDevelopment ? 2000 : 500, // 500 per minute in production - for /auth/me and similar
      ttl: 60000,
    },
  });

export const ThumbnailServeRateLimit = () =>
  Throttle({
    thumbnail_serve: {
      limit: isDevelopment ? 2000 : 500, // 500 thumbnails per minute - allows 8+ per second
      ttl: 60000,
    },
  });

export const FileServeRateLimit = () =>
  Throttle({
    file_serve: {
      limit: isDevelopment ? 1000 : 200, // 200 file serves per minute
      ttl: 60000,
    },
  });

export const FileDownloadRateLimit = () =>
  Throttle({
    file_download: {
      limit: isDevelopment ? 500 : 50, // 50 downloads per minute
      ttl: 60000,
    },
  });

export const DashboardRateLimit = () =>
  Throttle({
    dashboard: {
      limit: isDevelopment ? 100 : 30, // 30 dashboard loads per minute
      ttl: 60000,
    },
  });

export const UnifiedDashboardRateLimit = () =>
  Throttle({
    dashboard_unified: {
      limit: isDevelopment ? 50 : 10, // 10 unified dashboard loads per minute - VERY expensive
      ttl: 60000,
    },
  });

export const HeavyStatisticsRateLimit = () =>
  Throttle({
    statistics_heavy: {
      limit: isDevelopment ? 100 : 15, // 15 heavy statistics per minute
      ttl: 60000,
    },
  });

export const ModerateStatisticsRateLimit = () =>
  Throttle({
    statistics_moderate: {
      limit: isDevelopment ? 200 : 30, // 30 moderate statistics per minute
      ttl: 60000,
    },
  });
