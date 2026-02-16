// packages/utils/src/file.ts

import type { File } from '@types';
import { FILE_ENTITY_TYPE, FILE_FORMAT } from '@constants';

import { FILE_ENTITY_TYPE_LABELS, FILE_FORMAT_LABELS } from '@constants';

export function getFileEntityTypeLabel(type: FILE_ENTITY_TYPE): string {
  return FILE_ENTITY_TYPE_LABELS[type] || type;
}

export function getFileFormatLabel(format: FILE_FORMAT): string {
  return FILE_FORMAT_LABELS[format] || format;
}

// =====================
// File Size Utilities
// =====================

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const formatFileSizeCompact = (bytes: number): string => {
  if (bytes === 0) return '0B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
};

export const bytesToMB = (bytes: number): number => bytes / (1024 * 1024);
export const bytesToKB = (bytes: number): number => bytes / 1024;
export const mbToBytes = (mb: number): number => mb * 1024 * 1024;
export const kbToBytes = (kb: number): number => kb * 1024;

// =====================
// File Type Detection
// =====================

export const getFileExtension = (filename: string): string => {
  const lastDot = filename.lastIndexOf('.');
  return lastDot !== -1 ? filename.substring(lastDot + 1).toLowerCase() : '';
};

export const getFileNameWithoutExtension = (filename: string): string => {
  const lastDot = filename.lastIndexOf('.');
  return lastDot !== -1 ? filename.substring(0, lastDot) : filename;
};

export const getFileCategory = (file: File): string => {
  return getFileCategoryFromExtension(getFileExtension(file.filename));
};

export const getFileCategoryFromExtension = (extension: string): string => {
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'];
  const documentExtensions = [
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'txt',
    'rtf',
    'odt',
    'ods',
    'odp',
  ];
  const videoExtensions = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'm4v'];
  const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a'];
  const archiveExtensions = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'];

  const ext = extension.toLowerCase();

  if (imageExtensions.includes(ext)) return 'image';
  if (documentExtensions.includes(ext)) return 'document';
  if (videoExtensions.includes(ext)) return 'video';
  if (audioExtensions.includes(ext)) return 'audio';
  if (archiveExtensions.includes(ext)) return 'archive';

  return 'other';
};

export const isImageFile = (file: File): boolean => getFileCategory(file) === 'image';
export const isDocumentFile = (file: File): boolean => getFileCategory(file) === 'document';
export const isVideoFile = (file: File): boolean => getFileCategory(file) === 'video';
export const isAudioFile = (file: File): boolean => getFileCategory(file) === 'audio';
export const isArchiveFile = (file: File): boolean => getFileCategory(file) === 'archive';

// =====================
// File Icons
// =====================

export const getFileIcon = (file: File): string => {
  const category = getFileCategory(file);
  return getFileCategoryIcon(category);
};

export const getFileCategoryIcon = (category: string): string => {
  const icons: Record<string, string> = {
    image: '🖼️',
    document: '📄',
    video: '🎥',
    audio: '🎵',
    archive: '📦',
    other: '📎',
  };
  return icons[category] || icons.other;
};

export const getFileIconClass = (file: File): string => {
  const category = getFileCategory(file);
  const classes: Record<string, string> = {
    image: 'file-image',
    document: 'file-document',
    video: 'file-video',
    audio: 'file-audio',
    archive: 'file-archive',
    other: 'file-other',
  };
  return classes[category] || classes.other;
};

// =====================
// File Validation
// =====================

export const isFileSizeValid = (file: File, maxSizeMB: number = 10): boolean => {
  return bytesToMB(file.size) <= maxSizeMB;
};

export const isFileTypeAllowed = (file: File, allowedTypes: string[]): boolean => {
  const extension = getFileExtension(file.filename);
  return allowedTypes.includes(extension);
};

