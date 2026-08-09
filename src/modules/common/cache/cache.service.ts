import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { getRedisConfig } from '@common/config/redis.config';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis({
      ...getRedisConfig(),
      keyPrefix: 'cache:',
    });
  }

  /**
   * Get value from cache
   */
  async get<T = string>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  /**
   * Set value in cache with optional TTL in seconds
   */
  async set<T = string>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds) {
      await this.redis.setex(key, ttlSeconds, serialized);
    } else {
      await this.redis.set(key, serialized);
    }
  }

  /**
   * Delete key from cache
   */
  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }

  /**
   * Trava distribuída: `SET key token NX EX ttl` — atômico, ao contrário do par
   * `exists()` + `set()`, que tem uma janela de corrida entre as duas chamadas.
   *
   * Vale entre PROCESSOS (API + scripts de manutenção), que é o ponto: um
   * `recalculate-bonus-period` rodando ao lado da API não é detectável por
   * mutex em memória.
   *
   * Devolve o token do dono, ou `null` se a trava já é de outro. O TTL é o
   * disjuntor: se o processo morrer sem liberar, a trava expira sozinha.
   */
  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const result = await this.redis.set(key, token, 'EX', ttlSeconds, 'NX');
    return result === 'OK' ? token : null;
  }

  /**
   * Libera a trava SOMENTE se ainda for do dono informado.
   *
   * O compare-and-delete é obrigatório: sem ele, um dono que estourou o TTL
   * apagaria a trava que outro processo já adquiriu, deixando dois rodando ao
   * mesmo tempo — exatamente o que a trava existe para impedir.
   */
  async releaseLock(key: string, token: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end`;
    const released = await this.redis.eval(script, 1, `cache:${key}`, token);
    return released === 1;
  }

  /**
   * Get object from cache (JSON)
   */
  async getObject<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Set object in cache (JSON)
   */
  async setObject<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const stringValue = JSON.stringify(value);
    await this.set(key, stringValue, ttlSeconds);
  }

  /**
   * Get all keys matching pattern
   */
  async keys(pattern: string): Promise<string[]> {
    return this.redis.keys(pattern);
  }

  /**
   * Clear all keys matching pattern
   */
  async clearPattern(pattern: string): Promise<void> {
    const keys = await this.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  /**
   * Set hash field
   */
  async hset(key: string, field: string, value: string): Promise<void> {
    await this.redis.hset(key, field, value);
  }

  /**
   * Get hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    return this.redis.hget(key, field);
  }

  /**
   * Get all hash fields
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    return this.redis.hgetall(key);
  }

  /**
   * Increment counter
   */
  async incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  /**
   * Decrement counter
   */
  async decr(key: string): Promise<number> {
    return this.redis.decr(key);
  }

  /**
   * Set expiration on key
   */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, ttlSeconds);
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
