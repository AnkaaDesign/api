// api/src/modules/people/responsible-auth/responsible-auth.module.ts
//
// O portal do cliente.
//
// Note o que este módulo NÃO importa: nenhum `JwtModule`. A sessão é um token
// opaco de 256 bits guardado como SHA-256, não um JWT — logo não há segredo de
// assinatura a compartilhar. Foi justamente assinar o token do responsável com o
// `JWT_SECRET` da casa que abriu o furo de destravar orçamento vencido de
// qualquer cliente pela rota pública do orçamento.
//
// `ResponsibleAuthService` é exportado para que o CRUD de responsáveis possa
// revogar sessões ao desativar um contato.
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '@/modules/common/prisma/prisma.module';
import { AuthOtpModule } from '@/modules/common/auth-otp/auth-otp.module';
import { ResponsibleAuthController } from './responsible-auth.controller';
import { ResponsibleAuthService } from './responsible-auth.service';
import { ResponsibleAuthChallengeService } from './responsible-auth-challenge.service';
import { ResponsibleAuthGuard } from './responsible-auth.guard';

@Module({
  imports: [PrismaModule, AuthOtpModule],
  controllers: [ResponsibleAuthController],
  providers: [
    ResponsibleAuthService,
    ResponsibleAuthChallengeService,
    // GLOBAL, como o `AuthGuard` (`auth.module.ts`). As duas guardas leem o
    // mesmo metadado com respostas invertidas: `@ResponsibleOnly()` faz o
    // `AuthGuard` ceder e esta assumir; sem a marca, esta cede e o `AuthGuard`
    // assume. Toda requisição é decidida por exatamente uma delas.
    //
    // Era um `@UseGuards` por handler, e isso deixava uma rota que ganhasse a
    // marca sem o `@UseGuards` completamente ABERTA — o `AuthGuard` cedia e
    // ninguém assumia. Registrando aqui, marcar a rota passa a ser suficiente:
    // não há segunda linha que alguém possa esquecer.
    { provide: APP_GUARD, useClass: ResponsibleAuthGuard },
  ],
  exports: [ResponsibleAuthService, ResponsibleAuthChallengeService],
})
export class ResponsibleAuthModule {}
