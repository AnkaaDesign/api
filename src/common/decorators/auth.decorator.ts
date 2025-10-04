// Re-export auth decorators for centralized access
export { Public } from '@auth-decorators/public.decorator';
export { Roles } from '@auth-decorators/roles.decorator';
export { User, UserId, UserPayload } from '@auth-decorators/user.decorator';

// Composite decorator for authentication
import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@modules/common/auth/auth.guard';

export function Auth() {
  return applyDecorators(UseGuards(AuthGuard));
}