// api/src/modules/people/portal/portal-read.module.ts
//
// AS ROTAS DE LEITURA do portal do cliente — `/cliente/me/*`.
//
// Módulo PRÓPRIO, e não `controllers: [...]` dentro de `PortalModule`, porque
// `PortalModule` é a FUNDAÇÃO (escopo + projeção) e declara, no próprio
// cabeçalho, que "nenhum controlador mora aqui — as rotas `/cliente/me/*` são de
// outros pacotes, que importam este módulo". Este é um desses pacotes.
//
// Note o que NÃO está aqui:
//
//  · NENHUM `APP_GUARD` e nenhum `@UseGuards`. `ResponsibleAuthGuard` já é
//    global (`responsible-auth.module.ts`) e `@ResponsibleOnly()` na classe do
//    controlador é o que o entrega a ela. Marcar a rota É guardá-la.
//
//  · NENHUM `PrismaModule` nos `imports`. Ele é `@Global()`
//    (`common/prisma/prisma.module.ts`), e reimportá-lo aqui não acrescenta
//    nada — só sugeriria que existe um segundo `PrismaService`.
//
//  · NENHUM `ResponsibleAuthModule`. Este pacote não chama
//    `ResponsibleAuthService`: o principal chega pronto em `request.responsible`,
//    escrito pela guarda global, e é lido por `@CurrentResponsible()`.
//
// ⚠️ E ELE CARREGA `PortalArtworkModule` (P13b): as rotas de arte
// (`/cliente/me/artes`, `…/veiculos/:taskId/artes/:layoutId/aprovar|reprovar`)
// entram no grafo por aqui, porque `src/app.module.ts` não é do P13b neste par.
// O controlador e o serviço continuam no módulo DELES — é a máquina da arte que
// eles arrastam, e ela não pode morar num módulo de leitura. Ver o cabeçalho de
// `portal-artwork.module.ts`.
import { Module } from '@nestjs/common';
import { PortalModule } from './portal.module';
import { PortalArtworkModule } from './portal-artwork.module';
import { PortalReadController } from './portal-read.controller';
import { PortalReadService } from './portal-read.service';

@Module({
  imports: [PortalModule, PortalArtworkModule],
  controllers: [PortalReadController],
  providers: [PortalReadService],
  exports: [PortalReadService],
})
export class PortalReadModule {}
