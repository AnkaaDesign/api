import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private redis: Redis;
  private scanCount = 1000;

  constructor(redis?: Redis) {
    this.redis =
      redis ||
      new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
        keyPrefix: 'throttler:',
      });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // Completely bypass Redis operations for file operations in development or when rate limiting is disabled
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_RATE_LIMITING === 'true') {
      if (this.isFileOperationKey(key)) {
        console.log(`[RedisThrottlerStorage] BYPASSING Redis for file operation key: ${key}`);
        return {
          totalHits: 1,
          timeToExpire: ttl,
          isBlocked: false,
          timeToBlockExpire: 0,
        };
      }
    }

    // Global rate limiting disable
    if (process.env.DISABLE_RATE_LIMITING === 'true') {
      console.log(
        `[RedisThrottlerStorage] RATE LIMITING DISABLED - bypassing Redis for key: ${key}`,
      );
      return {
        totalHits: 1,
        timeToExpire: ttl,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

    try {
      const throttlerKey = `${throttlerName}:${key}`;
      const result = await this.redis.multi().incr(throttlerKey).expire(throttlerKey, ttl).exec();

      if (!result) {
        throw new Error('Redis operation failed');
      }

      const [[incrError, totalHits], [expireError]] = result;

      if (incrError || expireError) {
        throw new Error('Redis operation failed');
      }

      const timeToExpire = await this.redis.ttl(throttlerKey);

      const isBlocked = (totalHits as number) > limit;

      return {
        totalHits: totalHits as number,
        timeToExpire: timeToExpire > 0 ? timeToExpire : ttl,
        isBlocked,
        timeToBlockExpire: isBlocked ? blockDuration : 0,
      };
    } catch (error) {
      // If Redis fails, allow the request (fail-open approach)
      console.error(`[RedisThrottlerStorage] Redis error, allowing request: ${error.message}`);
      return {
        totalHits: 1,
        timeToExpire: ttl,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  async get(keys: string[]): Promise<(ThrottlerStorageRecord | undefined)[]> {
    const results = await Promise.all(
      keys.map(async key => {
        const [value, ttl] = await this.redis
          .multi()
          .get(key)
          .ttl(key)
          .exec()
          .then(res => res?.map(([, val]) => val) || [null, -1]);

        if (!value || ttl === -1) {
          return undefined;
        }

        const hits = parseInt(value as string, 10);

        return {
          totalHits: hits,
          timeToExpire: ttl as number,
          isBlocked: false,
          timeToBlockExpire: 0,
        };
      }),
    );

    return results;
  }

  async addRecord(key: string, ttl: number): Promise<void> {
    await this.redis.set(key, 1, 'EX', ttl);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }

  private isFileOperationKey(key: string): boolean {
    const fileOperationPatterns = [
      'FileController-uploadFile',
      'FileController-uploadMultipleFiles',
      'FileController-serveFile',
      'FileController-serveThumbnail',
      'FileController-findMany',
      'FileController-findById',
      'FileController-create',
      'FileController-update',
      'FileController-delete',
      'FileController-batchCreate',
      'FileController-batchUpdate',
      'FileController-batchDelete',
      'FileController-regenerateThumbnail',
    ];

    return fileOperationPatterns.some(pattern => key.includes(pattern));
  }
}
