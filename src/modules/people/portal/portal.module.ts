// api/src/modules/people/portal/portal.module.ts
//
// A FUNDAÇÃO do portal do responsável: escopo (quais linhas) e projeção (quais
// colunas). Nenhum controlador mora aqui — as rotas `/cliente/me/*` são de
// outros pacotes, que importam este módulo.
//
// Note o que este módulo NÃO tem:
//
//  · NENHUM `APP_GUARD`. `ResponsibleAuthGuard` já é global
//    (`responsible-auth.module.ts`) e é ele que autentica e que barra por papel.
//    `PortalCapabilityGuard` é instalado pelo próprio `@PortalCapability(...)`
//    via `applyDecorators(UseGuards(…))`, e por isso roda DEPOIS da guarda
//    global, com `request.responsible` já preenchido. Registrar uma segunda
//    guarda global aqui inverteria essa ordem conforme a ordem de import dos
//    módulos — e uma guarda de capacidade que rodasse ANTES da autenticação
//    recusaria toda rota com capacidade, ou, pior, seria "consertada" deixando
//    passar quando não há principal.
//
//  · NENHUM `PrismaModule`. Os dois serviços são PUROS: montam objeto de `where`
//    e recortam linhas já carregadas. É o que permite testá-los sem banco
//    (`test:portal-escopo`, `test:portal-recorte`) e o que impede que alguém
//    acrescente uma consulta aqui dentro e o escopo passe a depender de I/O.
//
// ⚠️ PARA O ORQUESTRADOR: este módulo ainda NÃO está em `src/app.module.ts`.
// Quem importar os serviços em seu próprio módulo já os recebe; o registro em
// `app.module.ts` é costura, e a costura é do fim.
import { Module } from '@nestjs/common';
import { PortalScopeService } from './portal-scope.service';
import { PortalProjectionService } from './portal-projection.service';
import { PortalCapabilityGuard } from './portal-roles.decorator';

@Module({
  providers: [PortalScopeService, PortalProjectionService, PortalCapabilityGuard],
  exports: [PortalScopeService, PortalProjectionService, PortalCapabilityGuard],
})
export class PortalModule {}
