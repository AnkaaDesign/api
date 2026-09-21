// api/src/modules/people/portal/portal-catalog.controller.ts
//
// OS CATÁLOGOS DO ASSISTENTE — `/cliente/me/{clientes,tintas,tipos-de-tinta}`.
//
// As três leituras que o contrato §4 não previu e sem as quais o assistente de
// requisição não tem o que oferecer nos comboboxes, mais a ESCRITA de tinta —
// o "criar uma cor se não tiver salvo" que o dono pediu e que hoje é um 403,
// porque `POST /paints` é `@Roles(WAREHOUSE, ADMIN, COMMERCIAL, FINANCIAL)`,
// privilégio de FUNCIONÁRIO.
//
// NÃO HÁ `@UseGuards` NESTE ARQUIVO, e isso é a estrutura funcionando.
// `@ResponsibleOnly()` na classe entrega a requisição ao `ResponsibleAuthGuard`
// global; `@PortalCapability(...)` instala a própria guarda e projeta a
// capacidade em `RESPONSIBLE_ROLES_KEY`, que a guarda global já cobra.
//
// ⚠️ E NÃO HÁ `@UserId()`. O ator é `@CurrentResponsible()`.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE AS QUATRO PEDEM `REQUEST_BUDGET`, INCLUSIVE AS DE LEITURA
// ─────────────────────────────────────────────────────────────────────────────
// Estes catálogos existem para UM ato: abrir a requisição. Quem não pode abrir
// requisição não tem o assistente na tela e não tem o que fazer com uma lista de
// clientes ou de cores. Pela tabela §2.1 isso é Comercial, Vendedor,
// Representante, Coordenador e Marketing — e deixa de fora Compras, Financeiro,
// Gestor de Frota e Motorista, que é quem menos tem por que receber o cadastro
// de terceiros.
//
// ⛔ NÃO acrescente `@ResponsibleRoles(...)` aqui: os dois decoradores gravam a
// MESMA chave de metadado no MESMO alvo, e `SetMetadata` sobrescreve.

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { portalNovaTintaSchema, type PortalNovaTintaFormData } from '@/schemas/portal-request';
import { CurrentResponsible } from '../responsible-auth/current-responsible.decorator';
import { ResponsibleOnly } from '../responsible-auth/responsible-auth.decorators';
import type { ResponsiblePrincipal } from '../responsible-auth/responsible-auth.guard';
import { PORTAL_CAPABILITY } from './portal-capabilities';
import { PortalCapability } from './portal-roles.decorator';
import { PortalCatalogService, type PortalCatalogQuery } from './portal-catalog.service';

/**
 * A paginação e a busca da borda.
 *
 * ⚠️ Os NOMES são contrato: zod descarta chave desconhecida em SILÊNCIO, e um
 * `?q=` no lugar de `?searchingFor=` chegaria aqui como "sem busca" e devolveria
 * a primeira página inteira parecendo estar funcionando. São os mesmos nomes de
 * `portal-read.controller.ts` e os mesmos que `solicitacao-api.ts` envia.
 */
const portalCatalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
  searchingFor: z.string().trim().min(1).max(200).optional(),
});

@Controller('cliente/me')
@ResponsibleOnly()
export class PortalCatalogController {
  constructor(private readonly catalog: PortalCatalogService) {}

  /**
   * `GET /cliente/me/clientes` — os clientes que este contato pode apontar.
   *
   * ESCOPADO: a própria empresa, quem é dono de um veículo que eu vejo e quem
   * paga um orçamento que eu vejo. Nunca o cadastro inteiro da Ankaa.
   */
  @Get('clientes')
  @PortalCapability(PORTAL_CAPABILITY.REQUEST_BUDGET)
  async clientes(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Query(new ZodValidationPipe(portalCatalogQuerySchema)) query: PortalCatalogQuery,
  ) {
    return this.catalog.listCustomers(principal, query ?? {});
  }

  /**
   * `GET /cliente/me/tintas` — o catálogo de cores.
   *
   * SEM escopo: `Paint` não tem dono, e a mesma cor atende clientes diferentes.
   * O que há é allowlist de colunas — a FÓRMULA não sai daqui.
   */
  @Get('tintas')
  @PortalCapability(PORTAL_CAPABILITY.REQUEST_BUDGET)
  async tintas(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Query(new ZodValidationPipe(portalCatalogQuerySchema)) query: PortalCatalogQuery,
  ) {
    return this.catalog.listPaints(principal, query ?? {});
  }

  /** `GET /cliente/me/tipos-de-tinta` — o `paintTypeId` do "cadastrar cor". */
  @Get('tipos-de-tinta')
  @PortalCapability(PORTAL_CAPABILITY.REQUEST_BUDGET)
  async tiposDeTinta(@CurrentResponsible() principal: ResponsiblePrincipal) {
    return this.catalog.listPaintTypes(principal);
  }

  /**
   * `POST /cliente/me/tintas` — cadastrar a cor que o cliente não achou.
   *
   * CORPO — `{ name, hex, finish, paintTypeId }`, o mínimo de `paintCreateSchema`
   * e nada além dele. É o MESMO `portalNovaTintaSchema` que a requisição usa em
   * `novaTinta`: uma segunda cópia do regex de cor ou da lista de acabamentos
   * seria a terceira fonte de verdade da mesma regra.
   */
  @Post('tintas')
  @PortalCapability(PORTAL_CAPABILITY.REQUEST_BUDGET)
  @HttpCode(HttpStatus.CREATED)
  async criarTinta(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Body(new ZodValidationPipe(portalNovaTintaSchema)) body: PortalNovaTintaFormData,
  ) {
    return this.catalog.createPaint(principal, body);
  }
}
