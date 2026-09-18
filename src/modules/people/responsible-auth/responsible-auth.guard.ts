// api/src/modules/people/responsible-auth/responsible-auth.guard.ts
//
// A guarda do portal do cliente.
//
// É uma guarda SEPARADA do `AuthGuard`, e não um ramo dentro dele, porque
// aquela guarda carrega um `User`, checa vínculo empregatício
// (`isUserEmployed`), checa `requirePasswordChange` e resolve
// `SECTOR_PRIVILEGES`. Um contato de cliente não é funcionário: nenhuma dessas
// perguntas se aplica a ele, e esticar a guarda para tolerar um payload de
// formato diferente é exatamente o movimento que deixaria os 827 `@UserId()`
// devolverem o id errado.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ResponsibleRole } from '@prisma/client';
import { ResponsibleAuthService } from './responsible-auth.service';
import { IS_RESPONSIBLE_ROUTE, RESPONSIBLE_ROLES_KEY } from './responsible-auth.decorators';

/** O que fica em `request.responsible`. NUNCA em `request.user`. */
export interface ResponsiblePrincipal {
  sessionId: string;
  id: string;
  name: string;
  roles: ResponsibleRole[];
  companyId: string | null;
}

@Injectable()
export class ResponsibleAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: ResponsibleAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    if (request.method === 'OPTIONS') return true;

    // A marca é obrigatória. Uma rota que esqueça `@ResponsibleOnly()` não
    // "abre por omissão": ela recusa.
    const isResponsibleRoute = this.reflector.getAllAndOverride<boolean>(IS_RESPONSIBLE_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isResponsibleRoute) {
      throw new UnauthorizedException('Rota indisponível para o portal do cliente.');
    }

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Sessão não encontrada. Entre novamente.');
    }

    // Relê a sessão A CADA REQUISIÇÃO. É o que faz revogação e desativação de
    // cadastro valerem na hora, em vez de esperar o token vencer — o defeito do
    // `logout` antigo, que zerava uma coluna que nenhuma guarda lia.
    const resolved = await this.auth.resolveSession(token);
    if (!resolved) {
      throw new UnauthorizedException('Sessão expirada ou revogada. Entre novamente.');
    }

    const principal: ResponsiblePrincipal = {
      sessionId: resolved.sessionId,
      id: resolved.responsible.id,
      name: resolved.responsible.name,
      roles: resolved.responsible.roles as ResponsibleRole[],
      companyId: resolved.responsible.companyId,
    };

    // Escrito em `request.responsible`, JAMAIS em `request.user`.
    //
    // `request.user` é lido por `@UserId()` (827 pontos), pelo
    // `UserContextInterceptor`, pelo `MoneyRedactionInterceptor` e pelo
    // changelog. Um contato de cliente aparecendo ali seria gravado em colunas
    // FK de `User` — 46 delas NOT NULL —, e no `ChangeLog`, que grava por
    // `connect`, um id inexistente vira P2025 e derruba a transação de NEGÓCIO
    // que estava sendo auditada. Já custou 7 linhas de bonificação em 07/2026.
    request.responsible = principal;

    // União, não interseção: um contato com MARKETING + FINANCIAL passa em
    // qualquer portão que exija um dos dois.
    const required = this.reflector.getAllAndMerge<ResponsibleRole[]>(RESPONSIBLE_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required?.length) {
      const allowed = principal.roles.some(role => required.includes(role));
      if (!allowed) {
        throw new ForbiddenException(
          'Seu perfil de contato não tem acesso a esta informação. Fale com o comercial.',
        );
      }
    }

    // Empurra a janela de ociosidade — é isto que faz quem usa o portal com
    // alguma regularidade nunca mais precisar fazer login. Passa a sessão junto
    // para que o serviço saiba (a) se já escreveu na última hora, evitando um
    // UPDATE por requisição, e (b) qual é o teto absoluto, que nunca é
    // ultrapassado.
    //
    // Best-effort e fora do caminho crítico: renovar é conveniência, não
    // autorização, e não pode custar a requisição do cliente.
    void this.auth.touchSession(principal.sessionId, request.ip ?? null, {
      createdAt: resolved.createdAt,
      lastSeenAt: resolved.lastSeenAt,
    });

    return true;
  }

  private extractToken(request: {
    headers: Record<string, string | string[] | undefined>;
  }): string | null {
    const header = request.headers?.authorization;
    if (typeof header !== 'string') return null;
    const [type, value] = header.split(' ');
    return type === 'Bearer' && value ? value : null;
  }
}
