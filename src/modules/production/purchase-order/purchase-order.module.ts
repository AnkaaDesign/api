// api/src/modules/production/purchase-order/purchase-order.module.ts
//
// O pedido de compra do cliente — a entidade desenhada em
// `REESTRUTURACAO_ORCAMENTO_FATURAMENTO.md` §2.12 e nunca construída.
//
// DOIS CONTROLLERS, UM SERVIÇO. O ato é o mesmo dos dois lados (achar-ou-criar o
// pedido e ligar os veículos, com escrita dupla na coluna legada); o que muda é
// quem o pratica e de onde sai o `customerId`. Duplicar o serviço por audiência
// seria garantir que um dos dois esqueceria a escrita dupla.
//
// REGISTRADO em `src/app.module.ts`, ao lado dos módulos do portal. Sem isso as
// quatro rotas existem no código e em lugar nenhum do servidor.
import { Module } from '@nestjs/common';

import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { PortalModule } from '@modules/people/portal/portal.module';

import {
  PortalPurchaseOrderController,
  PurchaseOrderController,
} from './purchase-order.controller';
import { PurchaseOrderService } from './purchase-order.service';

@Module({
  imports: [
    // `PrismaModule` é `@Global()`; fica explícito porque é o padrão dos módulos
    // irmãos de `production/` e porque um import redundante custa nada.
    PrismaModule,
    // O histórico de `Task.customerOrderNumber` continua sendo alimentado — é
    // dele que o aditivo de identificação do veículo descobre QUANDO o número
    // chegou. Ver a nota em `upsertAndLink`.
    ChangeLogModule,
    // `PortalScopeService`: a guarda de `companyId` nulo e o `where` dos três
    // caminhos. Nunca montado à mão aqui.
    PortalModule,
  ],
  controllers: [PurchaseOrderController, PortalPurchaseOrderController],
  providers: [PurchaseOrderService],
  exports: [PurchaseOrderService],
})
export class PurchaseOrderModule {}
