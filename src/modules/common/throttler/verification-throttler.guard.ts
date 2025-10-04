import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VerificationThrottlerService } from './verification-throttler.service';
import { SECTOR_PRIVILEGES } from '../../../constants';

// Metadata key for verification rate limiting
export const VERIFICATION_THROTTLE_KEY = 'verification_throttle';

// Decorator to apply verification rate limiting
export const VerificationThrottle = (options: { skipForAdmin?: boolean } = {}) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(VERIFICATION_THROTTLE_KEY, options, descriptor.value);
  };
};

@Injectable()
export class VerificationThrottlerGuard implements CanActivate {
  private readonly logger = new Logger(VerificationThrottlerGuard.name);

  constructor(
    private readonly verificationThrottler: VerificationThrottlerService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Check if this endpoint has verification throttling metadata
    const throttleOptions = this.reflector.get<{ skipForAdmin?: boolean }>(
      VERIFICATION_THROTTLE_KEY,
      context.getHandler(),
    );

    if (!throttleOptions) {
      return true; // No verification throttling configured
    }

    // Skip rate limiting for admin users if configured
    const user = request.user;
    if (
      throttleOptions.skipForAdmin &&
      user &&
      user.sector?.privileges === SECTOR_PRIVILEGES.ADMIN
    ) {
      return true;
    }

    const ip = this.getClientIp(request);
    const endpoint = this.getEndpointName(context);

    try {
      if (endpoint === 'verify' || endpoint === 'verifyCode' || endpoint === 'verifyPhone') {
        return await this.handleVerifyAttempt(request, response, ip);
      } else if (
        endpoint === 'sendVerification' ||
        endpoint === 'sendVerificationCode' ||
        endpoint === 'resendVerification' ||
        endpoint === 'resendSms'
      ) {
        return await this.handleSendAttempt(request, response, ip);
      }

      return true;
    } catch (error) {
      this.logger.error(`Verification throttle error: ${error.message}`);
      // If there's an error with the throttling service, allow the request but log it
      return true;
    }
  }

  private async handleVerifyAttempt(request: any, response: any, ip: string): Promise<boolean> {
    const { contact, code } = request.body;
    const contactMethod = contact || contact;

    if (!contactMethod || !code) {
      return true; // Let the endpoint handle validation
    }

    const result = await this.verificationThrottler.checkVerificationAttempt(
      contactMethod,
      code,
      ip,
    );

    if (!result.allowed) {
      // Set retry-after header
      if (result.retryAfter) {
        response.setHeader('Retry-After', Math.ceil(result.retryAfter / 1000));
        response.setHeader(
          'X-RateLimit-Reset',
          new Date(Date.now() + result.retryAfter).toISOString(),
        );
      }

      throw new BadRequestException(
        result.message || 'Muitas tentativas de verificação. Tente novamente mais tarde.',
      );
    }

    // Set rate limit headers for successful checks
    response.setHeader('X-Verification-Attempts-Remaining', '3'); // This would be dynamic in a real implementation

    return true;
  }

  private async handleSendAttempt(request: any, response: any, ip: string): Promise<boolean> {
    const { contact, phone } = request.body;
    const contactMethod = contact || contact || phone;

    if (!contactMethod) {
      return true; // Let the endpoint handle validation
    }

    const result = await this.verificationThrottler.checkCodeSendAttempt(contactMethod, ip);

    if (!result.allowed) {
      // Set retry-after header
      if (result.retryAfter) {
        response.setHeader('Retry-After', Math.ceil(result.retryAfter / 1000));
        response.setHeader(
          'X-RateLimit-Reset',
          new Date(Date.now() + result.retryAfter).toISOString(),
        );
      }

      throw new BadRequestException(
        result.message || 'Muitos códigos de verificação enviados. Tente novamente mais tarde.',
      );
    }

    return true;
  }

  private getClientIp(request: any): string {
    return (
      request.ip ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      request.headers?.['x-forwarded-for']?.split(',')[0] ||
      'unknown'
    );
  }

  private getEndpointName(context: ExecutionContext): string {
    return context.getHandler().name;
  }
}
