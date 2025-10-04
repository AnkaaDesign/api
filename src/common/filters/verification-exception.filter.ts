// apps/api/src/common/filters/verification-exception.filter.ts

import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { VerificationError, getVerificationErrorDetails, getRetryTimeMessage } from '../../utils';
import { VERIFICATION_ERROR_CATEGORY, VERIFICATION_ERROR_SEVERITY } from '../../constants';

interface VerificationErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    category: string;
    severity: string;
    retryable: boolean;
    retryAfter?: number;
    retryTimeMessage?: string;
    suggestedActions?: string[];
    progressiveMessage?: string;
    technicalMessage?: string;
    helpUrl?: string;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
    contact?: string;
    verificationType?: string;
  };
}

@Catch(VerificationError)
export class VerificationExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(VerificationExceptionFilter.name);

  catch(exception: VerificationError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    // Get error details
    const details = exception.details;

    // Log error with context
    this.logError(exception, request);

    // Determine HTTP status based on error category and severity
    const httpStatus = this.getHttpStatus(exception);

    // Create response
    const errorResponse: VerificationErrorResponse = {
      success: false,
      error: {
        code: exception.code,
        message: exception.message,
        category: exception.category,
        severity: exception.severity,
        retryable: exception.retryable,
        retryAfter: exception.retryAfter,
        retryTimeMessage: exception.getRetryTimeMessage() || undefined,
        suggestedActions: details.suggestedActions,
        progressiveMessage: details.progressiveMessage,
        // Only include technical message in development
        ...(process.env.NODE_ENV === 'development' && {
          technicalMessage: details.technicalMessage,
        }),
        ...(details.helpUrl && { helpUrl: details.helpUrl }),
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: request.headers['x-request-id'],
        ...(exception.context?.contact && {
          contact: this.sanitizeContact(exception.context.contact),
        }),
        ...(exception.context?.verificationType && {
          verificationType: exception.context.verificationType,
        }),
      },
    };

    response.status(httpStatus).json(errorResponse);
  }

  private getHttpStatus(exception: VerificationError): HttpStatus {
    // Map error categories and severities to appropriate HTTP status codes
    switch (exception.category) {
      case VERIFICATION_ERROR_CATEGORY.VALIDATION:
        return HttpStatus.BAD_REQUEST;

      case VERIFICATION_ERROR_CATEGORY.AUTHENTICATION:
        switch (exception.severity) {
          case VERIFICATION_ERROR_SEVERITY.LOW:
            return HttpStatus.OK; // Already verified case
          default:
            return HttpStatus.UNAUTHORIZED;
        }

      case VERIFICATION_ERROR_CATEGORY.RATE_LIMITING:
        return HttpStatus.TOO_MANY_REQUESTS;

      case VERIFICATION_ERROR_CATEGORY.EXTERNAL_SERVICE:
        return HttpStatus.SERVICE_UNAVAILABLE;

      case VERIFICATION_ERROR_CATEGORY.SYSTEM:
        switch (exception.severity) {
          case VERIFICATION_ERROR_SEVERITY.CRITICAL:
            return HttpStatus.INTERNAL_SERVER_ERROR;
          default:
            return HttpStatus.SERVICE_UNAVAILABLE;
        }

      case VERIFICATION_ERROR_CATEGORY.SECURITY:
        switch (exception.severity) {
          case VERIFICATION_ERROR_SEVERITY.CRITICAL:
            return HttpStatus.FORBIDDEN;
          default:
            return HttpStatus.UNAUTHORIZED;
        }

      default:
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }

  private logError(exception: VerificationError, request: any) {
    const logContext = {
      errorCode: exception.code,
      category: exception.category,
      severity: exception.severity,
      message: exception.message,
      method: request.method,
      url: request.url,
      userAgent: request.headers['user-agent'],
      ip: request.ip || request.connection.remoteAddress,
      requestId: request.headers['x-request-id'],
      ...(exception.context && {
        contact: this.sanitizeContact(exception.context.contact),
        verificationType: exception.context.verificationType,
        attemptCount: exception.context.attemptCount,
        lastAttemptTime: exception.context.lastAttemptTime,
      }),
    };

    // Log based on severity
    switch (exception.severity) {
      case VERIFICATION_ERROR_SEVERITY.LOW:
        this.logger.log(`Verification info: ${exception.message}`, logContext);
        break;

      case VERIFICATION_ERROR_SEVERITY.MEDIUM:
        this.logger.warn(`Verification warning: ${exception.message}`, logContext);
        break;

      case VERIFICATION_ERROR_SEVERITY.HIGH:
        this.logger.error(`Verification error: ${exception.message}`, logContext);
        break;

      case VERIFICATION_ERROR_SEVERITY.CRITICAL:
        this.logger.error(
          `Critical verification error: ${exception.message}`,
          exception.stack,
          logContext,
        );
        break;

      default:
        this.logger.error(`Unknown verification error: ${exception.message}`, logContext);
    }

    // Additional logging for security-related errors
    if (exception.category === VERIFICATION_ERROR_CATEGORY.SECURITY) {
      this.logger.error(`SECURITY ALERT: ${exception.message}`, {
        ...logContext,
        alert: 'SECURITY_VERIFICATION_ERROR',
        timestamp: new Date().toISOString(),
      });
    }

    // Log rate limiting incidents for monitoring
    if (exception.category === VERIFICATION_ERROR_CATEGORY.RATE_LIMITING) {
      this.logger.warn(`RATE_LIMIT: ${exception.message}`, {
        ...logContext,
        alert: 'RATE_LIMIT_VERIFICATION',
        retryAfter: exception.retryAfter,
      });
    }
  }

  private sanitizeContact(contact?: string): string | undefined {
    if (!contact) return undefined;

    // Partially hide email
    if (contact.includes('@')) {
      const [localPart, domain] = contact.split('@');
      const maskedLocal =
        localPart.length > 2
          ? localPart.substring(0, 2) + '*'.repeat(localPart.length - 2)
          : '*'.repeat(localPart.length);
      return `${maskedLocal}@${domain}`;
    }

    // Partially hide phone number
    if (contact.length > 4) {
      return (
        contact.substring(0, 2) +
        '*'.repeat(contact.length - 4) +
        contact.substring(contact.length - 2)
      );
    }

    return '*'.repeat(contact.length);
  }
}
