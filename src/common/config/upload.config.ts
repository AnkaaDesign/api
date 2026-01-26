import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { BadRequestException, Logger } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import {
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
  unlinkSync,
  promises as fsPromises,
} from 'fs';
import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * File type detection by magic bytes (file signatures)
 * This provides security by validating actual file content, not just extensions
 */
const FILE_SIGNATURES: Record<string, Buffer[]> = {
  'image/jpeg': [
    Buffer.from([0xff, 0xd8, 0xff]), // JPEG
  ],
  'image/png': [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG
  ],
  'image/gif': [
    Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), // GIF87a
    Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), // GIF89a
  ],
  'image/webp': [
    Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF (first 4 bytes)
  ],
  'application/pdf': [
    Buffer.from([0x25, 0x50, 0x44, 0x46]), // %PDF
  ],
  'text/plain': [
    // Text files are harder to detect by magic bytes, allow based on content validation
  ],
  'application/msword': [
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), // MS Office legacy
  ],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]), // ZIP signature (DOCX is ZIP)
    Buffer.from([0x50, 0x4b, 0x05, 0x06]), // ZIP empty archive
  ],
  'video/mp4': [
    Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]), // ftyp
    Buffer.from([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70]), // ftyp variant
    Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]), // ftyp variant
  ],
  'video/quicktime': [
    Buffer.from([0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74]), // ftypqt
  ],
  'video/webm': [
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), // WebM/MKV
  ],
  'video/x-matroska': [
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), // WebM/MKV
  ],
  'video/x-msvideo': [
    Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF (first 4 bytes, followed by AVI)
  ],
};

/**
 * Validate file type by checking magic bytes
 */
function validateFileType(buffer: Buffer, mimeType: string): boolean {
  const signatures = FILE_SIGNATURES[mimeType];
  if (!signatures || signatures.length === 0) {
    // For text files and other formats without clear signatures,
    // rely on extension and content validation
    return true;
  }

  return signatures.some(signature => {
    if (signature.length === 0) return true; // Allow if no signature defined
    return buffer.subarray(0, signature.length).equals(signature);
  });
}

/**
 * Sanitize filename to prevent security issues
 */
function sanitizeFilename(originalname: string): string {
  // Remove path separators and dangerous characters
  // eslint-disable-next-line no-control-regex
  let sanitized = originalname
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove invalid characters
    .replace(/^\.+/, '') // Remove leading dots
    .replace(/\.+$/, '') // Remove trailing dots
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .substring(0, 255); // Limit length

  // Prevent directory traversal attempts
  sanitized = sanitized.replace(/\.\./g, '');

  // Ensure filename is not empty after sanitization
  if (!sanitized.trim()) {
    sanitized = 'file';
  }

  return sanitized;
}

/**
 * Ensure upload directory exists and is writable
 */
function ensureUploadDirectory(uploadPath: string): void {
  const logger = new Logger('UploadConfig');

  try {
    if (!existsSync(uploadPath)) {
      mkdirSync(uploadPath, { recursive: true });
      logger.log(`Created upload directory: ${uploadPath}`);
    }

    // Check if directory is writable
    const stats = statSync(uploadPath);
    if (!stats.isDirectory()) {
      throw new Error(`Upload path is not a directory: ${uploadPath}`);
    }

    // Test write permission by creating a temporary file
    const testFile = join(uploadPath, `.write-test-${Date.now()}`);
    writeFileSync(testFile, 'test');
    unlinkSync(testFile);

    logger.log(`Upload directory is ready: ${uploadPath}`);
  } catch (error) {
    logger.error(`Failed to prepare upload directory: ${error.message}`);
    throw new Error(`Upload directory setup failed: ${error.message}`);
  }
}

/**
 * Check available disk space
 */
function checkDiskSpace(uploadPath: string, fileSize: number): void {
  try {
    const _stats = statSync(uploadPath);
    // This is a basic check - in production, you might want to use a library
    // like 'check-disk-space' for more accurate disk space checking

    // For now, we'll just check if the file size is reasonable
    const maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '52428800'); // 50MB default
    const availableSpace = maxFileSize * 10; // Assume we have at least 10x the max file size

    if (fileSize > availableSpace) {
      throw new BadRequestException('Espaço em disco insuficiente para upload');
    }
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    // If we can't check disk space, log warning but don't fail
    const logger = new Logger('UploadConfig');
    logger.warn(`Could not check disk space: ${(error as Error).message}`);
  }
}

/**
 * Upload configuration factory
 */
