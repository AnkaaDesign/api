import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Additional security headers not covered by Helmet

    // Expect-CT header for Certificate Transparency
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Expect-CT', 'max-age=86400, enforce');
    }

    // Clear-Site-Data header for logout endpoints
    if (req.path.includes('/auth/logout')) {
      res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"');
    }

    // Feature-Policy fallback for older browsers
    res.setHeader(
      'Feature-Policy',
      [
        "camera 'self'",
        "microphone 'none'",
        "geolocation 'self'",
        "payment 'none'",
        "usb 'none'",
        "bluetooth 'none'",
      ].join('; '),
    );

    // Custom security headers for the Ankaa application
    res.setHeader('X-Application-Name', 'Ankaa-API');
    res.setHeader('X-Security-Policy', 'strict');

    // Remove potentially sensitive headers
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');

    // Set custom server header
    res.setHeader('Server', 'Ankaa/1.0');

    // Timing headers for security monitoring
    res.setHeader('X-Request-Start', Date.now().toString());

    next();
  }
}

@Injectable()
export class SecurityValidationMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SecurityValidationMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    // Validate request headers for potential security issues

    // Check for suspicious user agents
    const userAgent = req.headers['user-agent'] || '';
    const suspiciousPatterns = [/sqlmap/i, /nikto/i, /nessus/i, /nmap/i, /burp/i, /owasp/i];

    if (suspiciousPatterns.some(pattern => pattern.test(userAgent))) {
      // Log suspicious activity
      this.logger.warn(`Suspicious user agent detected: ${userAgent} from IP: ${req.ip}`);

      // Add security warning header
      res.setHeader('X-Security-Warning', 'Suspicious activity detected');
    }

    // Check for suspicious headers
    const suspiciousHeaders = ['x-forwarded-host', 'x-host', 'x-forwarded-server'];

    for (const header of suspiciousHeaders) {
      if (req.headers[header]) {
        this.logger.warn(
          `Suspicious header detected: ${header} = ${req.headers[header]} from IP: ${req.ip}`,
        );
      }
    }

    // Validate content-length for potential attacks
    const contentLength = parseInt(req.headers['content-length'] || '0');
    const maxRequestSize = 50 * 1024 * 1024; // 50MB

    if (contentLength > maxRequestSize) {
      this.logger.warn(`Large request detected: ${contentLength} bytes from IP: ${req.ip}`);
      res.setHeader('X-Security-Warning', 'Large request detected');
    }

    // Rate limiting headers for transparency
    res.setHeader('X-RateLimit-Policy', 'strict');

    next();
  }
}
