/**
 * Rotas da assinatura do orçamento.
 *
 * Dois controllers no mesmo arquivo, deliberadamente:
 *  · `SignatureController`   — interno, atrás do AuthGuard global.
 *  · `PublicSignatureController` — `@Public()`, autenticado pelo TOKEN do
 *    signatário (256 bits, opaco, uso pessoal).
 *
 * O token do signatário substitui o padrão do resto do sistema, onde o UUID da
 * entidade é a própria capability (`GET /task-quotes/public/:id` documenta isso
 * explicitamente). Aqui o token é por-signatário, expira junto com o prazo do
 * orçamento e é revogável — um link vazado atinge um signatário, não o orçamento
 * inteiro, e some quando o envelope é invalidado.
 */

import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Query,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { SECTOR_PRIVILEGES } from '@constants/enums';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import {
  signatureRefuseSchema,
  signatureRequestCodeSchema,
  signatureSignSchema,
  type SignatureRefuseFormData,
  type SignatureRequestCodeFormData,
  type SignatureSignFormData,
} from '@schemas/signature';
import { SignatureEnvelopeService, RequestContext } from './services/signature-envelope.service';
import { SignatureAuditService } from './services/signature-audit.service';
import { DossierAssemblerService } from './dossier/dossier-assembler.service';

function ctxOf(req: Request): RequestContext {
  // x-forwarded-for pode trazer a cadeia inteira; o primeiro salto é o cliente.
  const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return {
    ipAddress: forwarded || req.ip || req.socket?.remoteAddress || null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  };
}

// =============================================================================
// INTERNO
// =============================================================================

@Controller('signature-envelopes')
export class SignatureController {
  constructor(
    private readonly envelopes: SignatureEnvelopeService,
    private readonly audit: SignatureAuditService,
    private readonly dossiers: DossierAssemblerService,
  ) {}

  /** Congela o documento e dispara os convites. */
  @Post('quote/:quoteId')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  async create(
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @UserId() userId: string,
    @Req() req: Request,
  ) {
    const result = await this.envelopes.createEnvelope({
      quoteId,
      actorUserId: userId,
      ctx: ctxOf(req),
    });
    return {
      success: true,
      message: 'Orçamento enviado para assinatura.',
      data: result,
    };
  }

  @Get('quote/:quoteId')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  async listForQuote(@Param('quoteId', ParseUUIDPipe) quoteId: string) {
    const data = await this.envelopes.listForQuote(quoteId);
    return { success: true, data };
  }

  @Get(':id/audit-trail')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  async auditTrail(@Param('id', ParseUUIDPipe) id: string) {
    const [events, chain] = await Promise.all([
      this.audit.getTrail(id),
      this.audit.verifyChain(id),
    ]);
    return { success: true, data: { events, chain } };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
    @Req() req: Request,
  ) {
    await this.envelopes.cancel(id, userId, ctxOf(req));
    return { success: true, message: 'Coleta de assinaturas cancelada.' };
  }

  /**
   * Reprocessa a emissão do documento final.
   *
   * Existe para o envelope cujo `finalize()` falhou (bytes congelados sumidos do
   * disco, erro do pdf-lib, processo derrubado no meio da selagem): todos
   * assinaram, mas não há artefato. Sem esta rota não havia NENHUMA forma de
   * reexecutar a montagem — `finalize()` era chamado de um único ponto, dentro
   * da assinatura do último signatário.
   */
  @Post(':id/retry-finalize')
  @HttpCode(200)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  async retryFinalize(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    const data = await this.envelopes.retryFinalize(id, userId);
    return {
      success: true,
      message: `Documento final emitido${data.padesLevel ? ` (selo ${data.padesLevel})` : ''}.`,
      data,
    };
  }

  @Post('signers/:signerId/resend')
  @HttpCode(200)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  async resend(
    @Param('signerId', ParseUUIDPipe) signerId: string,
    @UserId() userId: string,
    @Req() req: Request,
  ) {
    const ok = await this.envelopes.resendInvitation(signerId, userId, ctxOf(req));
    return {
      success: ok,
      message: ok
        ? 'Convite reenviado por e-mail.'
        : 'Não foi possível enviar o e-mail. Copie o link e envie manualmente.',
    };
  }

