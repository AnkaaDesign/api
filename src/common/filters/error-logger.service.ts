import { Injectable, Logger } from '@nestjs/common';

export interface ErrorLogContext {
  requestId: string;
  method: string;
  url: string;
  ip?: string;
  userAgent?: string;
  body?: any;
  user?: string;
  statusCode: number;
  error: string;
  exception: any;
}

@Injectable()
export class ErrorLoggerService {
  private readonly logger = new Logger('ErrorLogger');

  logError(context: ErrorLogContext): void {
    const { statusCode, requestId, method, url, error } = context;

    // Format log message
    const message = `[${requestId}] ${method} ${url} - ${statusCode} ${error}`;

    // Create structured log data
    const logData = {
      timestamp: new Date().toISOString(),
      requestId,
      request: {
        method,
        url,
        ip: context.ip,
        userAgent: context.userAgent,
        body: context.body,
        user: context.user,
      },
      response: {
        statusCode,
        error,
      },
      exception: this.formatException(context.exception),
    };

    // Log based on status code
    if (statusCode >= 500) {
      this.logger.error(message, JSON.stringify(logData, null, 2));
    } else if (statusCode >= 400) {
      this.logger.warn(message, JSON.stringify(logData, null, 2));
    } else {
      this.logger.log(message, JSON.stringify(logData, null, 2));
    }
  }

  private formatException(exception: any): any {
    if (!exception) return null;

    if (exception instanceof Error) {
      return {
        name: exception.name,
        message: exception.message,
        stack: exception.stack?.split('\n').slice(0, 5), // Limit stack trace
      };
    }

    return exception;
  }
}