export const validateFileUpload = (
  file: File,
  options: {
    maxSizeMB?: number;
    allowedTypes?: string[];
    allowedCategories?: string[];
  } = {},
): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  const { maxSizeMB = 10, allowedTypes, allowedCategories } = options;

  // Size validation
  if (!isFileSizeValid(file, maxSizeMB)) {
    errors.push(`Arquivo muito grande. Tamanho máximo: ${maxSizeMB}MB`);
  }

  // Type validation
  if (allowedTypes && !isFileTypeAllowed(file, allowedTypes)) {
    errors.push(`Tipo de arquivo não permitido. Tipos aceitos: ${allowedTypes.join(', ')}`);
  }

  // Category validation
  if (allowedCategories) {
    const category = getFileCategory(file);
    if (!allowedCategories.includes(category)) {
      errors.push(
        `Categoria de arquivo não permitida. Categorias aceitas: ${allowedCategories.join(', ')}`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

export const sanitizeFilename = (filename: string): string => {
  // Remove or replace invalid characters
  return filename
    .replace(/[^\w\s.-]/gi, '') // Remove special characters except word chars, spaces, dots, and hyphens
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
    .toLowerCase();
};

// =====================
// File URLs
// =====================

const getApiBaseUrl = (): string => {
  // Check for browser window object first (web environment)
  if (
    typeof globalThis !== 'undefined' &&
    typeof globalThis.window !== 'undefined' &&
    typeof (globalThis.window as any).__ANKAA_API_URL__ !== 'undefined'
  ) {
    return (globalThis.window as any).__ANKAA_API_URL__;
  }

  // Check for process.env in Node/React environments
  if (typeof process !== 'undefined' && process.env?.VITE_API_URL) {
    return process.env.VITE_API_URL;
  }

  // Check for server-side API_URL (set in .env for the API server)
  if (typeof process !== 'undefined' && process.env?.API_URL) {
    return process.env.API_URL;
  }

  // Default fallback for local development
  const port = (typeof process !== 'undefined' && process.env?.PORT) || '3030';
  return `http://localhost:${port}`;
};

export const getFileUrl = (file: File, baseUrl?: string): string => {
  const apiUrl = baseUrl || getApiBaseUrl();
  return `${apiUrl}/api/files/serve/${file.id}`;
};

export const getFileDownloadUrl = (file: File, baseUrl?: string): string => {
  const apiUrl = baseUrl || getApiBaseUrl();
  return `${apiUrl}/api/files/${file.id}/download`;
};

export const getFileThumbnailUrl = (
  file: File,
  size: 'small' | 'medium' | 'large' = 'medium',
  baseUrl?: string,
): string => {
  if (!isImageFile(file)) return '';
  const apiUrl = baseUrl || getApiBaseUrl();
  return `${apiUrl}/api/files/${file.id}/thumbnail/${size}`;
};

// =====================
// File Display
// =====================

export const formatFileDisplay = (file: File): string => {
  return `${file.filename} (${formatFileSize(file.size)})`;
};

export const formatFileFullDisplay = (file: File): string => {
  const category = getFileCategory(file);
  const icon = getFileIcon(file);
  return `${icon} ${file.filename} - ${formatFileSize(file.size)} - ${category}`;
};

export const formatFileInfo = (
  file: File,
): { name: string; size: string; type: string; category: string; icon: string } => {
  return {
    name: file.filename,
    size: formatFileSize(file.size),
    type: file.mimetype,
    category: getFileCategory(file),
    icon: getFileIcon(file),
  };
};

export const getFileDisplayName = (file: File, maxLength: number = 50): string => {
  if (file.filename.length <= maxLength) return file.filename;
  const extension = getFileExtension(file.filename);
  const nameWithoutExt = getFileNameWithoutExtension(file.filename);
  const truncatedName = nameWithoutExt.substring(0, maxLength - extension.length - 4) + '...';
  return extension ? `${truncatedName}.${extension}` : truncatedName;
};

// =====================
// File Operations
// =====================

export const generateUniqueFilename = (filename: string, existingFilenames: string[]): string => {
  if (!existingFilenames.includes(filename)) {
    return filename;
  }

  const extensionIndex = filename.lastIndexOf('.');
  const nameWithoutExt = extensionIndex !== -1 ? filename.substring(0, extensionIndex) : filename;
  const extension = extensionIndex !== -1 ? filename.substring(extensionIndex + 1) : '';

  let counter = 1;
  while (true) {
    const newFilename = extension
      ? `${nameWithoutExt}_${counter}.${extension}`
      : `${nameWithoutExt}_${counter}`;
    if (!existingFilenames.includes(newFilename)) {
      return newFilename;
    }
    counter++;
  }
};

export const groupFilesByDate = (
  files: File[],
  groupBy: 'day' | 'week' | 'month' = 'day',
): Record<string, File[]> => {
  const grouped: Record<string, File[]> = {};

  files.forEach(file => {
    const date = new Date(file.createdAt);
    let key: string;

    switch (groupBy) {
      case 'day':
        key = date.toISOString().split('T')[0];
        break;
      case 'week':
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split('T')[0];
        break;
      case 'month':
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        break;
    }

    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(file);
  });

  return grouped;
};

// =====================
// Export all utilities as a single object
// =====================

export const fileUtils = {
  // Size formatting
  formatFileSize,
  formatFileSizeCompact,
  bytesToMB,
  bytesToKB,
  mbToBytes,
  kbToBytes,

  // File type detection
  getFileExtension,
  getFileNameWithoutExtension,
  getFileCategory,
  getFileCategoryFromExtension,
  isImageFile,
  isDocumentFile,
  isVideoFile,
  isAudioFile,
  isArchiveFile,

  // Icons
  getFileIcon,
  getFileCategoryIcon,
  getFileIconClass,

  // Validation
  isFileSizeValid,
  isFileTypeAllowed,
  validateFileUpload,
  sanitizeFilename,

  // URLs
  getFileUrl,
  getFileDownloadUrl,
  getFileThumbnailUrl,

  // Display
  formatFileDisplay,
  formatFileFullDisplay,
  formatFileInfo,
  getFileDisplayName,

  // Operations
  generateUniqueFilename,
  groupFilesByDate,
};
