import { Request as ExpressRequest, Response as ExpressResponse } from 'express';

// Extended Request interface with user information
export interface AuthenticatedRequest extends ExpressRequest {
  user?: {
    id: string;
    email?: string;
    name?: string;
    [key: string]: any;
  };
  id?: string; // Request ID for tracking
}

// Extended Response interface with locals
export interface ExtendedResponse extends ExpressResponse {
  locals: {
    [key: string]: any;
  };
}

// File interface with upload metadata
export interface UploadedFile extends Express.Multer.File {
  uploadedAt?: Date;
  validated?: boolean;
}

// HTTP Exception Response types
export interface HttpExceptionResponse {
  message: string | string[];
  error?: string;
  statusCode?: number;
  [key: string]: any;
}

// Winston Logger method types
export type LoggerMethod = 'log' | 'error' | 'warn' | 'info' | 'debug' | 'verbose';

// Logger function signature
export interface LoggerFunction {
  (message: any, additionalContext?: any): void;
}

// Enhanced winston logger with method overrides
export interface ExtendedLogger extends Record<LoggerMethod, LoggerFunction> {}
