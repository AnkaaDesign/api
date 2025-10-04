import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Interceptor to extract user information from JWT token and make it available
 * in a consistent format across all requests.
 *
 * This interceptor ensures that the userId is properly extracted from the JWT
 * payload and made available as req.user.id for consistency across the application.
 */
@Injectable()
export class UserContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // If user exists (added by AuthGuard), ensure it has the correct structure
    if (request.user && request.user.sub) {
      // Add id field for consistency (JWT standard uses 'sub' for subject/user ID)
      request.user.id = request.user.sub;

      // Add any other useful transformations here
      // For example, parsing role/privileges from sector if needed
    }

    return next.handle().pipe(
      map(data => {
        // You can also add user context to responses if needed
        return data;
      }),
    );
  }
}