  /**
   * PDF do envelope para uso interno.
   *
   * Rota dedicada em vez de `/files/serve/:id`: aquele endpoint é `@Public()`,
   * com `Access-Control-Allow-Origin: *` e sem qualquer noção de dono, e o
   * orçamento contém preço.
   */
  @Get(':id/document.pdf')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  async document(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { pdf, etag } = await this.envelopes.renderServedDocument(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }

  /**
   * Dossiê: orçamento assinado + notas fiscais + boletos.
   *
   * Rota interna: é a Ankaa que monta e envia. O artefato reúne preço, dados do
   * cliente e títulos de cobrança — nada disso pode viver atrás de uma URL
   * adivinhável.
   */
  @Get('quote/:quoteId/dossie.pdf')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.FINANCIAL)
  async dossier(
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Query('anexo') anexo: string | undefined,
    @Query('trilha') trilha: string | undefined,
    @Res() res: Response,
  ) {
    // `?anexo=0` gera o dossiê SEM o PDF assinado embutido. Vale quando não se
    // quer que a trilha de auditoria viaje junto — o preço é o dossiê ficar sem
    // nenhuma assinatura digital (ver `build()`).
    // `?trilha=0` omite as páginas de trilha das cópias legíveis. O anexo
    // continua com ela: é um artefato assinado, e tirar um byte quebra o A1.
    const result = await this.dossiers.build(quoteId, {
      attachSigned: anexo !== '0',
      dropAuditTrail: trilha === '0',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    // O que ficou de fora vai no cabeçalho para o cliente HTTP poder avisar sem
    // precisar abrir o PDF — a capa também diz, mas ninguém lê capa de PDF.
    const faltando = result.components.filter(c => !c.included).length;
    if (faltando) res.setHeader('X-Dossie-Incompleto', String(faltando));
    res.send(result.pdf);
  }
}

// =============================================================================
// PÚBLICO (autenticado pelo token do signatário)
// =============================================================================

/**
 * VALIDAÇÃO DO CORPO — por que `ZodValidationPipe` sozinho, sem `ArrayFixPipe`.
 *
 * Estas rotas são JSON puro (`application/json`), nunca `multipart/form-data`.
 * O `ArrayFixPipe` existe para desfazer o que o FormData faz com tipos que ele
 * não tem — `null` virando `"null"`, arrays virando `{0:…,1:…}`, o sentinela
 * `campo_empty=true`. Aplicá-lo aqui só adicionaria conversões implícitas sobre
 * um corpo que já chega tipado, e conversão implícita antes do Zod foi
 * exatamente a origem do "400 Invalid date" da aerografia. O `ZodValidationPipe`
 * já roda o seu próprio `fixArrays` internamente para `metadata.type === 'body'`,
 * então nada se perde.
 *
 * O que se ganha: nenhum efeito colateral da cerimônia — emissão de código,
 * consumo de OTP, evento na trilha append-only — acontece antes de o corpo ser
 * validado.
 */
@Controller('assinatura')
export class PublicSignatureController {
  constructor(
    private readonly envelopes: SignatureEnvelopeService,
    private readonly dossiers: DossierAssemblerService,
  ) {}

  // ATENÇÃO À ORDEM: estas rotas precisam vir ANTES de `publico/:token`.
  // O Express casa na ordem de declaração, então `publico/orcamento/<uuid>`
  // seria capturado por `publico/:token` com token="orcamento" e a rota abaixo
  // nunca seria alcançada — o mesmo defeito que deixou `GET /changelogs/date-range`
  // morto por estar declarado depois de `GET /changelogs/:id`.
  /**
   * Resumo da coleta para a página pública do orçamento.
   *
   * Mesma capability da página que o consome (o UUID do orçamento), por isso não
   * exige token de signatário.
   */
  @Get('publico/orcamento/:quoteId')
  @Public()
  @Header('Cache-Control', 'no-store')
  async quoteSummary(@Param('quoteId', ParseUUIDPipe) quoteId: string) {
    const data = await this.envelopes.getPublicQuoteSummary(quoteId);
    return { success: true, data };
  }

  @Get('publico/:token')
  @Public()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  async state(@Param('token') token: string, @Req() req: Request) {
    const data = await this.envelopes.getPublicState(token, ctxOf(req));
    return { success: true, data };
  }

  @Get('publico/:token/document.pdf')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async document(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const signer = await this.envelopes.getByToken(token);
    const { pdf, etag } = await this.envelopes.renderServedDocument(signer.envelopeId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }

  /** Etapa 1 — identificação e emissão do código. */
  @Post('publico/:token/codigo')
  @HttpCode(200)
  @Public()
  // O serviço já limita reenvio (60s) e emissões/hora POR SIGNATÁRIO, mas nada
  // limitava por ORIGEM: um atacante com um token válido podia martelar o
  // endpoint. Também protege o custo de envio.
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async requestCode(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(signatureRequestCodeSchema)) body: SignatureRequestCodeFormData,
    @Req() req: Request,
  ) {
    const data = await this.envelopes.requestOtp({
      token,
      cpf: body.cpf,
      cargo: body.cargo,
      emailConfirm: body.emailConfirm,
      ctx: ctxOf(req),
    });
    return { success: true, data };
  }

  /** Etapa 2 — validação do código e aplicação da assinatura. */
  @Post('publico/:token/assinar')
  @HttpCode(200)
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async sign(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(signatureSignSchema)) body: SignatureSignFormData,
    @Req() req: Request,
  ) {
    const data = await this.envelopes.signWithOtp({
      token,
      challengeId: body.challengeId,
      code: body.code,
      acceptedDeclarationKeys: body.declarations,
      clientTimestamp: body.clientTimestamp,
      geo: body.geo,
      ctx: ctxOf(req),
    });
    return { success: true, message: 'Orçamento assinado com sucesso.', data };
  }

  /**
   * Recusa — exige o MESMO desafio OTP verificado que a assinatura exige.
   *
   * A recusa leva o envelope a estado terminal; sem OTP, quem recebesse o link
   * encaminhado matava o negócio anonimamente. Mesmo limite de origem da
   * assinatura, pelo mesmo motivo (o endpoint agora consome tentativas de OTP).
   */
  @Post('publico/:token/recusar')
  @HttpCode(200)
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async refuse(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(signatureRefuseSchema)) body: SignatureRefuseFormData,
    @Req() req: Request,
  ) {
    await this.envelopes.refuse({
      token,
      challengeId: body.challengeId,
      code: body.code,
      reason: body.reason,
      ctx: ctxOf(req),
    });
    return { success: true, message: 'Recusa registrada.' };
  }


