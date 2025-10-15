import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
// import { StatisticsCacheService } from './statistics-cache.service';

// =====================
// Cache Invalidation Decorators
// =====================

export const CACHE_INVALIDATION_KEY = 'cache_invalidation';

export interface CacheInvalidationConfig {
  /**
   * Entity type that affects statistics
   */
  entityType: 'item' | 'activity' | 'order' | 'user' | 'sector' | 'price' | 'category' | 'brand';
  /**
   * Specific cache patterns to invalidate
   */
  patterns?: string[];
  /**
   * Whether to invalidate all statistics cache
   */
  invalidateAll?: boolean;
  /**
   * Delay before invalidation (in milliseconds)
   */
  delay?: number;
  /**
   * Custom invalidation function
   */
  customInvalidation?: (result: any, context: ExecutionContext) => Promise<void>;
}

/**
 * Decorator to mark methods that should invalidate statistics cache
 */
export const InvalidateStatisticsCache = (config: CacheInvalidationConfig) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflector.createDecorator<CacheInvalidationConfig>()(config)(target, propertyKey, descriptor);
  };
};

// =====================
// Automatic Cache Invalidation Interceptor
// =====================
// TODO: Re-enable when StatisticsCacheService is implemented
/*
@Injectable()
export class CacheInvalidationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheInvalidationInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly statisticsCacheService: StatisticsCacheService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      tap(async (result) => {
        await this.handleCacheInvalidation(context, result);
      }),
    );
  }

  private async handleCacheInvalidation(
    context: ExecutionContext,
    result: any,
  ): Promise<void> {
    const invalidationConfig = this.reflector.get<CacheInvalidationConfig>(
      CACHE_INVALIDATION_KEY,
      context.getHandler(),
    );

    if (!invalidationConfig) {
      return;
    }

    try {
      const { entityType, patterns, invalidateAll, delay, customInvalidation } = invalidationConfig;

      // Apply delay if specified
      if (delay && delay > 0) {
        setTimeout(async () => {
          await this.performInvalidation(entityType, patterns, invalidateAll, customInvalidation, result, context);
        }, delay);
      } else {
        await this.performInvalidation(entityType, patterns, invalidateAll, customInvalidation, result, context);
      }
    } catch (error) {
      this.logger.error(`Error during cache invalidation: ${error.message}`, error.stack);
    }
  }

  private async performInvalidation(
    entityType: CacheInvalidationConfig['entityType'],
    patterns?: string[],
    invalidateAll?: boolean,
    customInvalidation?: CacheInvalidationConfig['customInvalidation'],
    result?: any,
    context?: ExecutionContext,
  ): Promise<void> {
    // Custom invalidation takes precedence
    if (customInvalidation && context) {
      await customInvalidation(result, context);
      return;
    }

    // Invalidate all statistics cache
    if (invalidateAll) {
      await this.statisticsCacheService.invalidateStatisticsCache();
      this.logger.log('Invalidated all statistics cache');
      return;
    }

    // Invalidate specific patterns
    if (patterns && patterns.length > 0) {
      for (const pattern of patterns) {
        await this.statisticsCacheService.invalidateStatisticsCache(pattern);
        this.logger.log(`Invalidated cache pattern: ${pattern}`);
      }
      return;
    }

    // Invalidate by entity type
    if (entityType) {
      await this.statisticsCacheService.invalidateByEntityType(entityType);
      this.logger.log(`Invalidated cache for entity type: ${entityType}`);
    }
  }
}
*/

// =====================
// Method-level Decorators for Common Scenarios
// =====================

/**
 * Invalidate cache when items are created, updated, or deleted
 */
export const InvalidateItemCache = () =>
  InvalidateStatisticsCache({
    entityType: 'item',
  });

/**
 * Invalidate cache when activities are created, updated, or deleted
 */
export const InvalidateActivityCache = () =>
  InvalidateStatisticsCache({
    entityType: 'activity',
  });

/**
 * Invalidate cache when orders are created, updated, or deleted
 */
export const InvalidateOrderCache = () =>
  InvalidateStatisticsCache({
    entityType: 'order',
  });

/**
 * Invalidate cache when users are created, updated, or deleted
 */
export const InvalidateUserCache = () =>
  InvalidateStatisticsCache({
    entityType: 'user',
  });

