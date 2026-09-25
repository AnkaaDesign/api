// api/src/modules/people/portal/portal-identity.module.ts
//
// A IDENTIFICAÇÃO DO VEÍCULO pelo portal — `PATCH /cliente/me/veiculos/:taskId/
// identificacao` — e o PROJETO DO IMPLEMENTO, `POST /cliente/me/veiculos/:taskId/
// projeto` (P13a), que usa as mesmas dependências (escopo comercial, arquivo na
// mesma transação, trilha com `userId: null`).
//
// Módulo PRÓPRIO, e não um controlador dentro de `PortalModule`, pela razão que
// aquele arquivo declara no cabeçalho: `PortalModule` é a FUNDAÇÃO (escopo e
// projeção), sem Prisma e sem controlador, e é isso que permite testá-lo sem
// banco (`test:portal-escopo`, `test:portal-recorte`). Pendurar aqui um
// controlador que escreve tarefa, implemento, arquivo e pedido de compra
// arrastaria `FileModule` e `PurchaseOrderModule` para dentro da fundação — e
// todo pacote que só quisesse o `where` do escopo passaria a carregar o motor de
// arquivo junto.
//
// O que este módulo NÃO tem, e por quê:
//
//  · NENHUM `@UseGuards` e nenhum `APP_GUARD`. `ResponsibleAuthGuard` já é
//    global e `@ResponsibleOnly()` é o que entrega a rota a ela;
//    `PortalCapabilityGuard` é instalado pelo próprio `@PortalCapability(...)`,
//    que só depende do `Reflector` do núcleo do Nest.
//
//  · NENHUM `TaskModule`. A escrita NÃO passa por `TaskService.update`: aquele
//    caminho valida por `taskUpdateSchema`, que não é `.strict()` — `plate` no
//    topo some em silêncio (contrato §5, armadilha 4) — e faria o ator ser um
//    `User`, que no portal não existe. As colunas moram em `Implement`, e é lá que
//    se escreve.
//
//  · NENHUM `SignatureModule`. A guarda do documento assinado LÊ o snapshot
//    congelado (uma consulta) e decide por função PURA
//    (`portal-vehicle-identity.ts`). Importar o motor de assinatura traria
//    junto o gancho de INVALIDAÇÃO, e a tentação de chamá-lo — ver a nota longa
//    no cabeçalho do serviço sobre por que esta rota não o chama.
//
// ⚠️ REGISTRADO em `src/app.module.ts`, ao lado dos demais módulos do portal.
// O registro não é opcional nem detectável pelo compilador: sem a linha, o
// `tsc` compila estes arquivos do mesmo jeito, `pnpm build` passa, e a ausência
// só aparece como 404 — que é exatamente o estado em que esta rota estava.
// `test:portal-cliente:boot` fixa a rota na tabela do roteador por isso.
import { Module } from '@nestjs/common';

import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FileModule } from '@modules/common/file/file.module';
import { PurchaseOrderModule } from '@modules/production/purchase-order/purchase-order.module';

import { PortalModule } from './portal.module';
import { PortalReadModule } from './portal-read.module';
import { PortalIdentityController } from './portal-identity.controller';
import { PortalIdentityService } from './portal-identity.service';

@Module({
  imports: [
    // `PrismaModule` é `@Global()`; fica explícito porque é o padrão dos módulos
    // irmãos e porque um import redundante custa nada.
    PrismaModule,
    // `PortalScopeService` — a guarda de `companyId` nulo e o corte COMERCIAL
    // (a)+(b), sem o caminho pessoal (c). Nunca montado à mão.
    PortalModule,
    // `PortalReadService.getVehicle` — a resposta do `PATCH` é a MESMA do
    // `GET`, com o recorte por seção aplicado. Montar o retorno à mão aqui
    // seria a única resposta do portal sem recorte.
    PortalReadModule,
    // `ChangeLogService` — a auditoria, sempre com `userId: null` e a autoria do
    // contato em `metadata` (id de responsável não existe em `User`).
    ChangeLogModule,
    // `FileService.createFromUploadWithTransaction` — a foto da plaqueta e o
    // projeto do implemento, que têm de nascer no MESMO commit do implemento a
    // que se ligam.
    FileModule,
    // `PurchaseOrderService` — a ESCRITA DUPLA do número do pedido
    // (`Task.purchaseOrderId` + `customerOrderNumber`). Escrever a coluna
    // legada à mão aqui seria o quinto caminho de escrita a divergir dele, e a
    // NFS-e e o boleto leem justamente a coluna legada.
    PurchaseOrderModule,
  ],
  controllers: [PortalIdentityController],
  providers: [PortalIdentityService],
  exports: [PortalIdentityService],
})
export class PortalIdentityModule {}
