// api/src/modules/common/signature/portal-signature.controller.ts
//
// ASSINAR PELO PORTAL DO CLIENTE.
//
// Controller SEPARADO dos dois que já existem (`SignatureController`, interno, e
// `PublicSignatureController`, por token), e a separação não é arrumação: são
// TRÊS SUJEITOS diferentes, com três credenciais de formatos incompatíveis.
//
//   · o funcionário  → JWT, `request.user`,        guardado pelo `AuthGuard`
//   · o terceiro     → `accessToken` do signatário, rota `@Public()`
//   · o contato      → sessão opaca do portal, `request.responsible`,
//                      guardada pelo `ResponsibleAuthGuard`
//
// Misturá-los num controller só é como nasce o acidente que o portal inteiro
// existe para não repetir: `@UserId()` é lido em 827 pontos e escreve em 46 FKs
// NOT NULL de `User`; um contato de cliente que apareça em `request.user` vira
// UUID de contato gravado em coluna de funcionário. Aqui não há `@UserId()`, e
// não pode haver.
//
// NÃO HÁ `@UseGuards` NESTE ARQUIVO, e isso é a estrutura funcionando:
// `ResponsibleAuthGuard` é `APP_GUARD` e as duas guardas globais se dividem pelo
// MESMO metadado. `@ResponsibleOnly()` manda o `AuthGuard` ceder e esta assumir
// — marcar a rota É guardá-la.

import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { contentDisposition } from './document/document-filename';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { ResponsibleOnly } from '@modules/people/responsible-auth/responsible-auth.decorators';
import { CurrentResponsible } from '@modules/people/responsible-auth/current-responsible.decorator';
import type { ResponsiblePrincipal } from '@modules/people/responsible-auth/responsible-auth.guard';
import {
  portalRefuseSchema,
  portalSignSchema,
  type PortalRefuseFormData,
  type PortalSignFormData,
} from '@schemas/signature';
import { SignatureEnvelopeService, RequestContext } from './services/signature-envelope.service';

function ctxOf(req: Request): RequestContext {
  // x-forwarded-for pode trazer a cadeia inteira; o primeiro salto é o cliente.
  const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return {
    ipAddress: forwarded || req.ip || req.socket?.remoteAddress || null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  };
}

@Controller('cliente/me/assinaturas')
export class PortalSignatureController {
  constructor(private readonly envelopes: SignatureEnvelopeService) {}

  /**
   * `GET /cliente/me/assinaturas` — o que espera por MIM.
   *
   * Sem `@ResponsibleRoles()`: o recorte já é feito pela identidade. Só aparece
   * aqui o que tem `EnvelopeSigner.responsibleId = eu`, e quem não assina nada
   * (gestor de frota, motorista) recebe lista vazia porque a emissão nunca o
   * incluiu — não porque um decorador o barrou. Um portão de papel aqui seria
   * uma segunda régua discordando da primeira.
   */
  @Get()
  @ResponsibleOnly()
  async minhasAssinaturas(@CurrentResponsible() responsible: ResponsiblePrincipal) {
    const data = await this.envelopes.listPendingForResponsible(responsible.id);
    return {
      success: true,
      message: 'Assinaturas pendentes carregadas com sucesso',
      data,
      meta: { totalRecords: data.length, take: data.length },
    };
  }

