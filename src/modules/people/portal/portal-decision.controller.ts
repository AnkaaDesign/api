// api/src/modules/people/portal/portal-decision.controller.ts
//
// AS DUAS ROTAS DE DECISÃO DO PORTAL — `PUT /cliente/me/orcamentos/:id/…`.
//
// Controller SEPARADO de `portal-read.controller.ts` de propósito: aquele lê e
// este ESCREVE, e a diferença aparece no portão. Toda rota daqui exige
// `PORTAL_CAPABILITY.PRE_APPROVE`, que é de COMMERCIAL, SELLER, REPRESENTATIVE e
// COORDINATOR — e de mais ninguém. O Compras vê o orçamento e não decide; o
// Marketing abre requisição e não vê preço; o Motorista acompanha. Um controller
// só, com a capacidade posta rota a rota, é como uma rota nova nasce sem portão.
//
// NÃO HÁ `@UseGuards` AQUI, e isso é a estrutura funcionando. `@ResponsibleOnly()`
// na classe entrega a requisição ao `ResponsibleAuthGuard` global; o
// `@PortalCapability(...)` instala o guarda de capacidade por
// `applyDecorators(UseGuards(…))` e ainda projeta a capacidade para
// `RESPONSIBLE_ROLES_KEY`, que a guarda global já sabe cobrar. O portão vale
// mesmo que a segunda guarda seja removida.
//
// ⚠️ E NÃO HÁ `@UserId()`. O ator é `@CurrentResponsible()`.
import { Body, Controller, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { PORTAL_CAPABILITY } from './portal-capabilities';
import { PortalCapability } from './portal-roles.decorator';
import { PortalDecisionService } from './portal-decision.service';
import { CurrentResponsible } from '../responsible-auth/current-responsible.decorator';
import { ResponsibleOnly } from '../responsible-auth/responsible-auth.decorators';
import type { ResponsiblePrincipal } from '../responsible-auth/responsible-auth.guard';

/**
 * A nota da pré-aprovação é OPCIONAL; o motivo da recusa é OBRIGATÓRIO.
 *
 * A assimetria é a regra de negócio, não descuido de validação: aprovar não
 * precisa de justificativa, e devolver o orçamento ao comercial sem dizer o que
 * mudar produz exatamente o ciclo que a O.S. "Em Negociação" produzia — reabre,
 * ninguém sabe por quê, reabre de novo.
 *
 * ⚠️ `.strict()` EXPLÍCITO nos dois. Zod descarta chave desconhecida em SILÊNCIO,
 * e num corpo de duas chaves isso é o bastante para `{ motivo: '...' }` enviado
 * como `{ reason: '...' }` chegar aqui como corpo vazio e o `min(1)` acusar um
 * campo que o cliente jurou ter preenchido. Com `.strict()` a resposta nomeia a
 * chave errada.
 */
const preApproveSchema = z
  .object({
    nota: z.string().trim().max(2000).optional(),
  })
  .strict();

const refuseSchema = z
  .object({
    motivo: z
      .string({ required_error: 'Informe o motivo da recusa.' })
      .trim()
      .min(1, 'Informe o motivo da recusa.')
      .max(2000),
  })
  .strict();

@Controller('cliente/me')
@ResponsibleOnly()
export class PortalDecisionController {
  constructor(private readonly decisions: PortalDecisionService) {}

  /**
   * `PUT /cliente/me/orcamentos/:id/pre-aprovar` · corpo `{ nota? }`
   *
   * `IN_NEGOTIATION → PRE_APPROVED`. Grava `BudgetRequest.preApprovedAt`,
   * `preApprovedByResponsibleId` e `decisionNote`, apaga a recusa anterior se
   * houver, e avisa o comercial da Ankaa.
   *
   * ⚠️ `orcamentos`, no PLURAL. `/cliente/:customerId/orcamento/:id` — a página
   * pública — pontua ACIMA de `/cliente/painel/*` no React Router, e uma seção
   * do portal chamada `orcamento` nunca seria alcançada no `web`. O nome da rota
   * de API acompanha o da tela para os dois não divergirem.
   */
  @Put('orcamentos/:id/pre-aprovar')
  @PortalCapability(PORTAL_CAPABILITY.PRE_APPROVE)
  async preAprovar(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(preApproveSchema)) body: { nota?: string },
  ) {
    return this.decisions.preApprove(principal, id, body?.nota ?? null);
  }

  /**
   * `PUT /cliente/me/orcamentos/:id/recusar` · corpo `{ motivo }` (obrigatório)
   *
   * `IN_NEGOTIATION → REQUESTED`. Grava `refusedAt`, `refusedByResponsibleId` e
   * `decisionNote`, apaga a pré-aprovação anterior se houver, e manda o motivo
   * INTEIRO para o comercial.
   *
   * Recusar NÃO é cancelar: o orçamento volta para a Ankaa refazer, com o mesmo
   * número. Cancelar é `CANCELLED`, é terminal e não é ato do portal.
   */
  @Put('orcamentos/:id/recusar')
  @PortalCapability(PORTAL_CAPABILITY.PRE_APPROVE)
  async recusar(
    @CurrentResponsible() principal: ResponsiblePrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(refuseSchema)) body: { motivo: string },
  ) {
    return this.decisions.refuse(principal, id, body.motivo);
  }
}
