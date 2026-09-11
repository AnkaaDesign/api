// api/src/modules/integrations/whatsapp-cloud/whatsapp-cloud-webhook.controller.ts
//
// Porta de entrada do canal oficial: `https://api.ankaadesign.com.br/webhooks/whatsapp`.
//
// SÃO DOIS SEGREDOS DIFERENTES, E CONFUNDI-LOS É O ERRO CLÁSSICO
//   `GET`  — handshake de assinatura. A Meta manda `hub.verify_token` e espera
//            de volta, em TEXTO PURO, o `hub.challenge`. O segredo comparado aqui
//            é o `WHATSAPP_CLOUD_VERIFY_TOKEN`, que NÓS inventamos e colamos no
//            painel. Ele não protege nada depois do cadastro.
//   `POST`  — entrega de eventos. Aqui o que prova a origem é a assinatura
//            `x-hub-signature-256`: HMAC-SHA256 do CORPO CRU com o APP SECRET do
//            app. Sem essa verificação, qualquer um forja um `delivered`.
//
// O CORPO TEM DE SER O CRU
//   A assinatura é sobre os bytes exatos que a Meta enviou. `JSON.parse` seguido
//   de `JSON.stringify` reordena chaves e muda escape — a assinatura não fecha
//   mais. Por isso `/webhooks/whatsapp` está na lista de rotas que o middleware
//   do `main.ts` captura ANTES do `express.json`, guardando `req.rawBody`.
//
// RESPONDER 200 É QUASE A ÚNICA OBRIGAÇÃO
//   A Meta reentrega o lote por horas quando não recebe 200 e, se a falha
//   persistir, DESATIVA a inscrição do webhook sem avisar. Então: responde 200
//   assim que a assinatura fecha, e processa depois, fora do ciclo da resposta.
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import * as crypto from 'crypto';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { NoRateLimit } from '@common/decorators/no-rate-limit.decorator';
import { WhatsAppCloudConfig } from './whatsapp-cloud.config';
import { WhatsAppCloudWebhookService } from './whatsapp-cloud-webhook.service';
import { WhatsAppCloudWebhookPayload } from './whatsapp-cloud.types';

@Controller('webhooks/whatsapp')
export class WhatsAppCloudWebhookController {
  private readonly logger = new Logger(WhatsAppCloudWebhookController.name);

  constructor(
    private readonly config: WhatsAppCloudConfig,
    private readonly webhookService: WhatsAppCloudWebhookService,
  ) {}

  /**
   * GET /webhooks/whatsapp — handshake de assinatura do painel da Meta.
   *
   * Devolve o desafio em `text/plain` e NADA MAIS. A Meta compara o corpo inteiro
   * com o valor que mandou: qualquer envelope JSON em volta reprova o handshake.
   */
  @Get()
  @Public()
  @NoRateLimit()
  verify(
    @Query() query: Record<string, any>,
    @Res({ passthrough: true }) res: Response,
  ): string {
    const { mode, token, challenge } = this.readHubParams(query);

    const expected = this.config.verifyToken;
    if (!expected) {
      this.logger.error(
        'WHATSAPP_CLOUD_VERIFY_TOKEN ausente — handshake recusado (não há com o que comparar)',
      );
      throw new ForbiddenException('Webhook verification is not configured');
    }

    if (mode !== 'subscribe' || !token || !this.secretsMatch(token, expected)) {
      this.logger.warn(`Handshake do webhook recusado (mode=${mode ?? 'ausente'})`);
      throw new ForbiddenException('Invalid verify token');
    }

    // O cabeçalho é posto AQUI, e não como `@Header` no método: um decorator
    // vale também para a resposta de erro, e o 403 sairia anunciando texto puro
    // com corpo JSON — o Nest reclama disso em log a cada recusa.
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    this.logger.log('Handshake do webhook do WhatsApp aceito');
    return challenge ?? '';
  }

  /**
   * POST /webhooks/whatsapp — status de entrega, mensagens recebidas e avisos da conta.
   */
  @Post()
  @Public()
  @NoRateLimit()
  @HttpCode(200)
  receive(@Req() req: any, @Body() payload: WhatsAppCloudWebhookPayload): { received: boolean } {
    this.verifySignature(req);

    // Processa FORA do ciclo da resposta: o 200 não espera nada.
    setImmediate(() => this.webhookService.process(payload));

    return { received: true };
  }

  /**
   * `allowDots: true` no parser de query (main.ts) transforma `hub.mode` em
   * `{ hub: { mode } }`. Ler as duas formas é o que impede o handshake de quebrar
   * se um dia essa opção mudar — e ela já mudou uma vez, por causa de
   * `array[0].field`.
   */
  private readHubParams(query: Record<string, any>): {
    mode?: string;
    token?: string;
    challenge?: string;
  } {
    const hub = (query?.hub ?? {}) as Record<string, any>;
    const pick = (key: string): string | undefined => {
      const raw = hub[key] ?? query?.[`hub.${key}`];
      return raw === undefined || raw === null ? undefined : String(raw);
    };

    return { mode: pick('mode'), token: pick('verify_token'), challenge: pick('challenge') };
  }

  /**
   * Prova que o corpo veio da Meta.
   *
   * Segredo ausente = RECUSA, nunca "passa sem verificar". Um webhook público
   * que aceita payload não verificável aceita `delivered` forjado — e, no dia em
   * que a trilha de assinatura ler esses eventos, aceitaria prova forjada.
   */
  private verifySignature(req: any): void {
    const appSecret = this.config.appSecret;
    if (!appSecret) {
      this.logger.error(
        'WHATSAPP_CLOUD_APP_SECRET ausente — webhook recusado (assinatura não pode ser verificada)',
      );
      throw new UnauthorizedException('Webhook signature verification is not configured');
    }

    const header: string | undefined = req.headers?.['x-hub-signature-256'];
    if (!header) {
      this.logger.warn('Webhook do WhatsApp sem cabeçalho x-hub-signature-256');
      throw new UnauthorizedException('Missing webhook signature');
    }

    const rawBody: Buffer | undefined = req.rawBody;
    if (!rawBody) {
      // Chegou aqui = a rota saiu da lista do middleware de corpo cru no main.ts.
      this.logger.error(
        'Corpo cru indisponível — /webhooks/whatsapp precisa estar na lista de rotas de rawBody (main.ts)',
      );
      throw new UnauthorizedException('Cannot verify webhook signature');
    }

    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const provided = header.replace(/^sha256=/i, '').trim();

    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');

    if (
      expectedBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      this.logger.warn('Assinatura do webhook do WhatsApp não confere');
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  /** Comparação de segredo em tempo constante, tolerante a tamanhos diferentes. */
  private secretsMatch(provided: string, expected: string): boolean {
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
}
