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
import { USER_STATUS, SECTOR_PRIVILEGES } from '../../../constants';
import { canAccessAnyPrivilege } from '../../../utils/privilege';

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
      const user = await this.userRepository.findById(payload.sub);

      if (!user) {
        throw new UnauthorizedException('Usuário não encontrado.');
      }

      if (user.status === USER_STATUS.DISMISSED) {
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
        // If roles are required but user has no role (no sector assigned)
        if (!payload.role) {
          console.warn(`User ${payload.sub} has no role assigned (missing sector privileges)`);
          throw new ForbiddenException(
            'Acesso negado. Sua conta não tem um setor atribuído. Entre em contato com o administrador.',
          );
        }

        // Check if user's role can access any of the required roles using privilege hierarchy
        const userPrivilege = payload.role as SECTOR_PRIVILEGES;
        const requiredPrivileges = roles as SECTOR_PRIVILEGES[];

        if (!canAccessAnyPrivilege(userPrivilege, requiredPrivileges)) {
          console.warn(
            `Access denied for user ${payload.sub}. Required roles: ${roles.join(', ')}, User role: ${payload.role}`,
          );
          throw new ForbiddenException(
            `Acesso negado. Privilégios insuficientes. Necessário: ${roles.join(' ou ')}, Atual: ${payload.role}`,
          );
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
