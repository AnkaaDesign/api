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
      const blockedKey = `${throttlerKey}:blocked`;

      // Check if the key is blocked first
      const blockedTTL = await this.redis.ttl(blockedKey);
      if (blockedTTL > 0) {
        console.log(`[RedisThrottlerStorage] Key ${key} is blocked for ${blockedTTL} more seconds`);
        return {
          totalHits: limit + 1, // Ensure it's over the limit
          timeToExpire: blockedTTL,
          isBlocked: true,
          timeToBlockExpire: blockedTTL,
        };
      }

      // Increment the counter
      const ttlInSeconds = Math.floor(ttl / 1000);
      const result = await this.redis.multi().incr(throttlerKey).expire(throttlerKey, ttlInSeconds).exec();

      if (!result) {
        throw new Error('Redis operation failed');
      }

      const [[incrError, totalHits], [expireError]] = result;

      if (incrError || expireError) {
        throw new Error('Redis operation failed');
      }

      const currentHits = totalHits as number;
      const timeToExpire = await this.redis.ttl(throttlerKey);

      // Check if we've exceeded the limit
      if (currentHits > limit) {
        // Block the key for the specified duration
        if (blockDuration > 0) {
          const blockDurationInSeconds = Math.floor(blockDuration / 1000);
          await this.redis.set(blockedKey, '1', 'EX', blockDurationInSeconds);
          console.log(`[RedisThrottlerStorage] Blocking key ${key} for ${blockDurationInSeconds} seconds (${blockDuration}ms)`);
        }

        return {
          totalHits: currentHits,
          timeToExpire: blockDuration > 0 ? blockDuration : timeToExpire,
          isBlocked: true,
          timeToBlockExpire: blockDuration > 0 ? blockDuration : timeToExpire,
        };
      }

      return {
        totalHits: currentHits,
        timeToExpire: timeToExpire > 0 ? timeToExpire : ttl,
        isBlocked: false,
        timeToBlockExpire: 0,
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
    const ttlInSeconds = Math.floor(ttl / 1000);
    await this.redis.set(key, 1, 'EX', ttlInSeconds);
  }

  async clearThrottlerKeys(pattern?: string): Promise<number> {
    try {
      const searchPattern = pattern ? `throttler:*${pattern}*` : 'throttler:*';
      const keys = await this.scanKeys(searchPattern);

      if (keys.length === 0) {
        return 0;
      }

      // Remove the keyPrefix from keys before deleting
      const keysToDelete = keys.map(k => k.replace('throttler:', ''));

      if (keysToDelete.length > 0) {
        await this.redis.del(...keysToDelete);
      }

      return keys.length;
    } catch (error) {
      console.error(`[RedisThrottlerStorage] Error clearing keys: ${error.message}`);
      return 0;
    }
  }

  async getThrottlerStats(): Promise<{
    totalKeys: number;
    blockedKeys: number;
    keysByThrottler: Record<string, number>;
  }> {
    try {
      const allKeys = await this.scanKeys('throttler:*');
      const blockedKeys = allKeys.filter(k => k.includes(':blocked'));

      const keysByThrottler: Record<string, number> = {};

      for (const key of allKeys) {
        // Extract throttler name from key pattern: throttlerName:controller-method-throttlerName-identifier
        const parts = key.split(':');
        if (parts.length >= 2) {
          const throttlerInfo = parts[1].split('-');
          if (throttlerInfo.length >= 3) {
            const throttlerName = throttlerInfo[2];
            keysByThrottler[throttlerName] = (keysByThrottler[throttlerName] || 0) + 1;
          }
        }
      }

      return {
        totalKeys: allKeys.length,
        blockedKeys: blockedKeys.length,
        keysByThrottler,
      };
    } catch (error) {
      console.error(`[RedisThrottlerStorage] Error getting stats: ${error.message}`);
      return {
        totalKeys: 0,
        blockedKeys: 0,
        keysByThrottler: {},
      };
    }
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, foundKeys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        this.scanCount,
      );

      cursor = nextCursor;
      keys.push(...foundKeys);
    } while (cursor !== '0');

    return keys;
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
