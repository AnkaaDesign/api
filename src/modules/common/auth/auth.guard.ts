import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from './decorators/roles.decorator';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { IS_ADMIN_ONLY_KEY } from './decorators/admin-only.decorator';
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SECTOR_PRIVILEGES, TEAM_LEADER } from '../../../constants';
import { canAccessAnyPrivilege } from '../../../utils/privilege';
import { isTeamLeader } from '../../../utils/user';
import { isUserEmployed } from '../../../utils/contract';

@Injectable()
export class AuthGuard implements CanActivate {
  /**
   * Janela de carência para um access token VENCIDO, em dias.
   *
   * O access token dura `JWT_ACCESS_EXPIRATION` (30d em produção) e deveria ser
   * renovado pelo refresh token. Só que parte dos aparelhos ficou com o access
   * token sem o refresh token ao lado — a migração do armazenamento seguro do
   * app carregou o access token sozinho —, e o cliente trata "não tenho refresh
   * token" como falha transitória: não renova e também não desloga. Vencido o
   * prazo, o app segue "logado" na tela e toda requisição responde 401. A pessoa
   * navega e nenhuma tela carrega.
   *
   * A carência aceita esse token vencido enquanto a SESSÃO ainda estiver viva do
   * lado do servidor (existe refresh token válido e não revogado), o que devolve
   * ao access token exatamente o alcance que o refresh token teria — nada além.
   * `0` desliga a carência.
   */
  private readonly graceDays = Number(process.env.JWT_ACCESS_GRACE_DAYS ?? 365);

  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private userRepository: UserRepository,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Allow OPTIONS requests (CORS preflight) to pass through without authentication
    if (request.method === 'OPTIONS') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const roles = this.reflector.getAllAndMerge<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Exclusive ADMIN-only override. Unlike @Roles (which the guard MERGES as a
    // union of class + handler), @AdminOnly() bypasses the union entirely and
    // grants access to ADMIN only. Handler-level takes precedence over class.
    const isAdminOnly = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException('Você não está autorizado a fazer essa ação.');
    }

    try {
      const { payload, expired } = await this.verifyAccessToken(token);

      // Check if user still exists and is active
      // Include ledSector to check for team leader status
      const user = await this.userRepository.findById(payload.sub, {
        include: { ledSector: true },
      });

      if (!user) {
        throw new UnauthorizedException('Usuário não encontrado.');
      }

      if (!isUserEmployed(user)) {
        throw new ForbiddenException(
          'Sua conta está inativa. Entre em contato com o administrador.',
        );
      }

      // Token vencido: só segue se a sessão ainda estiver viva no servidor.
      if (expired) {
        await this.assertGraceAllowed(payload);
        // Pista para o cliente que souber lê-la: a sessão está sendo sustentada
        // pela carência e o par de tokens deste aparelho precisa ser renovado.
        context.switchToHttp().getResponse()?.setHeader?.('X-Access-Token-Expired', 'true');
      }

      // Session token validation has been removed to support:
      // 1. Mobile apps that persist tokens across app restarts
      // 2. Multiple devices using the same account
      // 3. Better user experience without unnecessary re-authentication
      // The JWT token validation above is sufficient for security

      // Check if password change is required
      // Allow access to password reset endpoints and auth/me
      const passwordResetPaths = [
        '/auth/change-password',
        '/auth/me',
        '/auth/password-reset/request', // Allow requesting reset
        '/auth/password-reset', // Allow submitting reset code
        '/auth/logout', // Allow logging out
      ];

      const isPasswordResetPath = passwordResetPaths.some(path => request.path.includes(path));

      if (user.requirePasswordChange && !isPasswordResetPath) {
        throw new ForbiddenException('Você precisa alterar sua senha antes de continuar.');
      }

      request['user'] = payload;
      request['user'].isTeamLeader = isTeamLeader(user);

      // Exclusive ADMIN-only enforcement (runs before/independent of the role
      // union). This is the only way to restrict a handler BELOW its class-level
      // @Roles set, since @Roles is merged as a union by getAllAndMerge.
      if (isAdminOnly && payload.role !== SECTOR_PRIVILEGES.ADMIN) {
        console.warn(
          `Access denied for user ${payload.sub}. Endpoint is ADMIN-only, User role: ${payload.role}`,
        );
        throw new ForbiddenException(
          'Acesso negado. Esta ação é restrita a administradores.',
        );
      }

      // Check role-based access
      if (roles?.length) {
        const requiredPrivileges = roles as Array<SECTOR_PRIVILEGES | typeof TEAM_LEADER>;
        const userPrivilege = payload.role as SECTOR_PRIVILEGES;

        // Check if TEAM_LEADER is one of the required privileges
        const teamLeaderRequired = requiredPrivileges.includes(TEAM_LEADER);
        const userIsTeamLeader = isTeamLeader(user);

        // If TEAM_LEADER is required and user is a team leader, allow access
        if (teamLeaderRequired && userIsTeamLeader) {
          // Team leader access granted
        } else {
          // Check regular privilege-based access
          // If roles are required but user has no role (no sector assigned)
          if (!payload.role) {
            console.warn(`User ${payload.sub} has no role assigned (missing sector privileges)`);
            throw new ForbiddenException(
              'Acesso negado. Sua conta não tem um setor atribuído. Entre em contato com o administrador.',
            );
          }

          // Filter out TEAM_LEADER from required privileges for regular check
          const regularPrivileges = requiredPrivileges.filter(
            p => p !== TEAM_LEADER,
          ) as SECTOR_PRIVILEGES[];

          // If there are regular privileges to check
          if (regularPrivileges.length > 0) {
            if (!canAccessAnyPrivilege(userPrivilege, regularPrivileges)) {
              // If team leader was also an option but user is not a team leader
              if (teamLeaderRequired) {
                console.warn(
                  `Access denied for user ${payload.sub}. Required roles: ${roles.join(', ')}, User role: ${payload.role}, Is team leader: ${userIsTeamLeader}`,
                );
                throw new ForbiddenException(
                  `Acesso negado. Privilégios insuficientes. Necessário: ${roles.join(' ou ')}, Atual: ${payload.role}`,
                );
              }
              console.warn(
                `Access denied for user ${payload.sub}. Required roles: ${roles.join(', ')}, User role: ${payload.role}`,
              );
              throw new ForbiddenException(
                `Acesso negado. Privilégios insuficientes. Necessário: ${roles.join(' ou ')}, Atual: ${payload.role}`,
              );
            }
          } else if (teamLeaderRequired && !userIsTeamLeader) {
            // Only TEAM_LEADER was required but user is not a team leader
            console.warn(
              `Access denied for user ${payload.sub}. Required: TEAM_LEADER, Is team leader: ${userIsTeamLeader}`,
            );
            throw new ForbiddenException(
              'Acesso negado. Apenas líderes de equipe podem acessar este recurso.',
            );
          }
        }
      }
    } catch (err) {
      // Deliberate auth decisions (bad/missing user, insufficient role) keep
      // their status.
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) {
        throw err;
      }

