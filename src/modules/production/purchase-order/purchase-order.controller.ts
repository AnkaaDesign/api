// api/src/modules/production/purchase-order/purchase-order.controller.ts
//
// Dois controllers no mesmo arquivo, deliberadamente — o mesmo padrão de
// `signature.controller.ts`:
//
//   · `PurchaseOrderController`       — interno, atrás do `AuthGuard` global.
//   · `PortalPurchaseOrderController` — `/cliente/me/pedidos`, atrás do
//                                       `ResponsibleAuthGuard` global.
//
// ⛔ A AUDIÊNCIA INTERNA É ADMIN + FINANCEIRO + COMERCIAL, e é a MESMA do campo
//    `Task.customerOrderNumber` (`task.permissions.ts`, domínio `orderNumber`) e
//    a MESMA de `PATCH /budgets/:id/customer-config-order-number`. É um dado
//    comercial e fiscal, não de chão de fábrica.
//
//    O GERENTE DE PRODUÇÃO FOI REMOVIDO DESSA AUDIÊNCIA EM 17/09/2026, junto
//    com `term`. Esta rota é nova e não devolve a ninguém um campo que perdeu —
//    ela acrescenta o lado de FORA (o Compras do cliente, pelo portal). Quem
//    acrescentar `PRODUCTION_MANAGER` aqui estará desfazendo uma decisão do
//    dono por um caminho que a tela de tarefa não abre.

import { Body, Controller, Get, Post, Param, Query } from '@nestjs/common';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { SECTOR_PRIVILEGES } from '@constants/enums';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { ResponsibleOnly } from '@modules/people/responsible-auth/responsible-auth.decorators';
import { CurrentResponsible } from '@modules/people/responsible-auth/current-responsible.decorator';
import type { ResponsiblePrincipal } from '@modules/people/responsible-auth/responsible-auth.guard';
import { PortalCapability } from '@modules/people/portal/portal-roles.decorator';
import { PORTAL_CAPABILITY } from '@modules/people/portal/portal-capabilities';
import {
  portalPurchaseOrderCreateSchema,
  purchaseOrderCreateSchema,
  purchaseOrderListQuerySchema,
  type PortalPurchaseOrderCreateFormData,
  type PurchaseOrderCreateFormData,
  type PurchaseOrderListQuery,
} from '@schemas/purchase-order';
import { PurchaseOrderService } from './purchase-order.service';

function envelope(rows: unknown[], totalRecords: number, take: number, message: string) {
  return { success: true, message, data: rows, meta: { totalRecords, take } };
}

// =============================================================================
// INTERNO
// =============================================================================

@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly service: PurchaseOrderService) {}

  /**
   * Os pedidos de um cliente.
   *
   * `customerId` é de ROTA e não de query justamente para que não possa ser
   * omitido: no Prisma, um filtro `undefined` não é "nenhum" — é "sem filtro", e
   * a rota devolveria os pedidos de compra de todo o acervo.
   */
  @Get('customer/:customerId')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async listByCustomer(
    @Param('customerId') customerId: string,
    @Query(new ZodValidationPipe(purchaseOrderListQuerySchema)) query: PurchaseOrderListQuery,
  ) {
    const { rows, totalRecords, take } = await this.service.listForCustomer(customerId, query);
    return envelope(rows, totalRecords, take, 'Pedidos de compra carregados com sucesso');
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async create(
    @Body(new ZodValidationPipe(purchaseOrderCreateSchema)) body: PurchaseOrderCreateFormData,
    @UserId() userId: string,
  ) {
    const data = await this.service.createInternal(body, userId);
    return { success: true, message: 'Pedido de compra registrado com sucesso', data };
  }
}

// =============================================================================
// PORTAL DO CLIENTE
// =============================================================================

/**
 * `/cliente/me/pedidos`.
 *
 * NENHUM `@UseGuards` e NENHUM `@UserId()` neste bloco, e as duas ausências são
 * estruturais:
 *
 *   · `ResponsibleAuthGuard` é `APP_GUARD`; `@ResponsibleOnly()` manda o
 *     `AuthGuard` do funcionário ceder e ela assumir. Marcar a rota É guardá-la.
 *   · `@UserId()` lê `request.user` — 827 pontos, 46 FKs NOT NULL de `User`. Um
 *     contato de cliente ali vira UUID de contato gravado em coluna de
 *     funcionário. O principal do portal mora em `request.responsible` e se lê
 *     com `@CurrentResponsible()`.
 */
@Controller('cliente/me/pedidos')
export class PortalPurchaseOrderController {
  constructor(private readonly service: PurchaseOrderService) {}

  /**
   * LEITURA SEM CAPACIDADE, de propósito.
   *
   * Ver o próprio pedido de compra não é o ato que `WRITE_PURCHASE_ORDER`
   * governa — o nome da capacidade diz `WRITE`. Quem vê os veículos vê o número
   * do pedido deles na tela de veículo; esconder a LISTA de quem não pode
   * escrever criaria um recorte que nenhuma outra tela do portal respeita.
   */
  @Get()
  @ResponsibleOnly()
  async list(
    @CurrentResponsible() responsible: ResponsiblePrincipal,
    @Query(new ZodValidationPipe(purchaseOrderListQuerySchema)) query: PurchaseOrderListQuery,
  ) {
    const { rows, totalRecords, take } = await this.service.listForPortal(responsible, query);
    return envelope(rows, totalRecords, take, 'Pedidos de compra carregados com sucesso');
  }

  /**
   * `POST /cliente/me/pedidos` — o Compras informa o número.
   *
   * `WRITE_PURCHASE_ORDER` é de `PURCHASING` e de `FINANCIAL` (contrato §2.1).
   * O decorador instala a guarda de capacidade E projeta a capacidade para o
   * conjunto de papéis que a exerce, de modo que a guarda global já barra por
   * papel mesmo que tudo o mais da linha seja removido.
   *
   * ⚠️ O corpo NÃO tem `customerId`: o dono do pedido é
   * `responsible.companyId`, resolvido no servidor. Ver a nota no schema.
   */
  @Post()
  @ResponsibleOnly()
  @PortalCapability(PORTAL_CAPABILITY.WRITE_PURCHASE_ORDER)
  async create(
    @CurrentResponsible() responsible: ResponsiblePrincipal,
    @Body(new ZodValidationPipe(portalPurchaseOrderCreateSchema))
    body: PortalPurchaseOrderCreateFormData,
  ) {
    const data = await this.service.createFromPortal(responsible, body);
    return { success: true, message: 'Pedido de compra registrado com sucesso', data };
  }
}