  /**
   * Dossiê para o cliente: orçamento assinado + fotos + notas + boletos.
   *
   * MESMA capability do orçamento público (o UUID do quote) — quem tem o link do
   * orçamento já vê preço, cliente e serviços. O dossiê acrescenta boleto e nota,
   * que são documentos do próprio cliente. SEM o anexo assinado: ele carrega a
   * trilha de auditoria por construção, e ela não é peça de comunicação
   * comercial. O artefato completo continua no servidor, para disputa.
   */
  @Get('publico/orcamento/:quoteId/dossie.pdf')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async publicDossier(@Param('quoteId', ParseUUIDPipe) quoteId: string, @Res() res: Response) {
    const result = await this.dossiers.build(quoteId, { attachSigned: false });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.pdf);
  }

  @Get('publico/orcamento/:quoteId/documento.pdf')
  @Public()
  // Cada requisição re-estampa o PDF em processo (~65ms / 730KB). Sem limite,
  // é um vetor de exaustão de CPU trivial.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async quoteDocument(@Param('quoteId', ParseUUIDPipe) quoteId: string, @Res() res: Response) {
    const { pdf, etag } = await this.envelopes.renderPublicQuoteDocument(quoteId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }

  /**
   * Portal público de verificação.
   *
   * Devolve apenas metadados, hashes e o roster de signatários com CPF
   * MASCARADO. O corpo do documento NÃO é servido aqui: o orçamento contém
   * preço comercial e o código de verificação é impresso em todas as páginas do
   * PDF, que circula por e-mail.
   */
  @Get('verificar/:code')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('X-Robots-Tag', 'noindex, nofollow')
  async verify(@Param('code') code: string, @Req() req: Request) {
    const data = await this.envelopes.getVerificationByCode(code, ctxOf(req));
    return { success: true, data };
  }
}