export function createUploadConfig(): MulterOptions {
  const uploadPath = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
  const maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '52428800'); // 50MB
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'video/mp4',
    'video/quicktime',      // .mov
    'video/x-msvideo',      // .avi
    'video/webm',
    'video/x-matroska',     // .mkv
  ];

  // Ensure upload directory exists
  ensureUploadDirectory(uploadPath);

  return {
    storage: diskStorage({
      destination: (req: Request, file: Express.Multer.File, cb) => {
        try {
          // Check disk space before accepting file
          checkDiskSpace(uploadPath, file.size || maxFileSize);
          cb(null, uploadPath);
        } catch (error) {
          cb(error as Error, '');
        }
      },
      filename: (req: Request, file: Express.Multer.File, cb) => {
        try {
          // Generate secure filename
          const sanitizedName = sanitizeFilename(file.originalname);
          const uuid = uuidv4();
          const timestamp = Date.now();

          // Create unique filename: timestamp_uuid_originalname
          const filename = `${timestamp}_${uuid}_${sanitizedName}`;

          cb(null, filename);
        } catch (error) {
          cb(error as Error, '');
        }
      },
    }),

    limits: {
      fileSize: maxFileSize,
      files: 10, // Max 10 files per request
      fields: 20, // Max form fields
      fieldNameSize: 100, // Max field name length
      fieldSize: 1024 * 1024, // 1MB max field value size
    },

    fileFilter: (req: Request, file: Express.Multer.File, cb) => {
      const logger = new Logger('FileUpload');

      try {
        // Check MIME type
        if (!allowedMimeTypes.includes(file.mimetype)) {
          logger.warn(`Rejected file with invalid MIME type: ${file.mimetype}`);
          return cb(
            new BadRequestException(`Tipo de arquivo não permitido: ${file.mimetype}`),
            false,
          );
        }

        // Additional filename validation
        if (!file.originalname || file.originalname.trim().length === 0) {
          return cb(new BadRequestException('Nome do arquivo é obrigatório'), false);
        }

        // Check for suspicious file extensions
        const suspiciousExtensions = [
          '.exe',
          '.bat',
          '.cmd',
          '.scr',
          '.pif',
          '.com',
          '.dll',
          '.vbs',
          '.js',
        ];
        const fileExt = extname(file.originalname).toLowerCase();
        if (suspiciousExtensions.includes(fileExt)) {
          logger.warn(`Rejected file with suspicious extension: ${fileExt}`);
          return cb(
            new BadRequestException(`Extensão de arquivo não permitida: ${fileExt}`),
            false,
          );
        }

        // Log successful validation
        logger.log(`File accepted: ${file.originalname} (${file.mimetype})`);
        cb(null, true);
      } catch (error) {
        logger.error(`File validation error: ${(error as Error).message}`);
        cb(error as Error, false);
      }
    },
  };
}

/**
 * Validate file content after upload by reading magic bytes
 */
export async function validateUploadedFile(
  filePath: string,
  expectedMimeType: string,
): Promise<boolean> {
  const logger = new Logger('FileValidator');

  try {
    // Read first 32 bytes to check file signature
    const fileHandle = await fsPromises.open(filePath, 'r');
    const buffer = Buffer.alloc(32);
    await fileHandle.read(buffer, 0, 32, 0);
    await fileHandle.close();

    const isValid = validateFileType(buffer, expectedMimeType);

    if (!isValid) {
      logger.warn(`File content validation failed for ${filePath}: expected ${expectedMimeType}`);
    }

    return isValid;
  } catch (error) {
    logger.error(`Error validating file content: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Clean up temporary files older than specified age
 */
export async function cleanupTemporaryFiles(
  uploadPath: string,
  maxAgeMs: number = 24 * 60 * 60 * 1000, // 24 hours default
): Promise<void> {
  const logger = new Logger('FileCleanup');

  try {
    const files = await fsPromises.readdir(uploadPath);
    const now = Date.now();
    let cleanedCount = 0;

    for (const file of files) {
      const filePath = join(uploadPath, file);
      const stats = await fsPromises.stat(filePath);

      // Skip if not a file
      if (!stats.isFile()) continue;

      // Check if file is old enough to clean
      const fileAge = now - stats.mtime.getTime();
      if (fileAge > maxAgeMs) {
        // Check if file is a temporary file (contains timestamp in name)
        if (file.includes('_') && /^\d+_/.test(file)) {
          await fsPromises.unlink(filePath);
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      logger.log(`Cleaned up ${cleanedCount} temporary files older than ${maxAgeMs}ms`);
    }
  } catch (error) {
    logger.error(`Error cleaning up temporary files: ${(error as Error).message}`);
  }
}

/**
 * Get upload statistics
 */
export async function getUploadStats(uploadPath: string): Promise<{
  totalFiles: number;
  totalSize: number;
  oldestFile: Date | null;
  newestFile: Date | null;
}> {
  const logger = new Logger('UploadStats');

  try {
    const files = await fsPromises.readdir(uploadPath);

    let totalFiles = 0;
    let totalSize = 0;
    let oldestFile: Date | null = null;
    let newestFile: Date | null = null;

    for (const file of files) {
      const filePath = join(uploadPath, file);
      const stats = await fsPromises.stat(filePath);

      if (stats.isFile()) {
        totalFiles++;
        totalSize += stats.size;

        if (!oldestFile || stats.mtime < oldestFile) {
          oldestFile = stats.mtime;
        }

        if (!newestFile || stats.mtime > newestFile) {
          newestFile = stats.mtime;
        }
      }
    }

    return {
      totalFiles,
      totalSize,
      oldestFile,
      newestFile,
    };
  } catch (error) {
    logger.error(`Error getting upload stats: ${(error as Error).message}`);
    return {
      totalFiles: 0,
      totalSize: 0,
      oldestFile: null,
      newestFile: null,
    };
  }
}
