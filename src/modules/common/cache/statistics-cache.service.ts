import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from './cache.service';
import { createHash } from 'crypto';

// =====================
// Statistics Cache Configuration
// =====================

interface StatisticsCacheConfig {
  defaultTtl: number; // Default TTL in seconds
  maxMemory: string; // Maximum memory usage
  evictionPolicy: 'allkeys-lru' | 'volatile-lru' | 'allkeys-lfu' | 'volatile-lfu';
}

const STATISTICS_CACHE_CONFIG: StatisticsCacheConfig = {
  defaultTtl: 15 * 60, // 15 minutes
  maxMemory: '256mb',
  evictionPolicy: 'allkeys-lru',
};

// =====================
// Cache Key Strategies
// =====================

class StatisticsCacheKeyBuilder {
  private static readonly PREFIX = 'stats';
  private static readonly SEPARATOR = ':';

  static buildOverviewKey(filters: any): string {
    const hash = this.hashFilters(filters);
    return `${this.PREFIX}${this.SEPARATOR}overview${this.SEPARATOR}${hash}`;
  }

  static buildTrendsKey(filters: any): string {
    const hash = this.hashFilters(filters);
    return `${this.PREFIX}${this.SEPARATOR}trends${this.SEPARATOR}${hash}`;
  }

  static buildActivitiesKey(filters: any): string {
    const hash = this.hashFilters(filters);
    return `${this.PREFIX}${this.SEPARATOR}activities${this.SEPARATOR}${hash}`;
  }

  static buildStockMetricsKey(filters: any): string {
    const hash = this.hashFilters(filters);
    return `${this.PREFIX}${this.SEPARATOR}stock-metrics${this.SEPARATOR}${hash}`;
  }

  static buildForecastingKey(filters: any): string {
    const hash = this.hashFilters(filters);
    return `${this.PREFIX}${this.SEPARATOR}forecasting${this.SEPARATOR}${hash}`;
  }

  static buildPerformanceKey(filters: any): string {
    const hash = this.hashFilters(filters);
    return `${this.PREFIX}${this.SEPARATOR}performance${this.SEPARATOR}${hash}`;
  }

  static buildConsumptionKey(filters: any): string {
    const hash = this.hashFilters(filters);
    return `${this.PREFIX}${this.SEPARATOR}consumption${this.SEPARATOR}${hash}`;
  }

  static buildAggregationKey(type: string, filters: any): string {
    const hash = this.hashFilters(filters);
    return `${this.PREFIX}${this.SEPARATOR}agg${this.SEPARATOR}${type}${this.SEPARATOR}${hash}`;
  }

  static buildInvalidationKey(entityType: string, entityId?: string): string {
    const key = `${this.PREFIX}${this.SEPARATOR}invalidation${this.SEPARATOR}${entityType}`;
    return entityId ? `${key}${this.SEPARATOR}${entityId}` : key;
  }

  private static hashFilters(filters: any): string {
    // Create a consistent hash from the filters object
    const sortedFilters = this.sortObjectKeys(filters);
    const filterString = JSON.stringify(sortedFilters);
    return createHash('md5').update(filterString).digest('hex').substring(0, 12);
  }

  private static sortObjectKeys(obj: any): any {
    if (obj === null || typeof obj !== 'object' || obj instanceof Date) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sortObjectKeys(item));
    }

    const sortedObj: any = {};
    Object.keys(obj)
      .sort()
      .forEach(key => {
        sortedObj[key] = this.sortObjectKeys(obj[key]);
      });

    return sortedObj;
  }
}

// =====================
// Statistics Cache Service
// =====================

@Injectable()
export class StatisticsCacheService {
  private readonly logger = new Logger(StatisticsCacheService.name);

  constructor(private readonly cacheService: CacheService) {}

  // =====================
  // Overview Statistics
  // =====================

  async getOverviewStatistics(filters: any): Promise<any | null> {
    const key = StatisticsCacheKeyBuilder.buildOverviewKey(filters);
    try {
      const cached = await this.cacheService.getObject(key);
      if (cached) {
        this.logger.debug(`Cache hit for overview statistics: ${key}`);
      }
      return cached;
    } catch (error) {
      this.logger.error(`Error getting overview statistics from cache: ${error.message}`);
      return null;
    }
  }

  async setOverviewStatistics(filters: any, data: any, ttl?: number): Promise<void> {
    const key = StatisticsCacheKeyBuilder.buildOverviewKey(filters);
    try {
      await this.cacheService.setObject(key, {
        data,
        cached: true,
        cacheExpiry: new Date(Date.now() + (ttl || STATISTICS_CACHE_CONFIG.defaultTtl) * 1000).toISOString(),
        timestamp: new Date().toISOString(),
      }, ttl || STATISTICS_CACHE_CONFIG.defaultTtl);

      this.logger.debug(`Cached overview statistics: ${key}`);
    } catch (error) {
      this.logger.error(`Error setting overview statistics cache: ${error.message}`);
    }
  }

