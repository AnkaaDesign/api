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
    const errorResponse: ErrorResponse = {
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
        case 'P2002': {
          status = HttpStatus.CONFLICT;
          errorResponse.error = 'UNIQUE_CONSTRAINT_VIOLATION';

          // Extract field name from Prisma meta
          const target = exception.meta?.target;
          let fieldName = 'campo';

          if (Array.isArray(target) && target.length > 0) {
            fieldName = target[0];
          } else if (typeof target === 'string') {
            fieldName = target;
          }

          // Provide specific Portuguese error messages for each unique field
          const uniqueFieldMessages: Record<string, string> = {
            email: 'Este email já está em uso.',
            phone: 'Este telefone já está em uso.',
            cpf: 'Este CPF já está cadastrado.',
            pis: 'Este PIS já está cadastrado.',
            payrollNumber: 'Este número da folha de pagamento já está em uso.',
            sessionToken: 'Este token de sessão já está em uso.',
            preferenceId: 'Esta preferência já está cadastrada.',
          };

          errorResponse.message =
            uniqueFieldMessages[fieldName] || 'Este valor já está em uso no sistema.';
          break;
        }
        case 'P2003': {
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Referência inválida. Verifique os dados relacionados.';
          errorResponse.error = 'FOREIGN_KEY_CONSTRAINT_VIOLATION';
          break;
        }
        case 'P2025': {
          status = HttpStatus.NOT_FOUND;
          errorResponse.message = 'Registro não encontrado.';
          errorResponse.error = 'NOT_FOUND';
          break;
        }
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
        case 'P2000':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'O valor fornecido é muito longo para o campo.';
          errorResponse.error = 'VALUE_TOO_LONG';
          break;
        case 'P2001':
          status = HttpStatus.NOT_FOUND;
          errorResponse.message = 'O registro pesquisado não existe.';
          errorResponse.error = 'RECORD_NOT_FOUND';
          break;
        case 'P2005':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Valor inválido para o tipo do campo.';
          errorResponse.error = 'INVALID_FIELD_VALUE';
          break;
        case 'P2006':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Valor fornecido é inválido.';
          errorResponse.error = 'INVALID_VALUE';
          break;
        case 'P2010':
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          errorResponse.message = 'Erro na consulta ao banco de dados.';
          errorResponse.error = 'RAW_QUERY_FAILED';
          break;
        case 'P2011':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Campo obrigatório não preenchido.';
          errorResponse.error = 'NULL_CONSTRAINT_VIOLATION';
          break;
        case 'P2012':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Campo obrigatório ausente.';
          errorResponse.error = 'MISSING_REQUIRED_VALUE';
          break;
        case 'P2016':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Erro na interpretação da consulta.';
          errorResponse.error = 'QUERY_INTERPRETATION_ERROR';
          break;
        case 'P2017':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Registros relacionados não estão conectados.';
          errorResponse.error = 'RECORDS_NOT_CONNECTED';
          break;
        case 'P2018':
          status = HttpStatus.NOT_FOUND;
          errorResponse.message = 'Registros conectados obrigatórios não foram encontrados.';
          errorResponse.error = 'REQUIRED_CONNECTED_RECORDS_NOT_FOUND';
          break;
        case 'P2019':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Erro de entrada de dados.';
          errorResponse.error = 'INPUT_ERROR';
          break;
        case 'P2021':
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          errorResponse.message = 'Tabela não encontrada no banco de dados.';
          errorResponse.error = 'TABLE_NOT_FOUND';
          break;
        case 'P2022':
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          errorResponse.message = 'Coluna não encontrada no banco de dados.';
          errorResponse.error = 'COLUMN_NOT_FOUND';
          break;
        case 'P2023':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Dados inconsistentes na coluna.';
          errorResponse.error = 'INCONSISTENT_COLUMN_DATA';
          break;
        case 'P2024':
          status = HttpStatus.SERVICE_UNAVAILABLE;
          errorResponse.message =
            'Tempo limite de conexão com o banco de dados excedido. Por favor, tente novamente.';
          errorResponse.error = 'CONNECTION_POOL_TIMEOUT';
          break;
        case 'P2026':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Recurso não suportado pelo banco de dados.';
          errorResponse.error = 'UNSUPPORTED_FEATURE';
          break;
        case 'P2027':
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          errorResponse.message = 'Múltiplos erros ocorreram durante a execução da consulta.';
          errorResponse.error = 'MULTIPLE_ERRORS';
          break;
        case 'P2028':
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          errorResponse.message = 'Erro na API de transações.';
          errorResponse.error = 'TRANSACTION_API_ERROR';
          break;
        case 'P2030':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Índice de busca não encontrado.';
          errorResponse.error = 'FULLTEXT_INDEX_NOT_FOUND';
          break;
        case 'P2033':
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Número muito grande para processar.';
          errorResponse.error = 'NUMBER_OUT_OF_RANGE';
          break;
        case 'P2034':
          status = HttpStatus.CONFLICT;
          errorResponse.message =
            'Conflito de transação. Por favor, tente novamente.';
          errorResponse.error = 'TRANSACTION_CONFLICT';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          errorResponse.message = 'Erro ao processar dados no banco.';
          errorResponse.error = `DATABASE_ERROR_${exception.code}`;
      }

      // Always include Prisma error code in details for debugging
      errorResponse.details = {
        code: exception.code,
        ...(this.isDevelopment && { meta: exception.meta }),
      };
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      errorResponse.message = 'Dados inválidos na requisição ao banco de dados.';
      errorResponse.error = 'DATABASE_VALIDATION_ERROR';

      if (this.isDevelopment) {
        errorResponse.details = {
          message: exception.message,
        };
      }
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      errorResponse.message = 'Erro de conexão com o banco de dados. Por favor, tente novamente.';
      errorResponse.error = 'DATABASE_CONNECTION_ERROR';
    } else if (exception instanceof Prisma.PrismaClientRustPanicError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      errorResponse.message = 'Erro interno do banco de dados. Por favor, tente novamente.';
      errorResponse.error = 'DATABASE_INTERNAL_ERROR';
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
