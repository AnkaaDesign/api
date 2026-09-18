// api/src/modules/people/responsible-auth/responsible-auth.controller.ts
//
// As rotas de entrada do portal do cliente.
//
// Vivem sob `/cliente/auth/*` e não sob `/responsibles/*` de propósito: o
// segundo é o CRUD que o funcionário usa para gerir contatos, e misturar "o
// comercial cadastra um contato" com "o contato entra no sistema" no mesmo
// controller foi exatamente o que produziu o desenho anterior — onde
// `POST /responsibles/register` era `@Public()` e aceitava `companyId` e `roles`
// do corpo, deixando qualquer pessoa se anexar ao cliente que quisesse.
//
// Aqui: pedir código e trocar código por sessão são PÚBLICAS (ninguém tem sessão
// antes de entrar); tudo o mais exige a sessão.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '@/modules/common/auth/decorators/public.decorator';
import { ZodValidationPipe } from '@/modules/common/pipes/zod-validation.pipe';
import {
  AuthRateLimit,
  VerificationSendRateLimit,
} from '@/modules/common/throttler/throttler.decorators';
import { ResponsibleAuthService } from './responsible-auth.service';
import { ResponsibleAuthGuard, type ResponsiblePrincipal } from './responsible-auth.guard';
import { ResponsibleOnly } from './responsible-auth.decorators';
import { CurrentResponsible } from './current-responsible.decorator';

const requestCodeSchema = z.object({
  contact: z.string().min(1, 'Informe seu e-mail ou telefone'),
});

const verifyCodeSchema = z.object({
  contact: z.string().min(1, 'Informe seu e-mail ou telefone'),
  challengeId: z.string().min(1),
  code: z.string().min(1, 'Informe o código recebido'),
});

@Controller('cliente/auth')
export class ResponsibleAuthController {
  constructor(private readonly auth: ResponsibleAuthService) {}

  /**
   * Passo 1 — pede o código.
   *
   * `@VerificationSendRateLimit()` é o balde mais apertado que existe (2 por 5
   * min em produção, bloqueio de 30 min) e é o mesmo que `/auth/send-verification`
   * usa. Vale notar que o controller ANTIGO de responsáveis não tinha throttle
   * nenhum: `POST /responsibles/login` aceitava chute de senha ilimitado.
   */
  @Post('codigo')
  @Public()
  @VerificationSendRateLimit()
  async requestCode(
    @Body(new ZodValidationPipe(requestCodeSchema)) data: { contact: string },
    @Req() req: Request,
  ) {
    return this.auth.requestCode({
      contact: data.contact,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  /** Passo 2 — troca o código por uma sessão. */
  @Post('entrar')
  @Public()
  @AuthRateLimit()
  async verifyCode(
    @Body(new ZodValidationPipe(verifyCodeSchema))
    data: { contact: string; challengeId: string; code: string },
    @Req() req: Request,
  ) {
    return this.auth.verifyCode({
      contact: data.contact,
      challengeId: data.challengeId,
      code: data.code,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  /**
   * Quem sou eu. O portal chama isto no boot para restaurar a sessão — e, como a
   * guarda relê a sessão do banco a cada requisição, um 401 aqui é a resposta
   * honesta de "foi revogada" ou "o cadastro foi desativado".
   */
  @Get('eu')
  @ResponsibleOnly()
  @UseGuards(ResponsibleAuthGuard)
  async me(@CurrentResponsible() responsible: ResponsiblePrincipal) {
    return {
      id: responsible.id,
      name: responsible.name,
      roles: responsible.roles,
      companyId: responsible.companyId,
    };
  }

  /**
   * Sai. Revoga de verdade: a sessão é marcada no banco e a próxima requisição
   * não passa. O `logout` antigo zerava uma coluna que nenhuma guarda lia — o
   * token seguia válido por sete dias depois de "sair".
   */
  @Post('sair')
  @ResponsibleOnly()
  @UseGuards(ResponsibleAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request) {
    const header = req.headers.authorization;
    const token = typeof header === 'string' ? header.split(' ')[1] : null;
    if (token) await this.auth.logout(token);
  }
}