  /**
   * `GET /cliente/me/assinaturas/:signerId/documento.pdf` — o documento DELE.
   *
   * ⛔ POR QUE ESTA ROTA EXISTE, tendo a pública do orçamento. Aquela é
   * `@Public()`, tem como capability o UUID do orçamento e serve o documento
   * COMPLETO. O signatário do portal pode ter um RECORTE — o Marketing do
   * cliente assina só a fatia de `LAYOUT` e não recebeu `PRICING` —, e servir-lhe
   * o instrumento inteiro mostraria o preço que a emissão decidiu esconder. É a
   * mesma classe de vazamento de `GET /budgets/public/:id`, e não se repete
   * aqui: o que sai é `EnvelopeSigner.documentId`, resolvido por
   * `{ id, responsibleId }`.
   *
   * ⚠️ `no-store`, como as outras três rotas de PDF assinado. Um orçamento com
   * preço, nome e CNPJ não pode ficar em cache de proxy ou de CDN — foi
   * exatamente o defeito de `GET /invoices/public/:installmentId/boleto/pdf`,
   * que é `@Public()` com `Cache-Control: public, max-age=3600` sobre um boleto
   * nominal.
   *
   * ⚠️ SEM `ETag` condicional a favor do cliente: o PDF é remontado a cada
   * pedido (os selos de quem já assinou são carimbados na hora), e o cabeçalho
   * vai como validador, não como permissão de cache. O `version` do componente
   * do web é quem força a releitura depois do ato.
   */
  @Get(':signerId/documento.pdf')
  @ResponsibleOnly()
  async documento(
    @Param('signerId', ParseUUIDPipe) signerId: string,
    @CurrentResponsible() responsible: ResponsiblePrincipal,
    @Res() res: Response,
  ) {
    const { pdf, etag, filename } = await this.envelopes.renderDocumentForResponsible(
      signerId,
      responsible.id,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('ETag', etag);
    res.setHeader('Content-Disposition', contentDisposition('inline', filename));
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }

  /**
   * `POST /cliente/me/assinaturas/:signerId/assinar` — o ato, sem código.
   *
   * O `signerId` NÃO é a credencial. Ele é o objeto do ato, e a credencial é a
   * sessão: o serviço resolve o signatário por `{ id, responsibleId }`, de modo
   * que o signatário de outra pessoa simplesmente não existe — em vez de existir
   * e ser negado, que é a diferença entre um `where` e um oráculo.
   */
  @Post(':signerId/assinar')
  @ResponsibleOnly()
  async assinar(
    @Param('signerId', ParseUUIDPipe) signerId: string,
    @Body(new ZodValidationPipe(portalSignSchema)) body: PortalSignFormData,
    @CurrentResponsible() responsible: ResponsiblePrincipal,
    @Req() req: Request,
  ) {
    const data = await this.envelopes.signByPortalSession({
      signerId,
      // O PRINCIPAL INTEIRO, e não só o id: `roles` decide a exigência do nº do
      // pedido (DD12) e `sessionId` entra na evidência como a prova de COMO esta pessoa
      // foi autenticada — é o campo que, no caminho do código, seria o
      // `challengeId`. Relê-los do banco aqui seria reler o que a guarda acabou
      // de ler, e abriria a janela em que os dois discordam.
      responsible: {
        id: responsible.id,
        sessionId: responsible.sessionId,
        name: responsible.name,
        roles: responsible.roles,
        companyId: responsible.companyId,
      },
      cpf: body.cpf,
      cargo: body.cargo,
      acceptedDeclarationKeys: body.declarations,
      clientTimestamp: body.clientTimestamp,
      geo: body.geo,
      orderNumbers: body.orderNumbers,
      ctx: ctxOf(req),
    });

    return { success: true, message: 'Orçamento assinado com sucesso', data };
  }

  /**
   * `POST /cliente/me/assinaturas/:signerId/recusar` — o "não", pelo mesmo canal.
   *
   * ⛔ ELA EXISTE PORQUE A SIMETRIA NÃO É OPCIONAL NUM INSTRUMENTO. A cerimônia
   * pública tem `POST /assinatura/publico/:token/recusar`; enquanto o portal não
   * tinha equivalente, o contato do cliente entrava e só encontrava ACEITAR — e
   * um canal que só registra o "sim" empurra o "não" para o telefone, onde ele
   * não vira evidência de nada. Ver `SignatureEnvelopeService.refuseByPortalSession`.
   *
   * Corpo `{ motivo }`, obrigatório: é ele que o comercial lê. Sem código de uso
   * único, como o ato de assinar — a credencial é a sessão, e o `signerId`
   * continua sendo o OBJETO do ato, resolvido por `{ id, responsibleId }` no
   * `where`.
   *
   * SEM `@PortalCapability(...)`, como a rota de assinar e pelo mesmo motivo: o
   * recorte já é feito pela identidade. Só recusa quem é signatário, e quem não
   * é não tem o que recusar. Um portão de papel aqui seria uma segunda régua
   * discordando da primeira — e, pior, poderia barrar de RECUSAR alguém que a
   * emissão convocou para ASSINAR.
   *
   * ⚠️ Recusar a ASSINATURA não é recusar o ORÇAMENTO
   * (`PUT /cliente/me/orcamentos/:id/recusar`, que é de quem tem `APPROVE_VALUE` e
   * age antes de existir coleta). Esta aqui é o ato dentro de uma coleta já
   * lançada.
   */
  @Post(':signerId/recusar')
  @ResponsibleOnly()
  async recusar(
    @Param('signerId', ParseUUIDPipe) signerId: string,
    @Body(new ZodValidationPipe(portalRefuseSchema)) body: PortalRefuseFormData,
    @CurrentResponsible() responsible: ResponsiblePrincipal,
    @Req() req: Request,
  ) {
    const data = await this.envelopes.refuseByPortalSession({
      signerId,
      // O PRINCIPAL, e não só o id: `sessionId` e `roles` entram na trilha como
      // a prova de COMO esta pessoa foi autenticada para recusar — é o campo
      // que, no caminho do código, seria o `challengeId`.
      responsible: {
        id: responsible.id,
        sessionId: responsible.sessionId,
        name: responsible.name,
        roles: responsible.roles,
        companyId: responsible.companyId,
      },
      reason: body.motivo,
      ctx: ctxOf(req),
    });

    return { success: true, message: 'Recusa registrada.', data };
  }
}
