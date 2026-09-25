// api/src/modules/people/portal/portal-artwork.controller.ts
//
// AS ROTAS DE ARTE DO PORTAL — o cliente aprova a arte do implemento (P13b;
// PLANO §5.1, §7.1).
//
//   GET /cliente/me/artes?status=PENDING_APPROVAL      seção LAYOUT
//   PUT /cliente/me/veiculos/:taskId/artes/:layoutId/aprovar            APPROVE_ARTWORK
//   PUT /cliente/me/veiculos/:taskId/artes/:layoutId/reprovar {motivo}  APPROVE_ARTWORK
//   PUT /cliente/me/artes/aprovar { layoutIds[] }     (lote)            APPROVE_ARTWORK
//
// Controller SEPARADO de `portal-read.controller.ts` pelo mesmo motivo de
// `portal-decision.controller.ts`: este ESCREVE, e a escrita tem portão de
// CAPACIDADE rota a rota. A lista mora aqui também porque é a lista DESTE ato —
// e porque o portão dela é de SEÇÃO, conferido no serviço, junto do recorte.
//
// NÃO HÁ `@UseGuards` AQUI, e isso é a estrutura funcionando: `@ResponsibleOnly()`
// na classe entrega a requisição à guarda global do portal, e
// `@PortalCapability(...)` instala a guarda de capacidade e projeta a
// capacidade para papéis (ver `portal-roles.decorator.ts`). ⚠️ E NÃO HÁ
// `@UserId()`: o ator é `@CurrentResponsible()`.
//
// ⚠️ `taskId` NA URL, e não só `layoutId`: a arte é do IMPLEMENTO, mas o portal
// endereça o veículo pela tarefa (D-01), e é o `taskId` que a tela tem na mão. O
// serviço confere os dois no MESMO `where` — arte certa sob o veículo errado é
// 404.
import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import {
  portalArtworkBatchApproveSchema,
  portalArtworkListQuerySchema,
  portalArtworkReproveSchema,
  type PortalArtworkBatchApproveBody,
  type PortalArtworkListQuery,
  type PortalArtworkReproveBody,
} from '../../../schemas/portal-artwork';
import { PORTAL_CAPABILITY } from './portal-capabilities';
import { PortalCapability } from './portal-roles.decorator';
import { PortalArtworkService } from './portal-artwork.service';
import { CurrentResponsible } from '../responsible-auth/current-responsible.decorator';
import { ResponsibleOnly } from '../responsible-auth/responsible-auth.decorators';
import type { ResponsiblePrincipal } from '../responsible-auth/responsible-auth.guard';

@Controller('cliente/me')
@ResponsibleOnly()
export class PortalArtworkController {
  constructor(private readonly artworks: PortalArtworkService) {}

  /**
   * `GET /cliente/me/artes?status=PENDING_APPROVAL&page=1&take=20`
   *
   * As artes dos veículos que este contato vê, com `canDecide` em cada uma.
   * `status` ausente = os três estados que o cliente vê.
   */
  @Get('artes')
  async list(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Query(new ZodValidationPipe(portalArtworkListQuerySchema)) query: PortalArtworkListQuery,
  ) {
    return this.artworks.list(principal, query ?? {});
  }

  /**
   * `PUT /cliente/me/artes/aprovar` · `{ layoutIds: [...] }` — o lote "Aprovar
   * para os N veículos". Declarada ANTES das rotas com parâmetro por clareza; o
   * Nest casa pelo caminho inteiro e as duas formas não colidem.
   */
  @Put('artes/aprovar')
  @PortalCapability(PORTAL_CAPABILITY.APPROVE_ARTWORK)
  async approveMany(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Body(new ZodValidationPipe(portalArtworkBatchApproveSchema))
    body: PortalArtworkBatchApproveBody,
  ) {
    return this.artworks.approveMany(principal, body.layoutIds);
  }

  /** `PUT /cliente/me/veiculos/:taskId/artes/:layoutId/aprovar` — sem corpo. */
  @Put('veiculos/:taskId/artes/:layoutId/aprovar')
  @PortalCapability(PORTAL_CAPABILITY.APPROVE_ARTWORK)
  async approve(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Param('layoutId', new ParseUUIDPipe()) layoutId: string,
  ) {
    return this.artworks.approve(principal, taskId, layoutId);
  }

  /**
   * `PUT /cliente/me/veiculos/:taskId/artes/:layoutId/reprovar` · `{ motivo }`
   *
   * O motivo é OBRIGATÓRIO (≥ 3 caracteres; 400 sem ele): reprovar sem dizer o
   * que mudar é o ciclo que a nota existe para quebrar — a Ankaa refaz no
   * escuro e o cliente reprova de novo.
   */
  @Put('veiculos/:taskId/artes/:layoutId/reprovar')
  @PortalCapability(PORTAL_CAPABILITY.APPROVE_ARTWORK)
  async reprove(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Param('layoutId', new ParseUUIDPipe()) layoutId: string,
    @Body(new ZodValidationPipe(portalArtworkReproveSchema)) body: PortalArtworkReproveBody,
  ) {
    return this.artworks.reprove(principal, taskId, layoutId, body.motivo);
  }
}
