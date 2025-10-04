// packages/utils/src/file-utils.ts
// Enhanced file utilities with Brazilian formatting and MIME type support

import { formatNumberWithDecimals } from "./number";
import { getFileExtension, formatFileSize as formatFileSizeLegacy } from "./file";

// =====================
// Enhanced MIME Type Detection
// =====================

export const getFileTypeFromMime = (mimeType: string): string => {
  const type = mimeType.toLowerCase();

  // Image types
  if (type.startsWith("image/")) {
    return "image";
  }

  // Video types
  if (type.startsWith("video/")) {
    return "video";
  }

  // Audio types
  if (type.startsWith("audio/")) {
    return "audio";
  }

  // Document types
  if (
    type.includes("pdf") ||
    type.includes("msword") ||
    type.includes("wordprocessingml") ||
    type.includes("spreadsheetml") ||
    type.includes("presentationml") ||
    type.includes("opendocument") ||
    type.includes("rtf") ||
    type.includes("text/plain")
  ) {
    return "document";
  }

  // Archive types
  if (type.includes("zip") || type.includes("rar") || type.includes("7z") || type.includes("tar") || type.includes("gzip") || type.includes("bzip")) {
    return "archive";
  }

  // Code types
  if (type.includes("javascript") || type.includes("typescript") || type.includes("json") || type.includes("xml") || type.includes("html") || type.includes("css")) {
    return "code";
  }

  return "other";
};

// =====================
// Enhanced File Size Formatting (Brazilian)
// =====================

export const formatFileSizeBrazilian = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  // Use Brazilian number formatting with comma as decimal separator
  const formattedValue = formatNumberWithDecimals(value, 2, "pt-BR");
  return `${formattedValue} ${sizes[i]}`;
};

export const formatFileSizeCompactBrazilian = (bytes: number): string => {
  if (bytes === 0) return "0B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  const formattedValue = formatNumberWithDecimals(value, 1, "pt-BR");
  return `${formattedValue}${sizes[i]}`;
};

// =====================
// Enhanced File Type Validation with MIME Support
// =====================

export const isImageFile = (filename: string, mimeType?: string): boolean => {
  if (mimeType) {
    return getFileTypeFromMime(mimeType) === "image";
  }

  const imageExtensions = ["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp", "ico", "tiff", "tif", "avif", "heic", "heif"];
  const extension = getFileExtension(filename);
  return imageExtensions.includes(extension);
};

export const isPdfFile = (filename: string, mimeType?: string): boolean => {
  if (mimeType) {
    return mimeType.toLowerCase().includes("pdf");
  }

  return getFileExtension(filename) === "pdf";
};

export const isVideoFile = (filename: string, mimeType?: string): boolean => {
  if (mimeType) {
    return getFileTypeFromMime(mimeType) === "video";
  }

  const videoExtensions = ["mp4", "avi", "mov", "wmv", "flv", "webm", "mkv", "m4v", "3gp", "ogv", "m2v", "mpg", "mpeg"];
  const extension = getFileExtension(filename);
  return videoExtensions.includes(extension);
};

export const isAudioFile = (filename: string, mimeType?: string): boolean => {
  if (mimeType) {
    return getFileTypeFromMime(mimeType) === "audio";
  }

  const audioExtensions = ["mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus", "aiff", "au"];
  const extension = getFileExtension(filename);
  return audioExtensions.includes(extension);
};

export const isDocumentFile = (filename: string, mimeType?: string): boolean => {
  if (mimeType) {
    return getFileTypeFromMime(mimeType) === "document";
  }

  const documentExtensions = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "odt", "ods", "odp", "csv", "pages", "numbers", "key"];
  const extension = getFileExtension(filename);
  return documentExtensions.includes(extension);
};

export const isArchiveFile = (filename: string, mimeType?: string): boolean => {
  if (mimeType) {
    return getFileTypeFromMime(mimeType) === "archive";
  }

  const archiveExtensions = ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "lzma", "z"];
  const extension = getFileExtension(filename);
  return archiveExtensions.includes(extension);
};

// =====================
// Enhanced Filename Generation and Sanitization
// =====================

