// api/src/modules/people/portal/portal-catalog.module.ts
//
// OS CATÁLOGOS do assistente de requisição — `/cliente/me/{clientes,tintas,
// tipos-de-tinta}` e o `POST /cliente/me/tintas`.
//
// Módulo PRÓPRIO, e não controladores dentro de `PortalModule`, pela razão que
// aquele arquivo declara: `PortalModule` é a FUNDAÇÃO (escopo e projeção), sem
// Prisma e sem controlador, e é isso que permite testá-lo sem banco. Este
// pacote lê o banco e arrasta `PaintModule`.
//
// Note o que NÃO está aqui:
//
//  · NENHUM `PrismaModule`. Ele é `@Global()`; reimportá-lo só sugeriria a
//    existência de um segundo `PrismaService`.
//
//  · NENHUM `@UseGuards`/`APP_GUARD`. `ResponsibleAuthGuard` já é global e
//    `@ResponsibleOnly()` é o que entrega a rota a ela; `PortalCapabilityGuard`
//    é instalado pelo próprio `@PortalCapability(...)`.
import { Module } from '@nestjs/common';
import { PaintModule } from '@modules/paint/paint.module';
import { PortalModule } from './portal.module';
import { PortalCatalogController } from './portal-catalog.controller';
import { PortalCatalogService } from './portal-catalog.service';

@Module({
  imports: [
    // `PortalScopeService` — o escopo dos CLIENTES.
    PortalModule,
    // `PaintService.create` — a tinta nova, com a validação de duplicidade e de
    // tipo que um `prisma.paint.create` à mão pularia.
    PaintModule,
  ],
  controllers: [PortalCatalogController],
  providers: [PortalCatalogService],
  exports: [PortalCatalogService],
})
export class PortalCatalogModule {}
