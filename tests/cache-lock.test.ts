/**
 * Guarda da trava distribuída e da varredura por padrão do `CacheService`.
 *
 * O ioredis do `CacheService` é criado com `keyPrefix: 'cache:'`, e o prefixo
 * automático NÃO se aplica de forma uniforme:
 *
 *   · `get`/`set`/`del`/`eval` recebem ARGUMENTOS DE CHAVE → são prefixados;
 *   · `scan`/`keys` recebem um PADRÃO, não uma chave → passam sem prefixo.
 *
 * Misturar prefixo manual com prefixo automático no mesmo comando produz
 * `cache:cache:…`, que não casa com nada e **falha em silêncio**. Foi assim que:
 *
 *   · `releaseLock` passou a existir sem NUNCA soltar uma trava. Cada trava
 *     vivia os 300 s do TTL, então dois cálculos de bonificação do mesmo período
 *     dentro de 5 minutos se atropelavam: o segundo esperava os 120 s e morria
 *     com "outro cálculo em andamento" — sem que houvesse nenhum. Em 20/08/2026
 *     quatro demissões seguidas caíram nisso e a bonificação da rescisão de duas
 *     pessoas não fechou;
 *   · `keys()` devolvia `[]` para qualquer padrão e `clearPattern()` nunca
 *     apagou uma chave sequer.
 *
 * O que este arquivo protege:
 *  · adquirir e soltar a trava endereçam a MESMA chave física;
 *  · soltar de verdade libera para o próximo na hora, sem esperar TTL;
 *  · quem não é dono não consegue soltar (o compare-and-delete vale);
 *  · `keys()` acha as chaves reais e as devolve em forma LÓGICA, prontas para
 *    `get`/`del` do mesmo serviço.
 *
 * Precisa de um Redis acessível (as mesmas variáveis do `.env`). Sem Redis o
 * teste avisa e sai com 0 — é guarda de regressão, não porteiro de CI.
 *
 * Rodar: pnpm tsx tests/cache-lock.test.ts
 */

import Redis from 'ioredis';
import { CacheService } from '../src/modules/common/cache/cache.service';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const NS = `test:cache-lock:${process.pid}`;

async function main(): Promise<void> {
  const cache = new CacheService();

  // Conexão CRUA (sem keyPrefix): é o único jeito de afirmar em que chave
  // FÍSICA o serviço mexeu — é exatamente aí que o bug morava.
  const raw = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
    db: Number(process.env.REDIS_DB ?? 0),
    lazyConnect: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
  });

  try {
    await raw.connect();
  } catch (err) {
    console.log(`\n⚠️  Redis indisponível (${(err as Error).message}) — teste pulado.\n`);
    await cache.onModuleDestroy().catch(() => undefined);
    raw.disconnect();
    process.exit(0);
  }

  try {
    // -----------------------------------------------------------------------
    console.log('\nTrava: adquirir e soltar apontam para a mesma chave');
    {
      const key = `${NS}:lock`;
      const token = await cache.acquireLock(key, 300);
      check('adquire a trava', token !== null);

      const physical = await raw.get(`cache:${key}`);
      check('grava em cache:<chave>', physical === token, `valor físico = ${physical}`);
      check(
        'não grava em cache:cache:<chave>',
        (await raw.get(`cache:cache:${key}`)) === null,
      );

      check('segunda aquisição é recusada enquanto a trava é de alguém', (await cache.acquireLock(key, 300)) === null);

      const released = await cache.releaseLock(key, token!);
      check('releaseLock devolve true', released === true);
      check('a chave física sumiu', (await raw.get(`cache:${key}`)) === null);

      // O ponto do incidente: liberar tem de valer AGORA, não daqui a 300 s.
      const again = await cache.acquireLock(key, 300);
      check('o próximo dono entra imediatamente, sem esperar o TTL', again !== null);
      if (again) await cache.releaseLock(key, again);
    }

    // -----------------------------------------------------------------------
    console.log('\nTrava: compare-and-delete impede roubo');
    {
      const key = `${NS}:lock2`;
      const token = await cache.acquireLock(key, 300);
      check(
        'quem não é dono não solta',
        (await cache.releaseLock(key, 'token-de-outro')) === false,
      );
      check('e a trava continua de pé', (await raw.get(`cache:${key}`)) === token);
      await cache.releaseLock(key, token!);
    }

    // -----------------------------------------------------------------------
    console.log('\nVarredura por padrão: acha as chaves reais e devolve chave lógica');
    {
      await cache.set(`${NS}:scan:a`, 'a', 60);
      await cache.set(`${NS}:scan:b`, 'b', 60);
      await cache.set(`${NS}:outro`, 'c', 60);

      const found = await cache.keys(`${NS}:scan:*`);
      check('encontra as duas chaves do padrão', found.length === 2, `achou ${found.length}`);
      check(
        'devolve a chave LÓGICA (sem o prefixo físico)',
        found.every(k => !k.startsWith('cache:')),
        found.join(', '),
      );
      // O que quebrava antes: a chave devolvida tinha de servir de entrada para
      // o próprio serviço. Com prefixo embutido, o `get` seguinte mirava
      // `cache:cache:…` e devolvia null.
      check('a chave devolvida serve para get()', (await cache.get(found[0])) !== null);

      await cache.clearPattern(`${NS}:scan:*`);
      check('clearPattern apaga de verdade', (await cache.keys(`${NS}:scan:*`)).length === 0);
      check('e não encosta em quem está fora do padrão', (await cache.get(`${NS}:outro`)) === 'c');
      await cache.del(`${NS}:outro`);
    }
  } finally {
    // Limpeza: nada deste teste pode sobrar no Redis de ninguém.
    const leftovers = await raw.keys(`cache:${NS}*`);
    if (leftovers.length > 0) await raw.del(...leftovers);
    await cache.onModuleDestroy().catch(() => undefined);
    await raw.quit();
  }
}

main()
  .then(() => {
    console.log(
      failures === 0
        ? '\n✅ Todas as verificações passaram.\n'
        : `\n❌ ${failures} verificação(ões) falharam.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ Erro inesperado:', err);
    process.exit(1);
  });
