import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { UPLOAD_CONFIG } from '../config/upload.config';

@Injectable()
export class EnsureUploadDirMiddleware implements NestMiddleware {
  private readonly logger = new Logger(EnsureUploadDirMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    // Ensure the base upload directory exists
    this.ensureDirectoryExists(UPLOAD_CONFIG.uploadDir);

    // For upload requests, also ensure the date-based directory exists (YY/M/DD format)
    if (req.path.includes('/upload')) {
      const date = new Date();
      const year = String(date.getFullYear()).slice(-2); // Get last 2 digits of year
      const month = String(date.getMonth() + 1); // No zero padding for month
      const day = String(date.getDate()); // No zero padding for day

      const dateDir = path.join(UPLOAD_CONFIG.uploadDir, year, month, day);
      this.ensureDirectoryExists(dateDir);
    }

    next();
  }

  private ensureDirectoryExists(dirPath: string): void {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        this.logger.log(`Created upload directory: ${dirPath}`);
      }
    } catch (error) {
      this.logger.error(`Failed to create upload directory ${dirPath}:`, error);
    }
  }
}