/**
 * Invalidate cache when sectors are created, updated, or deleted
 */
export const InvalidateSectorCache = () =>
  InvalidateStatisticsCache({
    entityType: 'sector',
  });

/**
 * Invalidate cache when prices are updated
 */
export const InvalidatePriceCache = () =>
  InvalidateStatisticsCache({
    entityType: 'price',
  });

/**
 * Invalidate all statistics cache (use sparingly)
 */
export const InvalidateAllStatisticsCache = () =>
  InvalidateStatisticsCache({
    entityType: 'item', // Required but ignored when invalidateAll is true
    invalidateAll: true,
  });

/**
 * Delayed cache invalidation (useful for batch operations)
 */
export const InvalidateCacheDelayed = (entityType: CacheInvalidationConfig['entityType'], delay: number = 5000) =>
  InvalidateStatisticsCache({
    entityType,
    delay,
  });

// =====================
// Cache Warming Decorator
// =====================

export const CACHE_WARMING_KEY = 'cache_warming';

export interface CacheWarmingConfig {
  /**
   * Entity type to warm cache for
   */
  entityType: 'item' | 'activity' | 'order' | 'user' | 'sector';
  /**
   * Common filter sets to pre-compute
   */
  commonFilters?: any[];
  /**
   * Delay before warming (in milliseconds)
   */
  delay?: number;
}

/**
 * Decorator to mark methods that should trigger cache warming
 */
export const WarmStatisticsCache = (config: CacheWarmingConfig) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflector.createDecorator<CacheWarmingConfig>()(config)(target, propertyKey, descriptor);
  };
};

// =====================
// Cache Warming Interceptor
// =====================
// TODO: Re-enable when StatisticsCacheService is implemented
/*
@Injectable()
export class CacheWarmingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheWarmingInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly statisticsCacheService: StatisticsCacheService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      tap(async (result) => {
        await this.handleCacheWarming(context, result);
      }),
    );
  }

  private async handleCacheWarming(
    context: ExecutionContext,
    result: any,
  ): Promise<void> {
    const warmingConfig = this.reflector.get<CacheWarmingConfig>(
      CACHE_WARMING_KEY,
      context.getHandler(),
    );

    if (!warmingConfig) {
      return;
    }

    try {
      const { commonFilters, delay } = warmingConfig;

      if (commonFilters && commonFilters.length > 0) {
        if (delay && delay > 0) {
          setTimeout(async () => {
            await this.statisticsCacheService.warmupCache(commonFilters);
          }, delay);
        } else {
          // Run warmup in background without blocking the response
          setImmediate(async () => {
            await this.statisticsCacheService.warmupCache(commonFilters);
          });
        }
      }
    } catch (error) {
      this.logger.error(`Error during cache warming: ${error.message}`, error.stack);
    }
  }
}
*/

// =====================
// Usage Examples and Helper Functions
// =====================

/**
 * Helper function to create common filter sets for cache warming
 */
export function createCommonStatisticsFilters(): any[] {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const oneQuarterAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  return [
    // Current week
    {
      dateRange: { from: oneWeekAgo, to: now },
      period: 'week',
    },
    // Current month
    {
      dateRange: { from: oneMonthAgo, to: now },
      period: 'month',
    },
    // Current quarter
    {
      dateRange: { from: oneQuarterAgo, to: now },
      period: 'quarter',
    },
    // Today
    {
      dateRange: { from: new Date(now.setHours(0, 0, 0, 0)), to: now },
      period: 'day',
    },
  ];
}

/**
 * Determine cache invalidation strategy based on operation type
 */
export function getInvalidationConfigForOperation(
  operation: 'create' | 'update' | 'delete' | 'batch',
  entityType: CacheInvalidationConfig['entityType'],
): CacheInvalidationConfig {
  const baseConfig: CacheInvalidationConfig = { entityType };

  switch (operation) {
    case 'batch':
      // Batch operations might affect many records, delay invalidation
      return {
        ...baseConfig,
        delay: 2000, // 2 seconds delay
      };
    case 'delete':
      // Deletions might affect aggregations significantly
      return {
        ...baseConfig,
        delay: 1000, // 1 second delay
      };
    case 'create':
    case 'update':
    default:
      return baseConfig;
  }
}