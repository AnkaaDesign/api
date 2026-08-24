import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { getRedisConfig } from '@common/config/redis.config';

@Injectable()
export class CacheService implements OnModuleDestroy {
  /**
   * Prefixo físico de TODA chave deste serviço. As chaves que entram e saem da
   * API pública são LÓGICAS (sem prefixo); quem traduz é este arquivo.
   */
  private static readonly KEY_PREFIX = 'cache:';

  private readonly redis: Redis;

  /**
   * Conexão SEM `keyPrefix`, para os comandos em que o prefixo automático do
   * ioredis não vale ou atrapalha.
   *
   * ARMADILHA QUE JÁ CUSTOU CARO (20/08/2026): o ioredis só prefixa os
   * ARGUMENTOS DE CHAVE que o command table reconhece. `SCAN`/`KEYS` recebem um
   * PADRÃO, não uma chave, e passam sem prefixo — enquanto `EVAL` tem os KEYS
   * reconhecidos e É prefixado. Misturar prefixo manual com prefixo automático
   * no mesmo comando produz `cache:cache:...`, que nunca casa com nada e
   * FALHA EM SILÊNCIO: foi assim que `releaseLock` passou meses sem soltar
   * trava nenhuma (cada trava vivia os 300 s do TTL) e que `clearPattern`
   * nunca apagou uma única chave.
   *
   * Aqui o prefixo é sempre explícito (`physicalKey`), então acquire e release
   * provadamente endereçam a MESMA chave, independentemente do que o ioredis
   * decida prefixar em qualquer versão futura.
   */
  private readonly rawRedis: Redis;

  constructor() {
    const config = getRedisConfig();
    this.redis = new Redis({
      ...config,
      keyPrefix: CacheService.KEY_PREFIX,
    });
    this.rawRedis = new Redis(config);
  }

  /** Chave lógica → chave física (a que existe de fato no Redis). */
  private physicalKey(key: string): string {
    return `${CacheService.KEY_PREFIX}${key}`;
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
    const result = await this.rawRedis.set(this.physicalKey(key), token, 'EX', ttlSeconds, 'NX');
    return result === 'OK' ? token : null;
  }

  /**
   * Libera a trava SOMENTE se ainda for do dono informado.
   *
   * O compare-and-delete é obrigatório: sem ele, um dono que estourou o TTL
   * apagaria a trava que outro processo já adquiriu, deixando dois rodando ao
   * mesmo tempo — exatamente o que a trava existe para impedir.
   *
   * Roda na conexão SEM `keyPrefix` (ver `rawRedis`): é a única forma de
   * garantir que o `del` daqui mire a mesma chave que o `set` do
   * `acquireLock` criou.
   *
   * `false` significa "a trava não era mais minha" — TTL estourado ou release
   * duplo. Quem chama deve LOGAR isso: foi o silêncio deste retorno que
   * escondeu o bug do prefixo duplicado.
   */
  async releaseLock(key: string, token: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end`;
    const released = await this.rawRedis.eval(script, 1, this.physicalKey(key), token);
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
   * Chaves que casam com o padrão LÓGICO informado (sem `cache:`), devolvidas
   * também em forma lógica — prontas para `get`/`del`/`getObject` deste mesmo
   * serviço.
   *
   * Duas correções em relação à versão anterior, que devolvia `[]` SEMPRE:
   *
   *  • o padrão precisa do prefixo físico (o ioredis não prefixa padrão de
   *    SCAN/KEYS, só argumento de chave) — sem ele, `bonus:absence:*` procurava
   *    por chaves que não existem, porque as reais são `cache:bonus:absence:*`;
   *  • o resultado precisa VOLTAR sem o prefixo, senão o `del`/`get` seguinte
   *    prefixa de novo e mira `cache:cache:...`.
   *
   * SCAN em vez de KEYS: KEYS é O(N) e bloqueia o Redis inteiro, e este método
   * é chamado dentro de laços de invalidação.
   */
  async keys(pattern: string): Promise<string[]> {
    const physicalPattern = this.physicalKey(pattern);
    // SCAN pode repetir chaves entre iterações — o Set é obrigatório, não zelo.
    const found = new Set<string>();
    let cursor = '0';
    do {
      const [next, batch] = await this.rawRedis.scan(
        cursor,
        'MATCH',
        physicalPattern,
        'COUNT',
        500,
      );
      cursor = next;
      for (const key of batch) {
        found.add(key.slice(CacheService.KEY_PREFIX.length));
      }
    } while (cursor !== '0');
    return [...found];
  }

  /**
   * Clear all keys matching pattern
   */
  async clearPattern(pattern: string): Promise<void> {
    const keys = await this.keys(pattern);
    // Em lotes: um único DEL com milhares de argumentos trava o Redis pelo
    // mesmo motivo que o KEYS acima.
    for (let i = 0; i < keys.length; i += 500) {
      await this.redis.del(...keys.slice(i, i + 500));
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
    // Falha ao encerrar NÃO pode virar exit code. Outros módulos (Baileys, por
    // exemplo) ainda escrevem no Redis enquanto o Nest desmonta, e um `quit()`
    // que cruza com um comando em voo rejeita com "Connection is closed" —
    // barulho de desligamento que fazia um script de manutenção terminar em
    // erro depois de ter concluído o trabalho.
    await Promise.all([
      this.redis.quit().catch(() => undefined),
      this.rawRedis.quit().catch(() => undefined),
    ]);
  }
}
