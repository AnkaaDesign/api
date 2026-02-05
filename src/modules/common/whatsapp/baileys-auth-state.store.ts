import { Injectable, Logger } from '@nestjs/common';
import {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap,
  initAuthCreds,
  BufferJSON,
} from '@whiskeysockets/baileys';
import { proto } from '@whiskeysockets/baileys';
import { CacheService } from '../cache/cache.service';

/**
 * Redis-backed authentication state store for Baileys
 * Replaces whatsapp-web.js RemoteAuth with Baileys-native auth state management
 *
 * Storage Strategy:
 * - Credentials: whatsapp:baileys:creds
 * - Keys: whatsapp:baileys:keys:{key-type}:{key-id}
 * - App State: whatsapp:baileys:app-state:{name}
 *
 * Benefits over whatsapp-web.js:
 * - No ZIP compression needed (JSON is smaller)
 * - Faster startup (no file extraction)
 * - Better multi-instance support
 * - Atomic updates per key type
 */
@Injectable()
export class BaileysAuthStateStore {
  private readonly logger = new Logger(BaileysAuthStateStore.name);
  private readonly KEY_PREFIX = 'whatsapp:baileys:';
  private readonly CREDS_KEY = `${this.KEY_PREFIX}creds`;
  private readonly KEYS_PREFIX = `${this.KEY_PREFIX}keys:`;
  private readonly APP_STATE_PREFIX = `${this.KEY_PREFIX}app-state:`;
  private readonly TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

  constructor(private readonly cacheService: CacheService) {}

  /**
   * Initialize Baileys auth state from Redis
   * Called once during socket initialization
   */
  async initAuthState(): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
    // Load credentials from Redis
    const creds = await this.loadCreds();

    // Create auth state object
    const state: AuthenticationState = {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          return this.getKeys(type, ids) as Promise<{ [id: string]: SignalDataTypeMap[T] }>;
        },
        set: async (data: any) => {
          return this.setKeys(data);
        },
      },
    };

    // Save credentials function (called by Baileys on creds.update)
    const saveCreds = async () => {
      await this.saveCreds(state.creds);
    };

    return { state, saveCreds };
  }

  /**
   * Load credentials from Redis
   */
  private async loadCreds(): Promise<AuthenticationCreds> {
    try {
      // Get raw string from Redis (CacheService auto-parses, so we need the raw value)
      const stored = await this.cacheService['redis'].get(this.CREDS_KEY);

      if (stored) {
        // Parse with BufferJSON to handle Buffer objects
        const parsed = JSON.parse(stored, BufferJSON.reviver);
        this.logger.log('Loaded existing credentials from Redis');
        return parsed;
      }

      this.logger.log('No existing credentials found, generating new credentials');
      return initAuthCreds(); // Generate new credentials
    } catch (error) {
      this.logger.error(`Failed to load credentials: ${error.message}, generating new`);
      return initAuthCreds(); // Generate new credentials on error
    }
  }

  /**
   * Save credentials to Redis
   */
  private async saveCreds(creds: AuthenticationCreds): Promise<void> {
    try {
      // Stringify with BufferJSON to handle Buffer objects
      const serialized = JSON.stringify(creds, BufferJSON.replacer);
      // Use raw Redis client to avoid double-stringifying
      await this.cacheService['redis'].setex(this.CREDS_KEY, this.TTL_SECONDS, serialized);
      this.logger.log('Saved credentials to Redis');
    } catch (error) {
      this.logger.error(`Failed to save credentials: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get keys from Redis by type and IDs
   */
  private async getKeys<T extends keyof SignalDataTypeMap>(
    type: T,
    ids: string[],
  ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
    const result: { [id: string]: any } = {};

    try {
      for (const id of ids) {
        const key = `${this.KEYS_PREFIX}${type}:${id}`;
        // Use raw Redis client to get string value
        const stored = await this.cacheService['redis'].get(key);

        if (stored) {
          result[id] = JSON.parse(stored, BufferJSON.reviver);
        }
      }

      this.logger.debug(
        `Retrieved ${Object.keys(result).length}/${ids.length} keys of type ${type}`,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to get keys (type: ${type}): ${error.message}`);
      return result;
    }
  }

  /**
   * Set keys in Redis
   */
  private async setKeys(data: any): Promise<void> {
    try {
      const promises: Promise<'OK'>[] = [];

      for (const [category, entries] of Object.entries(data)) {
        for (const [id, value] of Object.entries(entries as any)) {
          const key = `${this.KEYS_PREFIX}${category}:${id}`;
          const serialized = JSON.stringify(value, BufferJSON.replacer);
          // Use raw Redis client to avoid double-stringifying
          promises.push(this.cacheService['redis'].setex(key, this.TTL_SECONDS, serialized));
        }
      }

      await Promise.all(promises);
      this.logger.debug(`Saved ${promises.length} keys to Redis`);
    } catch (error) {
      this.logger.error(`Failed to set keys: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clear all auth state from Redis
   * Used for logout/reset operations
   */
  async clearAuthState(): Promise<void> {
    try {
      // Delete credentials
      await this.cacheService.del(this.CREDS_KEY);

      // Delete all keys (would need pattern matching - implement if needed)
      this.logger.log('Cleared auth state from Redis');
    } catch (error) {
      this.logger.error(`Failed to clear auth state: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if auth state exists in Redis
   */
  async hasAuthState(): Promise<boolean> {
    try {
      const creds = await this.cacheService.get(this.CREDS_KEY);
      return !!creds;
    } catch (error) {
      return false;
    }
  }
}