  // =====================
  // Trends Analysis
  // =====================

  async getTrendsAnalysis(filters: any): Promise<any | null> {
    const key = StatisticsCacheKeyBuilder.buildTrendsKey(filters);
    try {
      const cached = await this.cacheService.getObject(key);
      if (cached) {
        this.logger.debug(`Cache hit for trends analysis: ${key}`);
      }
      return cached;
    } catch (error) {
      this.logger.error(`Error getting trends analysis from cache: ${error.message}`);
      return null;
    }
  }

  async setTrendsAnalysis(filters: any, data: any, ttl?: number): Promise<void> {
    const key = StatisticsCacheKeyBuilder.buildTrendsKey(filters);
    try {
      await this.cacheService.setObject(key, {
        data,
        cached: true,
        cacheExpiry: new Date(Date.now() + (ttl || STATISTICS_CACHE_CONFIG.defaultTtl) * 1000).toISOString(),
        timestamp: new Date().toISOString(),
      }, ttl || STATISTICS_CACHE_CONFIG.defaultTtl);

      this.logger.debug(`Cached trends analysis: ${key}`);
    } catch (error) {
      this.logger.error(`Error setting trends analysis cache: ${error.message}`);
    }
  }

  // =====================
  // Activity Analytics
  // =====================

  async getActivityAnalytics(filters: any): Promise<any | null> {
    const key = StatisticsCacheKeyBuilder.buildActivitiesKey(filters);
    try {
      const cached = await this.cacheService.getObject(key);
      if (cached) {
        this.logger.debug(`Cache hit for activity analytics: ${key}`);
      }
      return cached;
    } catch (error) {
      this.logger.error(`Error getting activity analytics from cache: ${error.message}`);
      return null;
    }
  }

  async setActivityAnalytics(filters: any, data: any, ttl?: number): Promise<void> {
    const key = StatisticsCacheKeyBuilder.buildActivitiesKey(filters);
    try {
      // Activity data changes more frequently, use shorter TTL
      const activityTtl = ttl || Math.floor(STATISTICS_CACHE_CONFIG.defaultTtl / 3); // 5 minutes

      await this.cacheService.setObject(key, {
        data,
        cached: true,
        cacheExpiry: new Date(Date.now() + activityTtl * 1000).toISOString(),
        timestamp: new Date().toISOString(),
      }, activityTtl);

      this.logger.debug(`Cached activity analytics: ${key}`);
    } catch (error) {
      this.logger.error(`Error setting activity analytics cache: ${error.message}`);
    }
  }

  // =====================
  // Stock Metrics
  // =====================

  async getStockMetrics(filters: any): Promise<any | null> {
    const key = StatisticsCacheKeyBuilder.buildStockMetricsKey(filters);
    try {
      const cached = await this.cacheService.getObject(key);
      if (cached) {
        this.logger.debug(`Cache hit for stock metrics: ${key}`);
      }
      return cached;
    } catch (error) {
      this.logger.error(`Error getting stock metrics from cache: ${error.message}`);
      return null;
    }
  }

  async setStockMetrics(filters: any, data: any, ttl?: number): Promise<void> {
    const key = StatisticsCacheKeyBuilder.buildStockMetricsKey(filters);
    try {
      // Stock metrics can be cached longer
      const stockTtl = ttl || STATISTICS_CACHE_CONFIG.defaultTtl * 2; // 30 minutes

      await this.cacheService.setObject(key, {
        data,
        cached: true,
        cacheExpiry: new Date(Date.now() + stockTtl * 1000).toISOString(),
        timestamp: new Date().toISOString(),
      }, stockTtl);

      this.logger.debug(`Cached stock metrics: ${key}`);
    } catch (error) {
      this.logger.error(`Error setting stock metrics cache: ${error.message}`);
    }
  }

  // =====================
  // Performance Metrics
  // =====================

  async getPerformanceMetrics(filters: any): Promise<any | null> {
    const key = StatisticsCacheKeyBuilder.buildPerformanceKey(filters);
    try {
      const cached = await this.cacheService.getObject(key);
      if (cached) {
        this.logger.debug(`Cache hit for performance metrics: ${key}`);
      }
      return cached;
    } catch (error) {
      this.logger.error(`Error getting performance metrics from cache: ${error.message}`);
      return null;
    }
  }

