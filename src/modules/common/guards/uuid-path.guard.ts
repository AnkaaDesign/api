import {
  CanActivate,
  ExecutionContext,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class UUIDPathGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const params = request.params;

    for (const [key, value] of Object.entries(params)) {
      if (key === 'id' || key.endsWith('Id')) {
        if (typeof value === 'string' && !UUID_REGEX.test(value)) {
          throw new BadRequestException(`Invalid UUID format for parameter: ${key}`);
        }
      }
    }

    return true;
  }
}
