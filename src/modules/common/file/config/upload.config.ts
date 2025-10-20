import { diskStorage } from 'multer';
import { BadRequestException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { WebDAVFolderMapping } from '../services/webdav.service';

// Upload configuration
export const UPLOAD_CONFIG = {
  // Maximum file size (default: 100MB)
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600'), // 100MB in bytes

  // Upload directory (temporary staging before WebDAV)
  uploadDir: process.env.UPLOAD_DIR || './uploads',

  // WebDAV configuration
  useWebDAV: process.env.USE_WEBDAV === 'true' || true, // Enable WebDAV by default
  webdavRoot: process.env.WEBDAV_ROOT || './uploads/webdav', // Use relative path for development, production sets WEBDAV_ROOT to /srv/webdav

  // Allowed file types (MIME types)
  allowedMimeTypes: [
    // Images
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'image/tiff',

    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/rtf',

    // Archives
    'application/zip',
    'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'application/gzip',

    // Audio
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'audio/mp4',
    'audio/x-wav',
    'audio/aac',

    // Video
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
    'video/x-ms-wmv',

    // CAD and specialized files
    'application/octet-stream', // For generic binary files
    'application/dxf',
    'application/x-dxf',
    'image/vnd.dxf',
    'application/vnd.corel-draw',
    'application/x-corel-draw',
    'application/cdr',
    'application/x-cdr',
    'image/cdr',
    'image/x-cdr',

    // EPS files
    'application/postscript',
    'application/x-eps',
    'application/eps',
    'image/eps',
    'image/x-eps',
  ],

  // File extensions to MIME type mapping for validation
  extensionToMimeType: {
    // Images
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',

    // Documents
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.rtf': 'application/rtf',

    // Archives
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
    '.gz': 'application/gzip',

    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.webm': 'audio/webm',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',

    // Video
    '.mp4': 'video/mp4',
    '.mpeg': 'video/mpeg',
    '.mpg': 'video/mpeg',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.wmv': 'video/x-ms-wmv',

    // EPS files
    '.eps': 'application/postscript',
    '.ai': 'application/postscript',

    // CAD and cut files
    '.dxf': 'application/dxf',
    '.cdr': 'application/vnd.corel-draw',
  },
};

// File filter function
export const fileFilter = (req: any, file: Express.Multer.File, callback: Function) => {
  // Check if file type is allowed
  if (!UPLOAD_CONFIG.allowedMimeTypes.includes(file.mimetype)) {
    const error = new BadRequestException(`Tipo de arquivo não permitido: ${file.mimetype}`);
    return callback(error, false);
  }

  // Additional extension validation
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext && UPLOAD_CONFIG.extensionToMimeType[ext]) {
    const expectedMimeType = UPLOAD_CONFIG.extensionToMimeType[ext];
    if (expectedMimeType !== file.mimetype) {
      const error = new BadRequestException(
        `Extensão do arquivo (${ext}) não corresponde ao tipo MIME (${file.mimetype})`,
      );
      return callback(error, false);
    }
  }

  callback(null, true);
};

// Storage configuration - now uses temporary directory for staging
export const storageConfig = diskStorage({
  destination: (req, file, callback) => {
    try {
      // Use a temporary staging directory before moving to WebDAV
      const tempDir = path.join(UPLOAD_CONFIG.uploadDir, 'temp');

      console.log('🗂️ File upload staging destination:', {
        tempDir: tempDir,
        originalFilename: file.originalname,
        useWebDAV: UPLOAD_CONFIG.useWebDAV,
      });

      // Ensure the temporary directory exists
      if (!fs.existsSync(tempDir)) {
        console.log('📁 Creating temp staging directory:', tempDir);
        fs.mkdirSync(tempDir, { recursive: true });
      } else {
        console.log('✅ Temp staging directory exists:', tempDir);
      }

      console.log('✅ Using temp staging path:', tempDir);
      callback(null, tempDir);
    } catch (error) {
      console.error('❌ Error creating temp staging directory:', error);
      // Fallback to base upload directory
      console.log('🔄 Falling back to base directory:', UPLOAD_CONFIG.uploadDir);
      callback(null, UPLOAD_CONFIG.uploadDir);
    }
  },
  filename: (req, file, callback) => {
    // Generate unique filename with UUID + original extension
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${uuidv4()}${ext}`;
    callback(null, filename);
  },
});

// Multer configuration
export const multerConfig = {
  storage: storageConfig,
  fileFilter: fileFilter,
  limits: {
    fileSize: UPLOAD_CONFIG.maxFileSize, // 100MB per file
    files: 10, // Maximum 10 files at once
    fields: 100, // Maximum number of non-file fields
    fieldNameSize: 100, // Maximum field name size in bytes
    fieldSize: 1024 * 1024, // Maximum field value size: 1MB (for JSON strings)
    parts: 1000, // Maximum number of parts (fields + files)
    headerPairs: 2000, // Maximum number of header key-value pairs
  },
};

// Helper function to generate public URL (supports both upload and WebDAV paths)
export function generateFileUrl(filename: string, filePath: string): string {
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:3030';
  const webdavBaseUrl = process.env.WEBDAV_BASE_URL || 'https://arquivos.ankaa.live';

  // Check if file is in WebDAV structure
  if (UPLOAD_CONFIG.useWebDAV && filePath.includes(UPLOAD_CONFIG.webdavRoot)) {
    // Generate WebDAV URL
    const relativePath = filePath.replace(UPLOAD_CONFIG.webdavRoot, '').replace(/\\/g, '/');
    const cleanPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
    return `${webdavBaseUrl}${cleanPath}`;
  }

  // Fallback to traditional upload path
  const relativePath = filePath.replace(UPLOAD_CONFIG.uploadDir, '').replace(/\\/g, '/');
  const cleanPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return `${baseUrl}/api/files/static${cleanPath}`;
}

// Helper function to validate file size
export function validateFileSize(size: number): boolean {
  return size > 0 && size <= UPLOAD_CONFIG.maxFileSize;
}

// Helper function to get MIME type from extension
export function getMimeTypeFromExtension(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  return UPLOAD_CONFIG.extensionToMimeType[ext] || null;
}

// Helper function to get current date path (YY/M/DD format)
export function getCurrentDatePath(): string {
  const date = new Date();
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1);
  const day = String(date.getDate());

  return path.join(year, month, day);
}

// Helper function to get full upload path for current date
export function getCurrentUploadPath(): string {
  return path.join(UPLOAD_CONFIG.uploadDir, getCurrentDatePath());
}
