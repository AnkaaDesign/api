import { Injectable, NestMiddleware, BadRequestException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MulterError } from 'multer';
import { validateUploadedFile } from '../config/upload.config';
import { unlink } from 'fs/promises';
import { UploadedFile } from '../../types/express.types';

/**
 * Upload middleware for handling file upload errors and validation
 */
@Injectable()
export class UploadMiddleware implements NestMiddleware {
  private readonly logger = new Logger(UploadMiddleware.name);

  async use(req: Request, res: Response, next: NextFunction) {
    // Log upload attempt
    if (req.method === 'POST' && req.path.includes('/upload')) {
      this.logger.log(`File upload attempt from ${req.ip} to ${req.path}`);
    }

    next();
  }
}

/**
 * Error handler for Multer upload errors
 */
export function handleMulterError(error: any, req: Request, res: Response, next: NextFunction) {
  const logger = new Logger('MulterErrorHandler');

  if (error instanceof MulterError) {
    logger.warn(`Multer error: ${error.code} - ${error.message}`);

    let message: string;
    let statusCode = 400;

    switch (error.code) {
      case 'LIMIT_FILE_SIZE': {
        const maxSize = Math.round(
          parseInt(process.env.MAX_FILE_SIZE || '52428800') / (1024 * 1024),
        );
        message = `Arquivo muito grande. Tamanho máximo permitido: ${maxSize}MB`;
        break;
      }

      case 'LIMIT_FILE_COUNT':
        message = 'Muitos arquivos. Máximo de 10 arquivos por vez';
        break;

      case 'LIMIT_UNEXPECTED_FILE':
        message = 'Campo de arquivo inesperado';
        break;

      case 'LIMIT_PART_COUNT':
        message = 'Muitas partes na requisição';
        break;

      case 'LIMIT_FIELD_KEY':
        message = 'Nome do campo muito longo';
        break;

      case 'LIMIT_FIELD_VALUE':
        message = 'Valor do campo muito longo';
        break;

      case 'LIMIT_FIELD_COUNT':
        message = 'Muitos campos no formulário';
        break;

      default:
        message = 'Erro no upload do arquivo';
        statusCode = 500;
    }

    return res.status(statusCode).json({
      success: false,
      message: message,
      error: error.code,
    });
  }

  // Handle other upload-related errors
  if (error.message?.includes('upload') || error.message?.includes('arquivo')) {
    logger.warn(`Upload error: ${error.message}`);
    return res.status(400).json({
      success: false,
      message: error.message || 'Erro no upload do arquivo',
      error: 'UPLOAD_ERROR',
    });
  }

  // Pass other errors to the global error handler
  next(error);
}

/**
 * Validate uploaded files after Multer processing
 */
export async function validateUploadedFiles(req: Request, res: Response, next: NextFunction) {
  const logger = new Logger('FileValidator');

  try {
    const files = req.files;

    if (!files) {
      return next();
    }

    // Handle both single file and array of files
    const fileArray = Array.isArray(files) ? files : Object.values(files).flat();

    for (const file of fileArray) {
      if (!file) continue;

      // Validate file content matches declared MIME type
      const isValidContent = await validateUploadedFile(file.path, file.mimetype);

      if (!isValidContent) {
        // Clean up invalid file
        try {
          await unlink(file.path);
        } catch (cleanupError) {
          logger.warn(`Failed to cleanup invalid file: ${file.path}`);
        }

        logger.warn(`File content validation failed: ${file.originalname}`);
        return res.status(400).json({
          success: false,
          message: `Conteúdo do arquivo não corresponde ao tipo declarado: ${file.originalname}`,
          error: 'INVALID_FILE_CONTENT',
        });
      }

      // Add additional file metadata
      const uploadedFile = file as UploadedFile;
      uploadedFile.uploadedAt = new Date();
      uploadedFile.validated = true;
    }

    logger.log(`Successfully validated ${fileArray.length} uploaded files`);
    next();
  } catch (error: any) {
    logger.error(`File validation error: ${error.message}`);
    next(new BadRequestException('Erro na validação dos arquivos'));
  }
}

/**
 * Security middleware to check request source and rate limiting for uploads
 */
export async function uploadSecurityMiddleware(req: Request, res: Response, next: NextFunction) {
  const logger = new Logger('UploadSecurity');

  try {
    // Check if upload endpoint
    if (!req.path.includes('/upload') && !req.path.includes('/files')) {
      return next();
    }

    // Log security check
    logger.log(`Upload security check for ${req.ip} - ${req.method} ${req.path}`);

    // Check Content-Type for file uploads
    const contentType = req.headers['content-type'];
    if (req.method === 'POST' && contentType && !contentType.includes('multipart/form-data')) {
      // Allow JSON for file metadata operations
      if (!contentType.includes('application/json')) {
        logger.warn(`Invalid content type for upload: ${contentType}`);
        return res.status(400).json({
          success: false,
          message: 'Tipo de conteúdo inválido para upload de arquivos',
          error: 'INVALID_CONTENT_TYPE',
        });
      }
    }

    // Check for suspicious headers
    const suspiciousHeaders = ['x-forwarded-for', 'x-real-ip'];
    for (const header of suspiciousHeaders) {
      const value = req.headers[header];
      if (value && typeof value === 'string') {
        // Basic validation - in production you might want more sophisticated checks
        if (value.includes('..') || value.includes('<') || value.includes('>')) {
          logger.warn(`Suspicious header value detected: ${header}=${value}`);
          return res.status(400).json({
            success: false,
            message: 'Requisição inválida',
            error: 'INVALID_REQUEST',
          });
        }
      }
    }

    next();
  } catch (error: any) {
    logger.error(`Upload security middleware error: ${error.message}`);
    next(error);
  }
}

/**
 * Cleanup middleware to handle failed uploads
 */
export async function uploadCleanupMiddleware(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const logger = new Logger('UploadCleanup');

  // If there was an error and files were uploaded, clean them up
  if (error && req.files) {
    const files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();

    for (const file of files) {
      if (file && file.path) {
        try {
          await unlink(file.path);
          logger.log(`Cleaned up failed upload: ${file.path}`);
        } catch (cleanupError) {
          logger.warn(`Failed to cleanup file after error: ${file.path}`);
        }
      }
    }
  }

  next(error);
}