  async setPerformanceMetrics(filters: any, data: any, ttl?: number): Promise<void> {
    const key = StatisticsCacheKeyBuilder.buildPerformanceKey(filters);
    try {
      // Performance metrics change less frequently
      const performanceTtl = ttl || STATISTICS_CACHE_CONFIG.defaultTtl * 4; // 1 hour

      await this.cacheService.setObject(key, {
        data,
        cached: true,
        cacheExpiry: new Date(Date.now() + performanceTtl * 1000).toISOString(),
        timestamp: new Date().toISOString(),
      }, performanceTtl);

      this.logger.debug(`Cached performance metrics: ${key}`);
    } catch (error) {
      this.logger.error(`Error setting performance metrics cache: ${error.message}`);
    }
  }

  // =====================
  // Forecasting Metrics
  // =====================

  async getForecastingMetrics(filters: any): Promise<any | null> {
    const key = StatisticsCacheKeyBuilder.buildForecastingKey(filters);
    try {
      const cached = await this.cacheService.getObject(key);
      if (cached) {
        this.logger.debug(`Cache hit for forecasting metrics: ${key}`);
      }
      return cached;
    } catch (error) {
      this.logger.error(`Error getting forecasting metrics from cache: ${error.message}`);
      return null;
    }
  }

  async setForecastingMetrics(filters: any, data: any, ttl?: number): Promise<void> {
    const key = StatisticsCacheKeyBuilder.buildForecastingKey(filters);
    try {
      // Forecasting can be cached for longer periods
      const forecastingTtl = ttl || STATISTICS_CACHE_CONFIG.defaultTtl * 8; // 2 hours

      await this.cacheService.setObject(key, {
        data,
        cached: true,
        cacheExpiry: new Date(Date.now() + forecastingTtl * 1000).toISOString(),
        timestamp: new Date().toISOString(),
      }, forecastingTtl);

      this.logger.debug(`Cached forecasting metrics: ${key}`);
    } catch (error) {
      this.logger.error(`Error setting forecasting metrics cache: ${error.message}`);
    }
  }

  // =====================
  // Comprehensive Consumption Statistics
  // =====================

  async getConsumptionStatistics(filters: any): Promise<any | null> {
    const key = StatisticsCacheKeyBuilder.buildConsumptionKey(filters);
    try {
      const cached = await this.cacheService.getObject(key);
      if (cached) {
        this.logger.debug(`Cache hit for consumption statistics: ${key}`);
      }
      return cached;
    } catch (error) {
      this.logger.error(`Error getting consumption statistics from cache: ${error.message}`);
      return null;
    }
  }

  async setConsumptionStatistics(filters: any, data: any, ttl?: number): Promise<void> {
    const key = StatisticsCacheKeyBuilder.buildConsumptionKey(filters);
    try {
      await this.cacheService.setObject(key, {
        data,
        cached: true,
        cacheExpiry: new Date(Date.now() + (ttl || STATISTICS_CACHE_CONFIG.defaultTtl) * 1000).toISOString(),
        timestamp: new Date().toISOString(),
      }, ttl || STATISTICS_CACHE_CONFIG.defaultTtl);

      this.logger.debug(`Cached consumption statistics: ${key}`);
    } catch (error) {
      this.logger.error(`Error setting consumption statistics cache: ${error.message}`);
    }
  }

  // =====================
  // Cache Invalidation
  // =====================

  async invalidateStatisticsCache(pattern?: string): Promise<void> {
    try {
      const invalidationPattern = pattern || `${StatisticsCacheKeyBuilder['PREFIX']}:*`;
      await this.cacheService.clearPattern(invalidationPattern);
      this.logger.log(`Invalidated statistics cache with pattern: ${invalidationPattern}`);
    } catch (error) {
      this.logger.error(`Error invalidating statistics cache: ${error.message}`);
    }
  }

