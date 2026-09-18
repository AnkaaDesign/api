// api/src/modules/people/responsible-auth/current-responsible.decorator.ts
//
// O contato de cliente logado. É o análogo de `@UserId()`, e é DELIBERADAMENTE
// um decorador separado, lendo de uma propriedade separada (`request.responsible`).
//
// Nunca unifique os dois. `@UserId()` é usado em 827 pontos e o valor que ele
// devolve é gravado, quase sempre, direto numa coluna FK que aponta para `User`
// — 46 delas são NOT NULL, e o `ChangeLog` grava por `connect`, onde um id que
// não existe em `User` vira P2025 e derruba a transação de NEGÓCIO que estava
// sendo auditada. Um único ponto onde os dois sujeitos se misturem transforma
// "cliente abriu o portal" em "sumiram sete linhas de bonificação".
import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { ResponsiblePrincipal } from './responsible-auth.guard';

export const CurrentResponsible = createParamDecorator(
  (data: keyof ResponsiblePrincipal | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const principal: ResponsiblePrincipal | undefined = request.responsible;

    if (!principal) {
      // Só acontece se alguém usar o decorador numa rota sem
      // `ResponsibleAuthGuard`. Falhar alto é o comportamento certo: o modo
      // silencioso seria devolver `undefined` e deixar a consulta abaixo rodar
      // SEM escopo de cliente — ou seja, devolvendo os dados de todo mundo.
      throw new UnauthorizedException('Esta rota exige uma sessão do portal do cliente.');
    }

    return data ? principal[data] : principal;
  },
);