      // Only a genuine JWT verification failure (bad signature, expired token)
      // is a 401. Everything else in the try block — notably the per-request
      // user lookup (userRepository.findById) — can fail TRANSIENTLY (DB pool
      // exhaustion, a brief Postgres blip, a network hiccup between API and DB).
      // Collapsing those into a 401 makes every client treat a momentary backend
      // fault as "session dead" and force a re-login. Instead, rethrow so Nest
      // surfaces a 5xx: clients already keep the session and retry on 5xx.
      const isJwtError =
        err instanceof Error &&
        ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(err.name);
      if (isJwtError) {
        throw new UnauthorizedException('Token inválido ou expirado.');
      }

      throw err;
    }
    return true;
  }

  /**
   * Verifica o access token. Um token vencido NÃO é recusado aqui: a assinatura
   * é conferida com `ignoreExpiration` e a decisão fica para
   * [assertGraceAllowed], que precisa do usuário carregado.
   */
  private async verifyAccessToken(
    token: string,
  ): Promise<{ payload: any; expired: boolean }> {
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
      return { payload, expired: false };
    } catch (err) {
      const isExpired = err instanceof Error && err.name === 'TokenExpiredError';
      if (!isExpired || this.graceDays <= 0) throw err;

      // Assinatura inválida ou adulterada continua estourando daqui.
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
        ignoreExpiration: true,
      });
      return { payload, expired: true };
    }
  }

  /**
   * Decide se um access token vencido ainda vale. Três condições, todas
   * obrigatórias:
   *
   * 1. venceu dentro da janela de `graceDays`;
   * 2. o usuário tem pelo menos um refresh token vivo (não revogado, não
   *    vencido) — ou seja, a sessão nunca foi encerrada. Um logout revoga o
   *    refresh token e leva a carência junto;
   * 3. o token foi emitido depois de `accessGraceCutoffAt`, o carimbo que o
   *    logout deixa para derrubar os tokens vencidos dos OUTROS aparelhos da
   *    mesma conta (que, tendo refresh token, renovam sozinhos).
   */
  private async assertGraceAllowed(payload: any): Promise<void> {
    const deny = () => {
      throw new UnauthorizedException('Token inválido ou expirado.');
    };

    const expMs = typeof payload?.exp === 'number' ? payload.exp * 1000 : null;
    if (expMs === null) deny();

    const ageMs = Date.now() - (expMs as number);
    if (ageMs > this.graceDays * 24 * 60 * 60 * 1000) deny();

    const [liveSessions, graceUser] = await Promise.all([
      this.prisma.refreshToken.count({
        where: { userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { accessGraceCutoffAt: true },
      }),
    ]);

    if (liveSessions === 0) deny();

    const cutoff = graceUser?.accessGraceCutoffAt;
    const iatMs = typeof payload?.iat === 'number' ? payload.iat * 1000 : null;
    if (cutoff && (iatMs === null || iatMs < cutoff.getTime())) deny();
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
