import { Module } from '@nestjs/common';
import { ResponsibleController } from './responsible.controller';
import { ResponsibleService } from './responsible.service';
import { ResponsibleRepository } from './repositories/responsible.repository';
import { ResponsiblePrismaRepository } from './repositories/responsible-prisma.repository';
import { ChangeLogModule } from '@/modules/common/changelog/changelog.module';
import { PrismaModule } from '@/modules/common/prisma/prisma.module';
import { UserModule } from '../user/user.module';
import { ResponsibleAuthModule } from '../responsible-auth/responsible-auth.module';

// O `JwtModule` daqui foi REMOVIDO. Ele registrava um assinador com o MESMO
// `JWT_SECRET` do access token de funcionario, e era com ele que
// `ResponsibleService.login` emitia o token do responsavel — um token de
// terceiro assinado pela chave que autentica a casa inteira. A rota publica do
// orcamento (`budget.controller.ts`) conferia SO a assinatura, entao esse token
// ja destravava orcamento vencido de qualquer UUID.
//
// A doutrina correta ja estava escrita no repo, em `auth.service.ts`, quando o
// token de primeiro acesso ganhou segredo proprio: "AuthGuard verifies any JWT
// minted with JWT_SECRET and trusts its `sub`". O token de responsavel nao
// tinha recebido esse tratamento; agora recebe, em ResponsibleAuthModule.
//
// `HashModule` saiu junto: sem senha de responsavel, nao ha o que hashear.
@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    UserModule, // Import UserModule to provide UserRepository for AuthGuard
    // Para revogar as sessões do portal quando o CANAL muda de dono (telefone ou
    // e-mail trocado) ou o cadastro é desativado. Sem isto, quem entrou com o
    // número antigo seguia lendo os orçamentos do cliente por até um ano.
    ResponsibleAuthModule,
  ],
  controllers: [ResponsibleController],
  providers: [
    ResponsibleService,
    {
      provide: ResponsibleRepository,
      useClass: ResponsiblePrismaRepository,
    },
  ],
  exports: [ResponsibleService, ResponsibleRepository],
})
export class ResponsibleModule {}
