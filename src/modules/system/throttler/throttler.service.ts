import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class ThrottlerService {
  private redis: Redis;
  private readonly keyPrefix = 'throttler:';

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
    });
  }

  private formatTTL(seconds: number): string {
    if (seconds <= 0) return 'expired';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  }

  async getStats() {
    const allKeys = await this.scanKeys('*');
    const blockedKeys = allKeys.filter(k => k.includes(':blocked'));
    const activeKeys = allKeys.filter(k => !k.includes(':blocked'));

    const keysByType: Record<string, number> = {};
    const keysByController: Record<string, number> = {};

    for (const key of activeKeys) {
      // Parse key pattern: controller-method-throttlerName-identifier
      const keyWithoutPrefix = key.replace(this.keyPrefix, '');
      const parts = keyWithoutPrefix.split(':')[0].split('-');

      if (parts.length >= 3) {
        const controller = parts[0];
        const method = parts[1];
        const throttlerName = parts[2];

        keysByType[throttlerName] = (keysByType[throttlerName] || 0) + 1;
        keysByController[`${controller}.${method}`] =
          (keysByController[`${controller}.${method}`] || 0) + 1;
      }
    }

    // Get TTLs for blocked keys
    const blockedDetails = await Promise.all(
      blockedKeys.map(async key => {
        const ttl = await this.redis.ttl(key);
        const baseKey = key.replace(':blocked', '').replace(this.keyPrefix, '');
        return {
          key: baseKey,
          ttl,
          expiresIn: this.formatTTL(ttl),
        };
      }),
    );

    return {
      totalKeys: allKeys.length,
      activeKeys: activeKeys.length,
      blockedKeys: blockedKeys.length,
      keysByType,
      keysByController,
      blockedDetails: blockedDetails.filter(d => d.ttl > 0),
    };
  }

  async getKeys(pattern?: string, limit = 100): Promise<any[]> {
    const searchPattern = pattern ? `*${pattern}*` : '*';
    const allKeys = await this.scanKeys(searchPattern);

    const keys = allKeys.slice(0, limit);

    const keyDetails = await Promise.all(
      keys.map(async key => {
        const ttl = await this.redis.ttl(key);
        const value = await this.redis.get(key);
        const keyWithoutPrefix = key.replace(this.keyPrefix, '');

        // Parse the key
        const isBlocked = keyWithoutPrefix.includes(':blocked');
        const withoutBlocked = keyWithoutPrefix.replace(':blocked', '');

        // Key format: throttlerName:ControllerName-endpointName-throttlerName-identifier
        // Example: medium:ServerController-getMetrics-medium-ip:::ffff:127.0.0.1
        // We need to be careful with the identifier as it can contain colons (IPv6) and hyphens

        let controller = '-';
        let method = '-';
        let throttlerName = '-';
        let identifier = '-';

        // Split by the first colon to get throttler name
        const colonIndex = withoutBlocked.indexOf(':');
        if (colonIndex > 0) {
          throttlerName = withoutBlocked.substring(0, colonIndex);
          const remainder = withoutBlocked.substring(colonIndex + 1);

          // Now split the remainder by hyphens, but only take the first 3 parts
          // ControllerName-endpointName-throttlerName-identifier
          const parts = remainder.split('-');
          if (parts.length >= 4) {
            controller = parts[0];
            method = parts[1];
            // parts[2] is redundant throttlerName
            // Everything from parts[3] onwards is the identifier (rejoin with hyphens)
            identifier = parts.slice(3).join('-');
          }
        }

        return {
          key: keyWithoutPrefix,
          controller,
          method,
          throttlerName,
          identifier,
          isBlocked,
          hits: isBlocked ? null : parseInt(value || '0'),
          ttl,
          expiresIn: this.formatTTL(ttl),
        };
      }),
    );

    return keyDetails.filter(k => k.ttl > 0);
  }

  async clearKeys(pattern?: string): Promise<number> {
    const searchPattern = pattern ? `*${pattern}*` : '*';
    const keys = await this.scanKeys(searchPattern);

    if (keys.length === 0) {
      return 0;
    }

    // Delete keys as-is (they already have the prefix)
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }

    return keys.length;
  }

  async clearSpecificKey(key: string): Promise<boolean> {
    // Try deleting the key with prefix
    const keyWithPrefix = `${this.keyPrefix}${key}`;
    const result = await this.redis.del(keyWithPrefix);

    // Also try deleting the blocked version
    const blockedKeyWithPrefix = `${this.keyPrefix}${key}:blocked`;
    await this.redis.del(blockedKeyWithPrefix);

    return result > 0;
  }

  async clearUserKeys(userId: string): Promise<number> {
    const pattern = `*user:${userId}*`;
    return this.clearKeys(pattern);
  }

  async clearIpKeys(ip: string): Promise<number> {
    const pattern = `*ip:${ip}*`;
    return this.clearKeys(pattern);
  }

  async clearBlockedKeys(): Promise<number> {
    const pattern = '*:blocked';
    return this.clearKeys(pattern);
  }

  async getBlockedKeys(): Promise<any[]> {
    const blockedKeys = await this.scanKeys('*:blocked');

    const blockedDetails = await Promise.all(
      blockedKeys.map(async key => {
        const ttl = await this.redis.ttl(key);
        // Remove prefix and :blocked suffix
        // Key format: throttler:throttlerName:ControllerName-endpointName-throttlerName-identifier:blocked
        const withoutPrefix = key.replace(this.keyPrefix, '');
        const withoutBlocked = withoutPrefix.replace(':blocked', '');

        // Key format: throttlerName:ControllerName-endpointName-throttlerName-identifier
        // Example: medium:ServerController-getMetrics-medium-ip:::ffff:127.0.0.1
        // We need to be careful with the identifier as it can contain colons (IPv6) and hyphens

        let controller = '-';
        let method = '-';
        let throttlerName = '-';
        let identifier = '-';

        // Split by the first colon to get throttler name
        const colonIndex = withoutBlocked.indexOf(':');
        if (colonIndex > 0) {
          throttlerName = withoutBlocked.substring(0, colonIndex);
          const remainder = withoutBlocked.substring(colonIndex + 1);

          // Now split the remainder by hyphens, but only take the first 3 parts
          // ControllerName-endpointName-throttlerName-identifier
          const parts = remainder.split('-');
          if (parts.length >= 4) {
            controller = parts[0];
            method = parts[1];
            // parts[2] is redundant throttlerName
            // Everything from parts[3] onwards is the identifier (rejoin with hyphens)
            identifier = parts.slice(3).join('-');
          }
        }

        // Try to determine if it's a user or IP
        const isUser = identifier.includes('user:');
        const isIp = identifier.includes('ip:');
        const cleanIdentifier = identifier.replace('user:', '').replace('ip:', '');

        return {
          key: withoutBlocked,
          controller,
          method,
          throttlerName,
          identifierType: isUser ? 'user' : isIp ? 'ip' : 'unknown',
          identifier: cleanIdentifier,
          ttl,
          expiresIn: this.formatTTL(ttl),
        };
      }),
    );

    return blockedDetails.filter(d => d.ttl > 0);
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    const fullPattern = `${this.keyPrefix}${pattern}`;

    do {
      const [nextCursor, foundKeys] = await this.redis.scan(
        cursor,
        'MATCH',
        fullPattern,
        'COUNT',
        1000,
      );

      cursor = nextCursor;
      keys.push(...foundKeys);
    } while (cursor !== '0');

    return keys;
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
