import { env } from './env.validation';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
}

/**
 * Returns the centralized Redis connection configuration.
 * Values come from the validated environment singleton (env.validation.ts).
 *
 * Defaults (defined in the env schema):
 *   host = 'localhost'
 *   port = 6379
 *   db   = 0
 */
export function getRedisConfig(): RedisConfig {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    db: env.REDIS_DB,
  };
}
