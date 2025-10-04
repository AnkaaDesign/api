// Auth related decorators
export { Auth } from './auth.decorator';
export { CurrentUser, UserId, UserPayload } from './current-user.decorator';
export { NoRateLimit, SkipThrottle } from './no-rate-limit.decorator';

// Re-export from auth module for convenience
export { Public } from '@auth-decorators/public.decorator';
export { Roles } from '@auth-decorators/roles.decorator';
export { User } from '@auth-decorators/user.decorator';

// Rate limiting decorators
import { Throttle } from '@nestjs/throttler';

export const ReadRateLimit = () => Throttle({ default: { limit: 100, ttl: 60000 } });
export const WriteRateLimit = () => Throttle({ default: { limit: 30, ttl: 60000 } });
export const CreateRateLimit = () => Throttle({ default: { limit: 10, ttl: 60000 } });
export const DeleteRateLimit = () => Throttle({ default: { limit: 5, ttl: 60000 } });