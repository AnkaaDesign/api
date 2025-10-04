import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ErrorLoggerService } from './error-logger.service';
import { AuthenticatedRequest, HttpExceptionResponse } from '../../types/express.types';

interface ErrorResponse {
  success: false;
  message: string;
  error: string;
  timestamp?: string;
  path?: string;
  method?: string;
  requestId?: string;
  details?: any;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly errorLogger = new ErrorLoggerService();
  private readonly isDevelopment = process.env.NODE_ENV === 'development';

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<AuthenticatedRequest>();
    const requestId = uuidv4();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorResponse: ErrorResponse = {
      success: false,
      message: 'Ocorreu um erro inesperado. Por favor, tente novamente.',
      error: 'UNKNOWN_ERROR',
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      requestId,
    };

    // Handle different error types
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        errorResponse.message = exceptionResponse;
        errorResponse.error = exception.constructor.name
          .toUpperCase()
          .replace('EXCEPTION', '_ERROR');
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as HttpExceptionResponse;
        errorResponse.message = Array.isArray(responseObj.message)
          ? responseObj.message.join('; ')
          : responseObj.message || errorResponse.message;
        errorResponse.error =
          responseObj.error ||
          exception.constructor.name.toUpperCase().replace('EXCEPTION', '_ERROR');

        // Include validation errors in development
        if (this.isDevelopment && responseObj.message && Array.isArray(responseObj.message)) {
          errorResponse.details = responseObj.message;
        }
      }
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      errorResponse.message = 'Dados inválidos fornecidos.';
      errorResponse.error = 'VALIDATION_ERROR';

      // Format Zod errors
      const formattedErrors = exception.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      if (this.isDevelopment) {
        errorResponse.details = formattedErrors;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Handle Prisma errors
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          errorResponse.message = 'Registro duplicado. Verifique os dados únicos.';
          errorResponse.error = 'UNIQUE_CONSTRAINT_VIOLATION';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Referência inválida. Verifique os dados relacionados.';
          errorResponse.error = 'FOREIGN_KEY_CONSTRAINT_VIOLATION';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          errorResponse.message = 'Registro não encontrado.';
          errorResponse.error = 'NOT_FOUND';
          break;
        case 'P2014':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Relacionamento inválido nos dados.';
          errorResponse.error = 'INVALID_RELATION';
          break;
        case 'P2015':
          status = HttpStatus.NOT_FOUND;
          errorResponse.message = 'Registro relacionado não encontrado.';
          errorResponse.error = 'RELATED_RECORD_NOT_FOUND';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Erro ao processar dados no banco.';
          errorResponse.error = 'DATABASE_ERROR';
      }

      if (this.isDevelopment) {
        errorResponse.details = {
          code: exception.code,
          meta: exception.meta,
        };
      }
    } else if (exception instanceof Error) {
      // Check for specific error types
      if (exception.name === 'TimeoutError' || exception.message.includes('timeout')) {
        status = HttpStatus.REQUEST_TIMEOUT;
        errorResponse.message = 'A operação excedeu o tempo limite. Por favor, tente novamente.';
        errorResponse.error = 'TIMEOUT_ERROR';
      } else if (exception.name === 'PayloadTooLargeError') {
        status = HttpStatus.PAYLOAD_TOO_LARGE;
        errorResponse.message = 'Dados enviados são muito grandes.';
        errorResponse.error = 'PAYLOAD_TOO_LARGE';
      } else if (exception.message.includes('rate limit')) {
        status = HttpStatus.TOO_MANY_REQUESTS;
        errorResponse.message = 'Muitas requisições. Por favor, aguarde um momento.';
        errorResponse.error = 'RATE_LIMIT_ERROR';
      } else {
        // Generic error handling
        errorResponse.message = 'Ocorreu um erro ao processar sua solicitação.';
        errorResponse.error = 'SERVER_ERROR';
      }

      // Only include error details in development
      if (this.isDevelopment) {
        errorResponse.details = {
          name: exception.name,
          message: exception.message,
        };
      }
    }

    // Log the error with full context
    this.errorLogger.logError({
      requestId,
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.get('user-agent'),
      body: this.sanitizeBody(request.body),
      user: request.user?.id,
      statusCode: status,
      error: errorResponse.error,
      exception,
    });

    // Send response
    response.status(status).json(errorResponse);
  }

  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const sensitiveFields = [
      'password',
      'senha',
      'token',
      'apiKey',
      'secret',
      'cpf',
      'cnpj',
      'pis',
    ];
    const sanitized = { ...body };

    Object.keys(sanitized).forEach(key => {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        sanitized[key] = this.sanitizeBody(sanitized[key]);
      }
    });

    return sanitized;
  }
}
