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
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { USER_STATUS, SECTOR_PRIVILEGES, TEAM_LEADER } from '../../../constants';
import { canAccessAnyPrivilege } from '../../../utils/privilege';
import { isTeamLeader } from '../../../utils/user';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private userRepository: UserRepository,
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

    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException('Você não está autorizado a fazer essa ação.');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });

      // Check if user still exists and is active
      // Include managedSector to check for team leader status
      const user = await this.userRepository.findById(payload.sub, {
        include: { managedSector: true },
      });

      if (!user) {
        throw new UnauthorizedException('Usuário não encontrado.');
      }

      if (!user.isActive) {
        throw new ForbiddenException(
          'Sua conta está inativa. Entre em contato com o administrador.',
        );
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
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) {
        throw err;
      }
      throw new UnauthorizedException('Token inválido ou expirado.');
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
