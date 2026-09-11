/**
 * Verificação da PORTA DE ENTRADA do canal oficial de WhatsApp.
 *
 * Usage: npm run test:whatsapp-webhook
 *        (ts-node, e NÃO tsx: o esbuild não emite `design:paramtypes`, e sem esse
 *         metadata a injeção por tipo do Nest entrega `undefined` no construtor)
 * Sai 0 se tudo confere, 1 na primeira divergência.
 *
 * POR QUE ISTO EXISTE
 *   O webhook da Meta é cadastrado UMA vez, num formulário que só diz "não foi
 *   possível validar a URL" quando algo está errado — sem dizer o quê. E as duas
 *   coisas que ele exige são justamente as que este projeto quase quebrou por
 *   configuração distante:
 *
 *     1. o handshake `GET` lê `hub.mode`, `hub.verify_token` e `hub.challenge`,
 *        e o parser de query do `main.ts` roda com `allowDots: true` — o que
 *        entrega `{ hub: { mode } }` em vez de `{ 'hub.mode': ... }`. Quem
 *        escrever `@Query('hub.mode')` recebe `undefined` e o cadastro falha;
 *     2. a assinatura `POST` é HMAC-SHA256 sobre os BYTES CRUS do corpo. Se a
 *        rota sair da lista de rawBody do `main.ts`, a verificação passa a
 *        comparar um corpo reserializado e RECUSA tudo que a Meta mandar.
 *
 *   Nenhuma das duas falha no `tsc`. Ambas falham em produção, em silêncio.
 *
 * NÃO SOBE A API INTEIRA: monta um Nest mínimo com o módulo do webhook e repete
 * o parser de query e o middleware de corpo cru do `main.ts`. Sem banco, sem
 * Redis — a porta é verificada sozinha, como ela é vista pela Meta.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import * as qs from 'qs';
import * as crypto from 'crypto';
import { WhatsAppCloudModule } from '../src/modules/integrations/whatsapp-cloud/whatsapp-cloud.module';

const APP_SECRET = 'app-secret-de-teste';
const VERIFY_TOKEN = 'verify-token-de-teste';
const PORT = 3099;

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    WhatsAppCloudModule,
  ],
})
class WebhookSmokeModule {}

const failures: string[] = [];

function check(label: string, condition: boolean, detail: string): void {
  const mark = condition ? '  ok  ' : ' FALHA';
  console.log(`[${mark}] ${label} — ${detail}`);
  if (!condition) failures.push(label);
}

function sign(body: string): string {
  return crypto.createHmac('sha256', APP_SECRET).update(Buffer.from(body, 'utf8')).digest('hex');
}

async function main(): Promise<void> {
  process.env.WHATSAPP_CLOUD_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_CLOUD_VERIFY_TOKEN = VERIFY_TOKEN;

  const app = await NestFactory.create<NestExpressApplication>(WebhookSmokeModule, {
    bodyParser: false,
    logger: ['error', 'warn'],
  });

  // Espelha o parser de query do main.ts — `allowDots` é o ponto do teste.
  app.set('query parser', (str: string) =>
    qs.parse(str, { depth: 10, allowDots: true, strictNullHandling: true }),
  );

  // Espelha o middleware de corpo cru do main.ts.
  app.use((req: any, _res: any, next: any) => {
    if (req.method === 'POST' && req.url === '/webhooks/whatsapp') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        req.rawBody = raw;
        try {
          req.body = JSON.parse(raw.toString('utf8'));
        } catch {
          req.body = {};
        }
        req._body = true;
        next();
      });
      req.on('error', (err: Error) => next(err));
    } else next();
  });
  app.use(express.json({ limit: '50mb' }));

  await app.listen(PORT);
  const url = `http://127.0.0.1:${PORT}/webhooks/whatsapp`;

  // 1. Handshake válido: a Meta compara o CORPO INTEIRO com o desafio que mandou.
  const challenge = '1158201444';
  let res = await fetch(
    `${url}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=${challenge}`,
  );
  const body = await res.text();
  check(
    'handshake devolve o desafio cru',
    res.status === 200 && body === challenge,
    `status ${res.status}, corpo "${body}"`,
  );
  check(
    'handshake responde em text/plain',
    (res.headers.get('content-type') ?? '').includes('text/plain'),
    res.headers.get('content-type') ?? 'sem content-type',
  );

  // 2. Token errado não passa.
  res = await fetch(`${url}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=9`);
  check('handshake recusa token errado', res.status === 403, `status ${res.status}`);

  // 3. Lote assinado: status de entrega, falha com código e mensagem recebida.
  const payload = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'PHONE_ID' },
              statuses: [
                { id: 'wamid.OK', status: 'delivered', recipient_id: '5543984283228' },
                {
                  id: 'wamid.RUIM',
                  status: 'failed',
                  recipient_id: '5543984283228',
                  errors: [
                    {
                      code: 131049,
                      title: 'Mensagem não entregue',
                      error_data: { details: 'healthy ecosystem pacing' },
                    },
                  ],
                },
              ],
              messages: [
                { id: 'wamid.IN', from: '5543999998888', type: 'text', text: { body: 'ok' } },
              ],
            },
          },
        ],
      },
    ],
  });
  res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${sign(payload)}` },
    body: payload,
  });
  check('lote assinado é aceito', res.status === 200, `status ${res.status}`);

  // 4. Assinatura adulterada é recusada — é o que separa status real de forjado.
  res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
    body: payload,
  });
  check('assinatura forjada é recusada', res.status === 401, `status ${res.status}`);

  // 5. Corpo alterado com assinatura do corpo original: a prova é sobre os BYTES.
  res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${sign(payload)}` },
    body: payload.replace('delivered', 'read'),
  });
  check('corpo adulterado é recusado', res.status === 401, `status ${res.status}`);

  // 6. Sem cabeçalho de assinatura não há o que verificar.
  res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
  });
  check('lote sem assinatura é recusado', res.status === 401, `status ${res.status}`);

  // 7. Recusa de template é evento de conta, e tem de ser aceita como tal.
  const templateEvent = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'message_template_status_update',
            value: {
              message_template_name: 'orcamento_pronto_assinatura',
              event: 'REJECTED',
              reason: 'INVALID_FORMAT',
            },
          },
        ],
      },
    ],
  });
  res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${sign(templateEvent)}`,
    },
    body: templateEvent,
  });
  check('evento de template é aceito', res.status === 200, `status ${res.status}`);

  await new Promise(resolve => setTimeout(resolve, 200));
  await app.close();

  console.log('');
  if (failures.length > 0) {
    console.error(`${failures.length} verificação(ões) falharam: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('Webhook do WhatsApp: handshake e assinatura conferem.');
  process.exit(0);
}

main().catch(error => {
  console.error('Falha na verificação:', error);
  process.exit(1);
});
