import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * `@Global` porque o AuthGuard passou a depender do PrismaService (janela de
 * carência do access token vencido) e o guard é instanciado no contexto de
 * cada módulo que o declara em `@UseGuards` — hoje mais de vinte. Sem isto,
 * cada um desses módulos precisaria importar o PrismaModule só para satisfazer
 * um provider que nem é dele. O PrismaService já é singleton, então o escopo
 * global não muda o número de conexões.
 */
@Global()
@Module({
  exports: [PrismaService],
  providers: [PrismaService],
})
export class PrismaModule {}
