import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

export interface UserPayload {
  sub: string; // user ID
  email: string | null;
  phone: string | null;
  role: string;
  isTeamLeader?: boolean;
}

export const User = createParamDecorator(
  (data: keyof UserPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    return data ? user?.[data] : user;
  },
);

/**
 * O id do FUNCIONARIO logado. Usado em 827 pontos, e quase sempre gravado
 * direto numa coluna FK que aponta para `User`.
 *
 * Havia aqui um fallback `|| request.user?.id`, e ele era a peca mais perigosa
 * do sistema de autenticacao. O token de responsavel — assinado, ate 17/09, com
 * o MESMO `JWT_SECRET` — carrega exatamente um campo `id` e nao carrega `sub`.
 * Bastava o guard passar a aceitar aquele payload para que os 827 pontos
 * comecassem a devolver o UUID de um contato de cliente e a grava-lo em colunas
 * de `User`: 46 delas sao NOT NULL, e `ChangeLog` grava por `connect`, onde um
 * id inexistente vira P2025 e derruba a transacao de NEGOCIO que estava sendo
 * auditada (ja aconteceu: 7 linhas de bonificacao perdidas em 07/2026).
 *
 * O fallback tambem era redundante: `UserContextInterceptor` so escreve
 * `request.user.id` copiando de `request.user.sub`, entao para funcionario os
 * dois valores sao sempre o mesmo. Ele nunca serviu ao caso legitimo — so ao
 * perigoso.
 *
 * Agora e' `sub` e mais nada. Um payload sem `sub` chegando a um handler de
 * funcionario e' um erro de roteamento de identidade, e falha alto.
 */
export const UserId = createParamDecorator((data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  const sub = request.user?.sub;

  if (typeof sub !== 'string' || sub.length === 0) {
    throw new UnauthorizedException('Esta rota exige um usuário do sistema.');
  }

  return sub;
});
