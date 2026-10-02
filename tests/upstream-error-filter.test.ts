/**
 * Falha de serviço EXTERNO que a rota deixou subir vira 502/504 nomeando o
 * host, não o 500 genérico (ex.: `GET /nfse/:id` com a Elotech fora do ar).
 *
 *   npx tsx -r tsconfig-paths/register tests/upstream-error-filter.test.ts
 */
import assert from 'node:assert/strict';
import axios from 'axios';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

function run(exception: unknown) {
  const out: { status?: number; body?: any } = {};
  const res: any = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: any) {
      out.body = body;
    },
  };
  const req: any = { url: '/nfse/1', method: 'GET', headers: {}, body: {}, get: () => undefined };
  const host: any = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) };
  new GlobalExceptionFilter().catch(exception, host);
  return out;
}

async function main() {
  const refused = await axios.get('http://127.0.0.1:9/x', { timeout: 2000 }).catch(e => e);
  const a = run(refused);
  assert.equal(a.status, 502);
  assert.equal(a.body.error, 'UPSTREAM_ERROR');
  assert.equal(a.body.details.upstreamHost, '127.0.0.1:9');
  console.log('  ✓ serviço externo recusou → 502 com o host');

  const timeout = Object.assign(new axios.AxiosError('timeout of 1ms exceeded', 'ECONNABORTED'), {
    config: { url: 'https://oxy.elotech.com.br/x' },
  });
  const b = run(timeout);
  assert.equal(b.status, 504);
  assert.equal(b.body.error, 'UPSTREAM_TIMEOUT');
  assert.equal(b.body.details.upstreamHost, 'oxy.elotech.com.br');
  console.log('  ✓ serviço externo não respondeu → 504');

  const c = run(new Error('boom'));
  assert.equal(c.status, 500);
  console.log('  ✓ erro nosso continua 500');
  console.log('\n✓ TODAS as verificações passaram');
}
main();