  async invalidateByEntityType(entityType: 'item' | 'activity' | 'order' | 'user' | 'sector' | 'price' | 'category' | 'brand'): Promise<void> {
    try {
      // Different entity types affect different statistics
      const patternsToInvalidate: string[] = [];

      switch (entityType) {
        case 'item':
          patternsToInvalidate.push(
            `${StatisticsCacheKeyBuilder['PREFIX']}:overview:*`,
            `${StatisticsCacheKeyBuilder['PREFIX']}:stock-metrics:*`,
            `${StatisticsCacheKeyBuilder['PREFIX']}:forecasting:*`
          );
          break;
        case 'activity':
          patternsToInvalidate.push(
            `${StatisticsCacheKeyBuilder['PREFIX']}:overview:*`,
            `${StatisticsCacheKeyBuilder['PREFIX']}:activities:*`,
            `${StatisticsCacheKeyBuilder['PREFIX']}:trends:*`,
            `${StatisticsCacheKeyBuilder['PREFIX']}:consumption:*`
          );
          break;
        case 'order':
          patternsToInvalidate.push(
            `${StatisticsCacheKeyBuilder['PREFIX']}:overview:*`,
            `${StatisticsCacheKeyBuilder['PREFIX']}:performance:*`
          );
          break;
        case 'price':
          // Price changes affect item overview and stock metrics
          patternsToInvalidate.push(
            `${StatisticsCacheKeyBuilder['PREFIX']}:overview:*`,
            `${StatisticsCacheKeyBuilder['PREFIX']}:stock-metrics:*`
          );
          break;
        case 'category':
        case 'brand':
          // Category and brand changes affect item organization and metrics
          patternsToInvalidate.push(
            `${StatisticsCacheKeyBuilder['PREFIX']}:overview:*`,
            `${StatisticsCacheKeyBuilder['PREFIX']}:stock-metrics:*`,
            `${StatisticsCacheKeyBuilder['PREFIX']}:forecasting:*`
          );
          break;
        case 'user':
        case 'sector':
          patternsToInvalidate.push(
            `${StatisticsCacheKeyBuilder['PREFIX']}:activities:*`,
            `${StatisticsCacheKeyBuilder['PREFIX']}:performance:*`
          );
          break;
        default:
          // Invalidate all if unknown entity type
          patternsToInvalidate.push(`${StatisticsCacheKeyBuilder['PREFIX']}:*`);
      }

      for (const pattern of patternsToInvalidate) {
        await this.cacheService.clearPattern(pattern);
      }

      this.logger.log(`Invalidated statistics cache for entity type: ${entityType}`);
    } catch (error) {
      this.logger.error(`Error invalidating cache for entity type ${entityType}: ${error.message}`);
    }
  }

  // =====================
  // Pre-computed Aggregations
  // =====================

  async getAggregation(type: string, filters: any): Promise<any | null> {
    const key = StatisticsCacheKeyBuilder.buildAggregationKey(type, filters);
    try {
      const cached = await this.cacheService.getObject(key);
      if (cached) {
        this.logger.debug(`Cache hit for aggregation ${type}: ${key}`);
      }
      return cached;
    } catch (error) {
      this.logger.error(`Error getting aggregation from cache: ${error.message}`);
      return null;
    }
  }

  async setAggregation(type: string, filters: any, data: any, ttl?: number): Promise<void> {
    const key = StatisticsCacheKeyBuilder.buildAggregationKey(type, filters);
    try {
      await this.cacheService.setObject(key, {
        data,
        cached: true,
        cacheExpiry: new Date(Date.now() + (ttl || STATISTICS_CACHE_CONFIG.defaultTtl) * 1000).toISOString(),
        timestamp: new Date().toISOString(),
        aggregationType: type,
      }, ttl || STATISTICS_CACHE_CONFIG.defaultTtl);

      this.logger.debug(`Cached aggregation ${type}: ${key}`);
    } catch (error) {
      this.logger.error(`Error setting aggregation cache: ${error.message}`);
    }
  }

  // =====================
  // Cache Health and Monitoring
  // =====================

  async getCacheStats(): Promise<{
    totalKeys: number;
    statisticsKeys: number;
    memoryUsage: string;
    hitRate: number;
  }> {
    try {
      const allKeys = await this.cacheService.keys('*');
      const statsKeys = await this.cacheService.keys(`${StatisticsCacheKeyBuilder['PREFIX']}:*`);

      // These would need to be tracked separately in a real implementation
      const hitRate = 0.85; // Placeholder
      const memoryUsage = '128MB'; // Placeholder

      return {
        totalKeys: allKeys.length,
        statisticsKeys: statsKeys.length,
        memoryUsage,
        hitRate,
      };
    } catch (error) {
      this.logger.error(`Error getting cache stats: ${error.message}`);
      return {
        totalKeys: 0,
        statisticsKeys: 0,
        memoryUsage: 'Unknown',
        hitRate: 0,
      };
    }
  }

  async warmupCache(commonFilters: any[]): Promise<void> {
    this.logger.log('Starting cache warmup for common statistics queries...');

    // This would trigger pre-computation of common statistics
    // Implementation depends on specific business requirements

    for (const filters of commonFilters) {
      try {
        // Check if already cached
        const cached = await this.getOverviewStatistics(filters);
        if (!cached) {
          this.logger.debug(`Warming up cache for filters: ${JSON.stringify(filters)}`);
          // Trigger computation by calling the actual service
          // This would need to be implemented based on your service architecture
        }
      } catch (error) {
        this.logger.error(`Error during cache warmup: ${error.message}`);
      }
    }

    this.logger.log('Cache warmup completed');
  }
}