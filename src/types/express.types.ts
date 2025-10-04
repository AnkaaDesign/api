import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  id?: string;
  userId?: string;
  user?: any;
}

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  destination: string;
  filename: string;
  path: string;
  size: number;
  uploadedAt?: Date;
  validated?: boolean;
}

export interface HttpExceptionResponse {
  success: boolean;
  message: string;
  error?: any;
}

export type LoggerMethod = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'info';

export interface ExtendedLogger {
  log: (message: string, context?: string) => void;
  error: (message: string, trace?: string, context?: string) => void;
  warn: (message: string, context?: string) => void;
  debug: (message: string, context?: string) => void;
  verbose: (message: string, context?: string) => void;
}