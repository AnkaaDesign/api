// api/src/modules/people/portal/portal-artwork.module.ts
//
// A APROVAÇÃO DA ARTE PELO PORTAL — P13b.
//
// Módulo PRÓPRIO, pelo mesmo motivo de `PortalDecisionModule`: `PortalModule` é a
// FUNDAÇÃO pura (escopo e projeção, sem Prisma e sem controlador). Este arrasta
// o `ImplementModule` — e com ele a máquina da arte, as O.S. e o motor de
// assinatura —, e nada disso pode entrar na fundação.
//
// ⚠️ REGISTRO: este módulo entra no grafo por `PortalReadModule` (que o importa),
// e não por uma linha em `src/app.module.ts`. O `app.module.ts` não é do P13b
// neste par (é do checkout principal, P14); `PortalReadModule` é, e já está no
// `AppModule`. O Nest registra os controladores de todo módulo alcançável, então
// as quatro rotas existem do mesmo jeito — e `test:portal-cliente:boot` prova que
// existem. O integrador pode mover a linha para o `AppModule`, ao lado de
// `PortalDecisionModule`, sem mudar comportamento.
import { Module } from '@nestjs/common';
import { ImplementModule } from '@modules/production/implement/implement.module';
import { PortalModule } from './portal.module';
import { PortalArtworkController } from './portal-artwork.controller';
import { PortalArtworkService } from './portal-artwork.service';

@Module({
  imports: [
    // `PortalScopeService` (o escopo comercial das decisões) e
    // `PortalProjectionService` (a régua de seções da lista).
    PortalModule,
    // `ImplementLayoutService` — a MÁQUINA DA ARTE (P12). O portal não tem
    // transição própria; ele chama `approveFromPortal`/`reproveFromPortal`.
    ImplementModule,
  ],
  controllers: [PortalArtworkController],
  providers: [PortalArtworkService],
  exports: [PortalArtworkService],
})
export class PortalArtworkModule {}
