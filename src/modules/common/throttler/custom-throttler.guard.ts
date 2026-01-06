import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException, ThrottlerRequest } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';

// NestJS Throttler constants
const THROTTLER_SKIP = 'THROTTLER:SKIP';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  constructor(
    protected readonly options: any,
    protected readonly storageService: any,
    protected readonly reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  // Override canActivate to properly handle SkipThrottle decorator
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check for @NoRateLimit() decorator FIRST
    const skipThrottle = this.reflector.getAllAndOverride<boolean>('skipThrottle', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipThrottle) {
      if (process.env.NODE_ENV !== 'production') {
        const request = context.switchToHttp().getRequest();
        const handler = context.getHandler();
        const classRef = context.getClass();
        const controllerName = classRef.name;
        const endpoint = handler.name;
        console.log(
          `[CustomThrottlerGuard] Skipping ALL rate limiting for ${controllerName}.${endpoint} due to @NoRateLimit() decorator`,
        );
      }
      return true;
    }
    // CRITICAL: Check if rate limiting is completely disabled via environment variable
    if (process.env.DISABLE_RATE_LIMITING === 'true') {
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[CustomThrottlerGuard] RATE LIMITING COMPLETELY DISABLED via DISABLE_RATE_LIMITING=true`,
        );
      }
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const endpoint = context.getHandler().name;
    const handler = context.getHandler();
    const classRef = context.getClass();
    const controllerName = classRef.name;

    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[CustomThrottlerGuard] canActivate - Controller: ${controllerName}, Endpoint: ${endpoint}, User: ${request.user?.sub || request.user?.id}`,
      );
    }

    // FIRST: Check if SkipThrottle is applied (from @NoRateLimit() decorator)
    const skipDefault = this.reflector.getAllAndOverride<boolean>(THROTTLER_SKIP + 'default', [
      handler,
      classRef,
    ]);

    if (skipDefault) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[CustomThrottlerGuard] Skipping all throttling for ${controllerName}.${endpoint} due to @NoRateLimit()`,
        );
      }
      return true;
    }

    // Check for specific throttler skips (in case of partial skips)
    const throttlerNames = [
      'short',
      'medium',
      'long',
      'file_upload',
      'verification',
      'verification_send',
      'verification_strict',
      'verification_progressive',
      'verification_ip',
      'custom',
    ];
    const hasAnySkip = throttlerNames.some(name => {
      return this.reflector.getAllAndOverride<boolean>(THROTTLER_SKIP + name, [handler, classRef]);
    });

    if (hasAnySkip) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[CustomThrottlerGuard] Some throttlers skipped for ${controllerName}.${endpoint} due to @NoRateLimit()`,
        );
      }
      // Let the parent handle which specific throttlers to skip
    }

    // SECOND: Global rate limiting disable switch
    if (process.env.DISABLE_RATE_LIMITING === 'true') {
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[CustomThrottlerGuard] RATE LIMITING GLOBALLY DISABLED for ${controllerName}.${endpoint}`,
        );
      }
      return true;
    }

    // THIRD: Completely bypass rate limiting for file operations in development
    const isFileOp = this.isFileOperation(controllerName, endpoint);
    if (process.env.NODE_ENV === 'development' && isFileOp) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[CustomThrottlerGuard] BYPASSING ALL RATE LIMITING for file operation: ${controllerName}.${endpoint}`,
        );
      }
      return true;
    }

    return super.canActivate(context);
  }

  async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, limit, ttl, blockDuration, throttler } = requestProps;
    const throttlerName = throttler.name || 'default';
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const handler = context.getHandler();
    const classRef = context.getClass();

    // Debug logging to identify which throttler is being applied
    const endpoint = context.getHandler().name;
    const controllerName = context.getClass().name;
    const isFileOperation = this.isFileOperation(controllerName, endpoint);

    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[CustomThrottlerGuard] handleRequest - Controller: ${controllerName}, Throttler: ${throttlerName}, Endpoint: ${endpoint}`,
        {
          limit,
          ttl,
          blockDuration,
          userId: request.user?.sub || request.user?.id,
          ip: request.ip,
          isFileOperation,
        },
      );
    }

    // FIRST: Double-check for SkipThrottle on this specific throttler
    const skipThisThrottler = this.reflector.getAllAndOverride<boolean>(
      THROTTLER_SKIP + throttlerName,
      [handler, classRef],
    );

    if (skipThisThrottler) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[CustomThrottlerGuard] Skipping throttler ${throttlerName} for ${controllerName}.${endpoint} due to @NoRateLimit()`,
        );
      }
      return true;
    }

    // SECOND: Completely bypass rate limiting for ALL file operations
    if (isFileOperation) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[CustomThrottlerGuard] BYPASSING ALL RATE LIMITING for file operation: ${controllerName}.${endpoint}`,
        );
      }
      return true;
    }

    // Only apply verification throttlers to verification endpoints
    const isVerificationEndpoint = this.isVerificationEndpoint(endpoint);
    const isVerificationThrottler = throttlerName.includes('verification');

    if (isVerificationThrottler && !isVerificationEndpoint) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[CustomThrottlerGuard] Skipping verification throttler ${throttlerName} for non-verification endpoint ${endpoint}`,
        );
      }
      return true;
    }

    // For verification endpoints, skip non-verification throttlers unless they're explicitly allowed
    if (
      isVerificationEndpoint &&
      !isVerificationThrottler &&
      !['short', 'default'].includes(throttlerName)
    ) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[CustomThrottlerGuard] Skipping non-verification throttler ${throttlerName} for verification endpoint ${endpoint}`,
        );
      }
      return true;
    }

    // For the getCurrentUser endpoint, only allow 'long' throttler from ReadRateLimit
    if (endpoint === 'getCurrentUser' && throttlerName !== 'long') {
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[CustomThrottlerGuard] Skipping throttler ${throttlerName} for getCurrentUser endpoint (only 'long' allowed)`,
        );
      }
      return true;
    }

    // Get user from request if authenticated
    const user = request.user;

    // Skip rate limiting for admin users
    if (user && user.sector?.privileges === SECTOR_PRIVILEGES.ADMIN) {
      return true;
    }

    // Generate throttler key based on IP and user ID if authenticated
    const key = this.generateKey(context, request.ip, throttlerName);

    try {
      const { totalHits, timeToExpire } = await this.storageService.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );

      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[CustomThrottlerGuard] Storage increment result - Key: ${key}, Hits: ${totalHits}/${limit}, Throttler: ${throttlerName}`,
        );
      }

      // Add rate limit headers
      response.setHeader('X-RateLimit-Limit', limit);
      response.setHeader('X-RateLimit-Remaining', Math.max(0, limit - totalHits));
      response.setHeader(
        'X-RateLimit-Reset',
        new Date(Date.now() + timeToExpire * 1000).toISOString(),
      );

      if (totalHits > limit) {
        response.setHeader('Retry-After', timeToExpire);
        const errorMessage = await this.getErrorMessage(context, {
          limit,
          ttl,
          blockDuration,
          throttler: throttlerName,
        });
        throw new ThrottlerException(errorMessage);
      }

      return true;
    } catch (error) {
      if (error instanceof ThrottlerException) {
        throw error;
      }
      // If Redis is down, allow the request but log the error
      if (process.env.NODE_ENV !== 'production') {
        console.error('Erro no rate limiting:', error);
      }
      return true;
    }
  }

  protected generateKey(context: ExecutionContext, suffix: string, name: string): string {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // JWT payload uses 'sub' for user ID, but some guards might set 'id'
    const userId = user?.sub || user?.id;
    const ipAddress = suffix || 'unknown';

    // Always include both user and IP information
    // Format: user:{userId}-ip:{ipAddress} or user:anonymous-ip:{ipAddress}
    const userPart = userId ? `user:${userId}` : 'user:anonymous';
    const ipPart = `ip:${ipAddress}`;
    const identifier = `${userPart}-${ipPart}`;

    const prefix = `${context.getClass().name}-${context.getHandler().name}`;

    return `${prefix}-${name}-${identifier}`;
  }

  private isVerificationEndpoint(endpoint: string): boolean {
    const verificationEndpoints = [
      'verify',
      'verifyCode',
      'verifyPhone',
      'verifyEmailCode',
      'sendVerification',
      'sendVerificationCode',
      'sendEmailVerification',
      'resendVerification',
      'resendSms',
      'resendEmailVerification',
    ];
    return verificationEndpoints.includes(endpoint);
  }

  private isFileOperation(controllerName: string, endpoint: string): boolean {
    // File controller operations - ALL operations in FileController are file operations
    if (controllerName === 'FileController') {
      return true;
    }

    // File-related endpoints in any controller
    const fileEndpoints = [
      'uploadFile',
      'uploadMultipleFiles',
      'serveFile',
      'serveThumbnail',
      'downloadFile',
      'getFile',
      'regenerateThumbnail',
    ];

    return fileEndpoints.includes(endpoint);
  }

  async getErrorMessage(context: ExecutionContext, throttlerLimitDetail: any): Promise<string> {
    const throttlerName = throttlerLimitDetail.throttler || 'default';
    const request = context.switchToHttp().getRequest();
    const endpoint = context.getHandler().name;

    // Debug logging to identify throttler issues
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[CustomThrottlerGuard] Throttler applied: ${throttlerName}, Endpoint: ${endpoint}`,
        {
          throttlerLimitDetail,
          userId: request.user?.sub || request.user?.id,
          ip: request.ip,
        },
      );
    }

    switch (throttlerName) {
      case 'short':
        if (endpoint.includes('verify') || endpoint.includes('signIn')) {
          return 'Muitas tentativas de login/verificação. Aguarde 1 minuto antes de tentar novamente.';
        }
        return 'Muitas tentativas. Por favor, aguarde um minuto antes de tentar novamente.';

      case 'verification':
        return 'Muitas tentativas de verificação. Aguarde 1 minuto antes de tentar novamente.';

      case 'verification_send':
        return 'Muitos códigos de verificação enviados. Aguarde 5 minutos antes de solicitar um novo código.';

      case 'verification_strict':
        return 'Código incorreto. Aguarde 30 segundos antes de tentar novamente.';

      case 'verification_progressive':
        return 'Muitas tentativas incorretas. Sua conta foi temporariamente bloqueada por segurança.';

      case 'verification_ip':
        return 'Muitas tentativas de verificação deste IP. Aguarde 1 hora antes de tentar novamente.';

      case 'medium':
        return 'Limite de requisições excedido. Por favor, aguarde antes de continuar.';

      case 'long':
        if (endpoint === 'getCurrentUser') {
          return 'Muitas consultas ao perfil do usuário. Aguarde alguns momentos antes de tentar novamente.';
        }
        return 'Você excedeu o limite de requisições. Tente novamente em alguns momentos.';

      case 'file_upload':
        return 'Muitos uploads de arquivo. Por favor, aguarde um pouco antes de enviar mais arquivos.';

      case 'custom':
        if (endpoint.includes('upload')) {
          return 'Limite de uploads excedido. Aguarde alguns momentos antes de enviar mais arquivos.';
        }
        return 'Limite de requisições excedido. Por favor, tente novamente mais tarde.';

      case 'default':
        return 'Limite de requisições excedido. Por favor, tente novamente mais tarde.';

      default:
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[CustomThrottlerGuard] Unknown throttler: ${throttlerName} for endpoint: ${endpoint}`,
          );
        }
        return 'Limite de requisições excedido. Por favor, tente novamente mais tarde.';
    }
  }
}
