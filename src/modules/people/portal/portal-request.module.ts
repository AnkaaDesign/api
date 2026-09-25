// api/src/modules/people/portal/portal-request.module.ts
//
// A REQUISIÇÃO DE ORÇAMENTO do portal — pacote API-3.
//
// Módulo PRÓPRIO, e não um controlador dentro de `PortalModule`, pela razão que
// aquele arquivo declara no cabeçalho: `PortalModule` é a FUNDAÇÃO (escopo e
// projeção), sem Prisma e sem controlador, e é isso que permite testá-lo sem
// banco. Pendurar aqui um controlador que ESCREVE orçamento, tarefa, implemento,
// medida, arquivo e cliente arrastaria `PaintModule` e `FileModule` para dentro
// da fundação — e todo pacote que só quisesse o `where` do escopo passaria a
// carregar o motor de tinta junto.
//
// O que este módulo NÃO tem, e por quê:
//
//  · NENHUM `PrismaModule` nos `imports`. Ele é `@Global()`
//    (`common/prisma/prisma.module.ts`); reimportá-lo só sugeriria a existência
//    de um segundo `PrismaService`.
//
//  · NENHUM `@UseGuards` e nenhum `APP_GUARD`. `ResponsibleAuthGuard` já é
//    global e `@ResponsibleOnly()` é o que entrega a rota a ela;
//    `PortalCapabilityGuard` é instalado pelo próprio `@PortalCapability(...)`,
//    que só depende do `Reflector` do núcleo do Nest.
//
//  · NENHUM `BudgetModule`. A requisição NÃO passa por `BudgetService.create`:
//    aquele caminho exige `services.length > 0` (`budget.service.ts:414`) e uma
//    requisição nasce SEM serviço, por definição. O que se reusa é a
//    reconciliação de faturamento (`utils/budget-customer-config-sync.ts`), que
//    é função, não provider.
//
// ✅ JÁ REGISTRADO em `src/app.module.ts:170`. O aviso que vivia aqui ("falta
// acrescentar aos imports do AppModule") ficou obsoleto quando a costura foi
// feita, e um bilhete obsoleto é pior que nenhum: o próximo leitor
// acrescentaria a linha uma segunda vez. Fica o motivo de o bilhete ter
// existido, que continua verdadeiro — um módulo fora do `AppModule` compila e
// passa no `pnpm build` do mesmo jeito, e a ausência só aparece num 404.
import { Module } from '@nestjs/common';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { FileModule } from '@modules/common/file/file.module';
import { PaintModule } from '@modules/paint/paint.module';
import { PortalModule } from './portal.module';
import { PortalRequestController } from './portal-request.controller';
import { PortalRequestService } from './portal-request.service';

@Module({
  imports: [
    // `PortalScopeService` — o ALCANCE do contato. A requisição resolvia
    // cliente e pagador por `findUnique` do id cru, confiando na lista
    // escopada do combobox; lista não é guarda.
    PortalModule,
    // `ChangeLogService` — a auditoria, sempre com `userId: null` e autoria em
    // `triggeredById` (id de responsável não existe em `User`).
    ChangeLogModule,
    // `FileService.createFromUploadWithTransaction` — os arquivos-base, que têm
    // de nascer no MESMO commit da tarefa a que se ligam.
    FileModule,
    // `PaintService.create` — a tinta nova, com a validação de duplicidade e de
    // tipo que um `tx.paint.create` à mão pularia.
    PaintModule,
    // `PortalNotificationService` — o aviso de que CHEGOU uma requisição.
    //
    // A tela do portal promete, com estas palavras, "Nosso comercial recebe na
    // hora", e o recibo diz "já está com o comercial". Nenhum aviso era gravado:
    // a requisição só existia para quem reparasse numa linha nova no topo de uma
    // lista. As decisões do cliente (pré-aprovar/recusar) já avisavam
    // (`portal-decision.module.ts`); faltava a primeira ponta da conversa.
    NotificationModule,
  ],
  controllers: [PortalRequestController],
  providers: [PortalRequestService],
  exports: [PortalRequestService],
})
export class PortalRequestModule {}
