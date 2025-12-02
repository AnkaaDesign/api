import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { AuthenticatedRequest, LoggerMethod, ExtendedLogger } from '../../types/express.types';

interface LogContext {
  requestId?: string;
  userId?: string;
  module?: string;
  method?: string;
  url?: string;
  ip?: string;
  userAgent?: string;
  [key: string]: string | number | boolean | undefined;
}

@Injectable()
export class LoggerService implements NestLoggerService {
  private logger: winston.Logger;
  private requestIdMap: Map<string, string> = new Map();

  constructor() {
    const isDevelopment = process.env.NODE_ENV === 'development';

    // Custom format for pretty printing in development
    const prettyPrint = winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
      const contextStr = context ? ` [${JSON.stringify(context)}]` : '';
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} [${level.toUpperCase()}]${contextStr}: ${message}${metaStr}`;
    });

    // Sensitive data filter
    const sensitiveFilter = winston.format(info => {
      // Clone the info object to avoid mutating the original
      const filtered = { ...info };

      // Function to recursively filter sensitive data
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filterSensitive = (obj: any): any => {
        if (typeof obj !== 'object' || obj === null) return obj;

        const sensitiveKeys = [
          'password',
          'senha',
          'token',
          'authorization',
          'cpf',
          'cnpj',
          'pis',
          'credit_card',
          'card_number',
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = Array.isArray(obj) ? [] : {};

        for (const key in obj) {
          const lowerKey = key.toLowerCase();
          if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
            result[key] = '[REDACTED]';
          } else if (key === 'cpf' || key === 'cnpj') {
            // Mask Brazilian documents
            result[key] = obj[key]
              ? `${obj[key].substring(0, 3)}*****${obj[key].substring(obj[key].length - 2)}`
              : obj[key];
          } else if (typeof obj[key] === 'object') {
            result[key] = filterSensitive(obj[key]);
          } else {
            result[key] = obj[key];
          }
        }

        return result;
      };

      filtered.context = filterSensitive(filtered.context);
      filtered.meta = filterSensitive(filtered.meta);

      return filtered;
    })();

    // Configure transports
    const transports: winston.transport[] = [];

    // Console transport for all environments
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          sensitiveFilter,
          isDevelopment ? prettyPrint : winston.format.json(),
        ),
      }),
    );

    // File transport for production
    if (!isDevelopment) {
      // Daily rotate file for all logs
      const fileRotateTransport = new DailyRotateFile({
        filename: 'logs/application-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
        format: winston.format.combine(
          winston.format.timestamp(),
          sensitiveFilter,
          winston.format.json(),
        ),
      });

      // Daily rotate file for errors only
      const errorFileRotateTransport = new DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        level: 'error',
        format: winston.format.combine(
          winston.format.timestamp(),
          sensitiveFilter,
          winston.format.json(),
        ),
      });

      transports.push(fileRotateTransport, errorFileRotateTransport);
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
      transports,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatMessage(message: any): string {
    if (typeof message === 'object') {
      return JSON.stringify(message);
    }
    return String(message);
  }

  private createContext(context?: string | LogContext, req?: AuthenticatedRequest): LogContext {
    const ctx: LogContext = {};

    if (typeof context === 'string') {
      ctx.module = context;
    } else if (context) {
      Object.assign(ctx, context);
    }

    if (req) {
      ctx.requestId = this.getRequestId(req);
      ctx.userId = req.user?.id;
      ctx.url = req.url;
      ctx.method = req.method;
      ctx.ip = req.ip || req.connection?.remoteAddress;
      ctx.userAgent = req.headers['user-agent'];
    }

    return ctx;
  }

  private getRequestId(req: AuthenticatedRequest): string {
    const requestId = req.id || (req.headers['x-request-id'] as string);
    if (requestId) return requestId;

    // Generate a new request ID if none exists
    const newId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    req.id = newId;
    return newId;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log(message: any, context?: string | LogContext): void {
    this.info(message, context);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error(message: any, trace?: string, context?: string | LogContext): void {
    const ctx = this.createContext(context);
    const errorInfo: Record<string, unknown> = {
      message: this.formatMessage(message),
      context: ctx,
    };

    if (trace) {
      errorInfo.stack = trace;
    }

    if (message instanceof Error) {
      errorInfo.message = message.message;
      errorInfo.stack = message.stack;
      errorInfo.name = message.name;
    }

    this.logger.error(errorInfo);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn(message: any, context?: string | LogContext): void {
    this.logger.warn({
      message: this.formatMessage(message),
      context: this.createContext(context),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info(message: any, context?: string | LogContext): void {
    this.logger.info({
      message: this.formatMessage(message),
      context: this.createContext(context),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug(message: any, context?: string | LogContext): void {
    this.logger.debug({
      message: this.formatMessage(message),
      context: this.createContext(context),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verbose(message: any, context?: string | LogContext): void {
    this.logger.verbose({
      message: this.formatMessage(message),
      context: this.createContext(context),
    });
  }

  // HTTP Request/Response logging
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logHttpRequest(req: AuthenticatedRequest, res: any, responseTime: number): void {
    const context: LogContext = {
      requestId: this.getRequestId(req),
      userId: req.user?.id,
      method: req.method,
      url: req.url,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'],
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
    };

    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    this.logger.log(level, 'HTTP Request', { context });
  }

  // Database query logging
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logDatabaseQuery(query: string, params: any[], duration: number, error?: Error): void {
    const context: Record<string, string | number | boolean> = {
      module: 'Database',
      query: query.substring(0, 1000), // Truncate long queries
      duration: `${duration}ms`,
      slow: duration > 1000,
    };

    if (error) {
      context.error = error.message;
      this.error('Database query failed', error.stack, context as LogContext);
    } else if (duration > 1000) {
      this.warn('Slow database query detected', context as LogContext);
    } else {
      this.debug('Database query executed', context as LogContext);
    }
  }

  // Create child logger with persistent context
  child(context: LogContext): LoggerService {
    const childLogger = new LoggerService();
    const originalMethods: LoggerMethod[] = ['log', 'error', 'warn', 'info', 'debug', 'verbose'];

    originalMethods.forEach(method => {
      const original = (childLogger as ExtendedLogger)[method].bind(childLogger);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (childLogger as ExtendedLogger)[method] = (message: any, additionalContext?: any) => {
        const mergedContext = { ...context, ...additionalContext };
        original(message, mergedContext);
      };
    });

    return childLogger;
  }
}