export const generateUniqueFilename = (
  originalFilename: string,
  existingFilenames: string[] = [],
  options: {
    preserveExtension?: boolean;
    separator?: string;
    maxLength?: number;
  } = {},
): string => {
  const { preserveExtension = true, separator = "_", maxLength = 255 } = options;

  const extension = preserveExtension ? getFileExtension(originalFilename) : "";
  const nameWithoutExt = preserveExtension && extension ? originalFilename.substring(0, originalFilename.lastIndexOf(".")) : originalFilename;

  let uniqueName = originalFilename;
  let counter = 1;

  while (existingFilenames.includes(uniqueName)) {
    const suffix = `${separator}${counter}`;

    if (preserveExtension && extension) {
      uniqueName = `${nameWithoutExt}${suffix}.${extension}`;
    } else {
      uniqueName = `${nameWithoutExt}${suffix}`;
    }

    // Check if name exceeds max length
    if (uniqueName.length > maxLength) {
      const maxNameLength = maxLength - suffix.length - (extension ? extension.length + 1 : 0);
      const truncatedName = nameWithoutExt.substring(0, maxNameLength);

      if (preserveExtension && extension) {
        uniqueName = `${truncatedName}${suffix}.${extension}`;
      } else {
        uniqueName = `${truncatedName}${suffix}`;
      }
    }

    counter++;
  }

  return uniqueName;
};

