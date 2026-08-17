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

        // NÃO descartar credenciais por `registered !== true`: esse campo só é
        // escrito no pareamento por CÓDIGO DE TELEFONE (`messages-recv.js:697`).
        // Numa sessão pareada por QR ele fica `false` permanentemente, e usá-lo
        // como sinal de corrupção apaga a credencial recém-pareada na janela do
        // `stream:error 515`, prendendo a conexão num laço de QR infinito.
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
          const parsed = JSON.parse(stored, BufferJSON.reviver);
          // Não devolve chave com valor nulo: para o Baileys, a ausência da
          // entrada é o que significa "não existe". Cobre também o lixo deixado
          // pela versão anterior deste store, que gravava a string "null" em vez
          // de apagar a chave.
          if (parsed !== null && parsed !== undefined) {
            result[id] = parsed;
          }
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
      const promises: Promise<unknown>[] = [];
      let written = 0;
      let removed = 0;

      for (const [category, entries] of Object.entries(data)) {
        for (const [id, value] of Object.entries(entries as any)) {
          const key = `${this.KEYS_PREFIX}${category}:${id}`;

          // `null` é o sinal de REMOÇÃO no contrato do Baileys (`SignalDataMap`
          // declara `SignalDataTypeMap[T] | null`), não um valor a guardar.
          // Serializar isso gravava a string "null" e a chave sobrevivia até o
          // TTL de 30 dias. Passou a importar a partir da 7.0.0-rc10, que
          // introduziu o ciclo de vida completo do TC token (emissão, revogação,
          // expiração e pruning) — justamente o token cuja ausência faz o
          // servidor recusar a mensagem com o nack 463.
          if (value === null || value === undefined) {
            promises.push(this.cacheService['redis'].del(key));
            removed++;
            continue;
          }

          const serialized = JSON.stringify(value, BufferJSON.replacer);
          // Use raw Redis client to avoid double-stringifying
          promises.push(this.cacheService['redis'].setex(key, this.TTL_SECONDS, serialized));
          written++;
        }
      }

      await Promise.all(promises);
      this.logger.debug(`Saved ${written} keys to Redis${removed ? `, removed ${removed}` : ''}`);
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
      const redis = this.cacheService['redis'];

      // ARMADILHA: o cliente é criado com `keyPrefix: 'cache:'`, e o ioredis
      // aplica esse prefixo aos ARGUMENTOS DE CHAVE (get/setex/del) mas NÃO ao
      // padrão do SCAN. Então o SCAN precisa do prefixo explícito e o DEL precisa
      // dele removido — senão o alvo vira `cache:cache:...` e nada é apagado.
      // (É o mesmo defeito que deixa `CacheService.clearPattern` sem efeito.)
      const prefix: string = redis.options?.keyPrefix ?? '';
      const pattern = `${prefix}${this.KEY_PREFIX}*`;

      const toDelete: string[] = [];
      let cursor = '0';
      do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        cursor = next;
        for (const key of batch) {
          toDelete.push(prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key);
        }
      } while (cursor !== '0');

      // Apaga creds E as chaves de signal. Deixar as chaves para trás produz o
      // mesmo híbrido corrompido que este método existe para resolver: creds novo
      // convivendo com pre-keys/sessions da sessão anterior.
      for (let i = 0; i < toDelete.length; i += 500) {
        await redis.del(...toDelete.slice(i, i + 500));
      }

      this.logger.log(`Cleared auth state from Redis (${toDelete.length} chaves)`);
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
      // Mesmo caminho raw de `loadCreds` — `cacheService.get` faz parse próprio e
      // divergia da escrita. O sinal de sessão pareada é `me.id`; `registered`
      // NÃO serve (fica `false` para sempre em pareamento por QR).
      const stored = await this.cacheService['redis'].get(this.CREDS_KEY);
      if (!stored) return false;
      const parsed = JSON.parse(stored, BufferJSON.reviver);
      return Boolean(parsed?.me?.id);
    } catch (error) {
      return false;
    }
  }
}
