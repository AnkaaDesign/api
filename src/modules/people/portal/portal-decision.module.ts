// api/src/modules/people/portal/portal-decision.module.ts
//
// A PRÉ-APROVAÇÃO do portal — pacote API-4.
//
// Módulo PRÓPRIO, e não um controlador dentro de `PortalModule`, por uma razão
// declarada lá: `PortalModule` é a FUNDAÇÃO (escopo e projeção), não tem
// `PrismaModule` e não tem controlador nenhum. Os dois serviços dele são puros,
// e é isso que permite testá-los sem banco. Pendurar aqui um controlador que
// escreve no orçamento arrastaria Prisma, `BudgetModule` e `NotificationModule`
// para dentro da fundação — e todo pacote que só quisesse o `where` do escopo
// passaria a carregar o motor de orçamento junto.
//
// Registrado em `src/app.module.ts`, ao lado de `PortalReadModule`. O registro
// não é opcional nem detectável pelo compilador: sem a linha, o `tsc` compila
// este arquivo do mesmo jeito, `pnpm build` passa, e a ausência só aparece como
// 404 nas duas rotas.
import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { BudgetModule } from '@modules/production/budget/budget.module';
import { PortalModule } from './portal.module';
import { PortalDecisionController } from './portal-decision.controller';
import { PortalDecisionService } from './portal-decision.service';

@Module({
  imports: [
    PrismaModule,
    // `PortalScopeService` — o `where` dos três caminhos. Sem ele o id da URL
    // decidiria sobre o orçamento de qualquer empresa.
    PortalModule,
    // `BudgetService` — a MÁQUINA DE ESTADOS. O portal não tem tabela de
    // transições própria; ele chama a que já existe.
    BudgetModule,
    // `PortalNotificationService` — o aviso ao comercial da Ankaa.
    NotificationModule,
  ],
  controllers: [PortalDecisionController],
  providers: [PortalDecisionService],
  exports: [PortalDecisionService],
})
export class PortalDecisionModule {}