export const sanitizeFilename = (
  filename: string,
  options: {
    removeSpaces?: boolean;
    preserveCase?: boolean;
    maxLength?: number;
    allowUnicode?: boolean;
    replacement?: string;
  } = {},
): string => {
  const { removeSpaces = true, preserveCase = false, maxLength = 255, allowUnicode = true, replacement = "_" } = options;

  let sanitized = filename.trim();

  // Remove or replace dangerous characters
  if (allowUnicode) {
    // Allow Unicode characters but remove dangerous ones for file systems
    sanitized = sanitized.replace(/[<>:"/\\|?*\x00-\x1f]/g, replacement);
  } else {
    // Only allow ASCII alphanumeric, dots, hyphens, and underscores
    sanitized = sanitized.replace(/[^\w\s.-]/gi, replacement);
  }

  // Handle spaces
  if (removeSpaces) {
    sanitized = sanitized.replace(/\s+/g, replacement);
  } else {
    sanitized = sanitized.replace(/\s+/g, " ");
  }

  // Remove multiple consecutive separators
  const escapedReplacement = replacement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const multipleReplacementRegex = new RegExp(`${escapedReplacement}{2,}`, "g");
  sanitized = sanitized
    .replace(multipleReplacementRegex, replacement)
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".");

  // Remove leading/trailing separators
  const leadingTrailingRegex = new RegExp(`^[${escapedReplacement}.-]+|[${escapedReplacement}.-]+$`, "g");
  sanitized = sanitized.replace(leadingTrailingRegex, "");

  // Handle case
  if (!preserveCase) {
    sanitized = sanitized.toLowerCase();
  }

  // Truncate if necessary while preserving extension
  if (sanitized.length > maxLength) {
    const extension = getFileExtension(sanitized);
    if (extension) {
      const nameWithoutExt = sanitized.substring(0, sanitized.lastIndexOf("."));
      const maxNameLength = maxLength - extension.length - 1; // -1 for the dot

      if (maxNameLength > 0) {
        sanitized = `${nameWithoutExt.substring(0, maxNameLength)}.${extension}`;
      } else {
        sanitized = sanitized.substring(0, maxLength);
      }
    } else {
      sanitized = sanitized.substring(0, maxLength);
    }
  }

  return sanitized || "arquivo"; // Default name if everything was removed
};

// =====================
// Enhanced File Validation
// =====================

export const validateFileType = (
  filename: string,
  mimeType: string,
  allowedTypes: {
    extensions?: string[];
    mimeTypes?: string[];
    categories?: string[];
  },
): { valid: boolean; error?: string } => {
  const extension = getFileExtension(filename);
  const category = getFileTypeFromMime(mimeType);

  // Check extensions
  if (allowedTypes.extensions && allowedTypes.extensions.length > 0) {
    if (!allowedTypes.extensions.includes(extension)) {
      return {
        valid: false,
        error: `Tipo de arquivo não permitido. Extensões aceitas: ${allowedTypes.extensions.join(", ")}`,
      };
    }
  }

  // Check MIME types
  if (allowedTypes.mimeTypes && allowedTypes.mimeTypes.length > 0) {
    const isAllowed = allowedTypes.mimeTypes.some((allowed) => mimeType.toLowerCase().includes(allowed.toLowerCase()));

    if (!isAllowed) {
      return {
        valid: false,
        error: `Tipo de arquivo não permitido. Tipos aceitos: ${allowedTypes.mimeTypes.join(", ")}`,
      };
    }
  }

  // Check categories
  if (allowedTypes.categories && allowedTypes.categories.length > 0) {
    if (!allowedTypes.categories.includes(category)) {
      return {
        valid: false,
        error: `Categoria de arquivo não permitida. Categorias aceitas: ${allowedTypes.categories.join(", ")}`,
      };
    }
  }

  return { valid: true };
};

export const validateFileSize = (
  sizeInBytes: number,
  constraints: {
    maxSizeInMB?: number;
    minSizeInBytes?: number;
    useBrazilianFormat?: boolean;
  } = {},
): { valid: boolean; error?: string } => {
  const { maxSizeInMB = 100, minSizeInBytes = 1, useBrazilianFormat = true } = constraints;

  if (sizeInBytes < minSizeInBytes) {
    const minSizeFormatted = useBrazilianFormat ? formatFileSizeBrazilian(minSizeInBytes) : formatFileSizeLegacy(minSizeInBytes);

    return {
      valid: false,
      error: `Arquivo muito pequeno. Tamanho mínimo: ${minSizeFormatted}`,
    };
  }

  const maxSizeInBytes = maxSizeInMB * 1024 * 1024;
  if (sizeInBytes > maxSizeInBytes) {
    const maxSizeFormatted = useBrazilianFormat ? formatFileSizeBrazilian(maxSizeInBytes) : formatFileSizeLegacy(maxSizeInBytes);

    return {
      valid: false,
      error: `Arquivo muito grande. Tamanho máximo: ${maxSizeFormatted}`,
    };
  }

  return { valid: true };
};

// =====================
// File Icon Mapping
// =====================

export const getFileIconFromMime = (mimeType: string): string => {
  const type = mimeType.toLowerCase();

  // Specific file type icons (using common icon library names)
  if (type.includes("pdf")) return "file-pdf";
  if (type.includes("msword") || type.includes("wordprocessingml")) return "file-word";
  if (type.includes("spreadsheetml") || type.includes("ms-excel")) return "file-excel";
  if (type.includes("presentationml") || type.includes("ms-powerpoint")) return "file-powerpoint";
  if (type.includes("text/plain")) return "file-text";
  if (type.includes("json")) return "file-code";
  if (type.includes("xml") || type.includes("html")) return "file-code";
  if (type.includes("javascript") || type.includes("typescript")) return "file-code";
  if (type.includes("css")) return "file-code";
  if (type.includes("zip") || type.includes("rar") || type.includes("7z")) return "file-archive";

  // Category-based icons
  const category = getFileTypeFromMime(mimeType);
  const categoryIcons: Record<string, string> = {
    image: "file-image",
    video: "file-video",
    audio: "file-audio",
    document: "file-document",
    archive: "file-archive",
    code: "file-code",
    other: "file",
  };

  return categoryIcons[category] || "file";
};

export const getFileColorFromType = (mimeType: string): string => {
  const type = mimeType.toLowerCase();

  // Specific colors for common file types (using Tailwind CSS color names)
  if (type.includes("pdf")) return "red-600";
  if (type.includes("msword") || type.includes("wordprocessingml")) return "blue-600";
  if (type.includes("spreadsheetml") || type.includes("ms-excel")) return "green-600";
  if (type.includes("presentationml") || type.includes("ms-powerpoint")) return "orange-600";
  if (type.includes("image/")) return "purple-600";
  if (type.includes("video/")) return "pink-600";
  if (type.includes("audio/")) return "emerald-600";
  if (type.includes("text/")) return "gray-500";
  if (type.includes("json") || type.includes("javascript")) return "yellow-500";
  if (type.includes("css")) return "blue-400";
  if (type.includes("html")) return "orange-500";
  if (type.includes("zip") || type.includes("rar")) return "amber-700";

  return "gray-500"; // Default color
};

// Map MIME types to icon names for various icon libraries
export const MIME_TYPE_ICONS: Record<string, Record<string, string>> = {
  // FontAwesome icons
  fontawesome: {
    "application/pdf": "fa-file-pdf",
    "application/msword": "fa-file-word",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "fa-file-word",
    "application/vnd.ms-excel": "fa-file-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "fa-file-excel",
    "application/vnd.ms-powerpoint": "fa-file-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "fa-file-powerpoint",
    "text/plain": "fa-file-text",
    "application/json": "fa-file-code",
    "application/javascript": "fa-file-code",
    "text/css": "fa-file-code",
    "text/html": "fa-file-code",
    "application/zip": "fa-file-archive",
    "application/x-rar-compressed": "fa-file-archive",
    "image/*": "fa-file-image",
    "video/*": "fa-file-video",
    "audio/*": "fa-file-audio",
  },

  // Lucide icons
  lucide: {
    "application/pdf": "file-text",
    "application/msword": "file-text",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "file-text",
    "application/vnd.ms-excel": "file-spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "file-spreadsheet",
    "application/vnd.ms-powerpoint": "presentation",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "presentation",
    "text/plain": "file-text",
    "application/json": "file-code",
    "application/javascript": "file-code",
    "text/css": "file-code",
    "text/html": "file-code",
    "application/zip": "file-archive",
    "application/x-rar-compressed": "file-archive",
    "image/*": "image",
    "video/*": "video",
    "audio/*": "audio",
  },
};

export const getIconForMimeType = (mimeType: string, iconLibrary: "fontawesome" | "lucide" = "lucide"): string => {
  const icons = MIME_TYPE_ICONS[iconLibrary];

  // Try exact match first
  if (icons[mimeType]) {
    return icons[mimeType];
  }

  // Try category match
  const category = getFileTypeFromMime(mimeType);
  const categoryKey = `${category}/*`;
  if (icons[categoryKey]) {
    return icons[categoryKey];
  }

  // Default icon
  return iconLibrary === "fontawesome" ? "fa-file" : "file";
};

// =====================
// Thumbnail and URL Builders
// =====================

export const buildThumbnailUrl = (fileId: string, size: "xs" | "sm" | "md" | "lg" | "xl" = "md", baseUrl: string = "/api"): string => {
  const sizeParams: Record<string, string> = {
    xs: "64x64",
    sm: "128x128",
    md: "256x256",
    lg: "512x512",
    xl: "1024x1024",
  };

  return `${baseUrl}/files/${fileId}/thumbnail?size=${sizeParams[size]}`;
};

export const buildFileDownloadUrl = (fileId: string, filename?: string, baseUrl: string = "/api"): string => {
  const downloadUrl = `${baseUrl}/files/${fileId}/download`;
  return filename ? `${downloadUrl}?filename=${encodeURIComponent(filename)}` : downloadUrl;
};

export const buildFilePreviewUrl = (fileId: string, baseUrl: string = "/api"): string => {
  return `${baseUrl}/files/${fileId}/preview`;
};

// Note: The downloadFile function has been moved to the web app's utils
// as it requires browser-specific APIs (document)

// =====================
// File Processing Utilities
// =====================

export const getFileMetadata = (
  file: File,
): {
  name: string;
  size: number;
  type: string;
  category: string;
  extension: string;
  lastModified?: Date;
  isImage: boolean;
  isPdf: boolean;
  isVideo: boolean;
  isAudio: boolean;
  isDocument: boolean;
  isArchive: boolean;
  formattedSize: string;
  formattedSizeBrazilian: string;
} => {
  const extension = getFileExtension(file.name);
  const category = getFileTypeFromMime(file.type);

  return {
    name: file.name,
    size: file.size,
    type: file.type,
    category,
    extension,
    lastModified: new Date(file.lastModified),
    isImage: isImageFile(file.name, file.type),
    isPdf: isPdfFile(file.name, file.type),
    isVideo: isVideoFile(file.name, file.type),
    isAudio: isAudioFile(file.name, file.type),
    isDocument: isDocumentFile(file.name, file.type),
    isArchive: isArchiveFile(file.name, file.type),
    formattedSize: formatFileSizeLegacy(file.size),
    formattedSizeBrazilian: formatFileSizeBrazilian(file.size),
  };
};

export const createFileHash = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const generateUploadId = (): string => {
  return `upload_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
};

// =====================
// Comprehensive File Validation
// =====================

export const validateFile = (
  file: File,
  constraints: {
    maxSizeInMB?: number;
    minSizeInBytes?: number;
    allowedExtensions?: string[];
    allowedMimeTypes?: string[];
    allowedCategories?: string[];
    useBrazilianFormat?: boolean;
  } = {},
): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // Size validation
  const sizeValidation = validateFileSize(file.size, constraints);
  if (!sizeValidation.valid && sizeValidation.error) {
    errors.push(sizeValidation.error);
  }

  // Type validation
  const typeValidation = validateFileType(file.name, file.type, {
    extensions: constraints.allowedExtensions,
    mimeTypes: constraints.allowedMimeTypes,
    categories: constraints.allowedCategories,
  });
  if (!typeValidation.valid && typeValidation.error) {
    errors.push(typeValidation.error);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

// =====================
// Export Enhanced File Utils Object
// =====================

export const fileUtilsEnhanced = {
  // MIME type detection
  getFileTypeFromMime,

  // Size formatting (Brazilian)
  formatFileSizeBrazilian,
  formatFileSizeCompactBrazilian,

  // Enhanced type detection
  isImageFile,
  isPdfFile,
  isVideoFile,
  isAudioFile,
  isDocumentFile,
  isArchiveFile,

  // Enhanced filename handling
  generateUniqueFilename,
  sanitizeFilename,

  // Enhanced validation
  validateFileType,
  validateFileSize,
  validateFile,

  // Icon and color mapping
  getFileIconFromMime,
  getFileColorFromType,
  getIconForMimeType,
  MIME_TYPE_ICONS,

  // URL builders
  buildThumbnailUrl,
  buildFileDownloadUrl,
  buildFilePreviewUrl,

  // File processing
  getFileMetadata,
  createFileHash,
  generateUploadId,
};
