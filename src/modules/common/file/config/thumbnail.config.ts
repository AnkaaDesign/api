export interface ThumbnailConfig {
  // Redis Configuration
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };

  // Queue Configuration
  queue: {
    concurrency: number;
    timeout: number;
    maxRetries: number;
    retryDelay: number;
    removeOnComplete: number;
    removeOnFail: number;
  };

  // Thumbnail Generation Settings
  generation: {
    defaultWidth: number;
    defaultHeight: number;
    defaultQuality: number;
    defaultFormat: 'webp' | 'png' | 'jpg';
    maxFileSize: number; // in bytes
    epsDpi: number; // DPI for EPS rasterization
    epsHighResDpi: number; // DPI for high-res EPS thumbnails (xlarge, xxlarge)
  };

  // Tool Paths
  tools: {
    ffmpegPath?: string;
    ghostscriptPath?: string;
    imagemagickPath?: string;
    inkscapePath?: string;
  };

  // File Type Support
  supportedTypes: {
    images: string[];
    videos: string[];
    documents: string[];
  };
}

export const THUMBNAIL_CONFIG: ThumbnailConfig = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
  },

  queue: {
    concurrency: parseInt(process.env.THUMBNAIL_CONCURRENCY || '2'),
    timeout: parseInt(process.env.THUMBNAIL_TIMEOUT || '60000'), // 60 seconds
    maxRetries: parseInt(process.env.THUMBNAIL_MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.THUMBNAIL_RETRY_DELAY || '2000'), // 2 seconds
    removeOnComplete: parseInt(process.env.THUMBNAIL_KEEP_COMPLETED || '10'),
    removeOnFail: parseInt(process.env.THUMBNAIL_KEEP_FAILED || '50'),
  },

  generation: {
    defaultWidth: parseInt(process.env.THUMBNAIL_DEFAULT_WIDTH || '300'),
    defaultHeight: parseInt(process.env.THUMBNAIL_DEFAULT_HEIGHT || '300'),
    defaultQuality: parseInt(process.env.THUMBNAIL_DEFAULT_QUALITY || '100'),
    defaultFormat: (process.env.THUMBNAIL_DEFAULT_FORMAT as 'webp' | 'png' | 'jpg') || 'webp',
    maxFileSize: parseInt(process.env.THUMBNAIL_MAX_FILE_SIZE || (500 * 1024 * 1024).toString()), // 500MB
    epsDpi: parseInt(process.env.THUMBNAIL_EPS_DPI || '300'), // Standard DPI for EPS
    epsHighResDpi: parseInt(process.env.THUMBNAIL_EPS_HIGHRES_DPI || '600'), // High-res DPI for large EPS thumbnails
  },

  tools: {
    ffmpegPath: process.env.FFMPEG_PATH,
    ghostscriptPath: process.env.GHOSTSCRIPT_PATH,
    imagemagickPath: process.env.IMAGEMAGICK_PATH,
    inkscapePath: process.env.INKSCAPE_PATH,
  },

  supportedTypes: {
    images: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/tiff',
      'image/svg+xml',
    ],
    videos: [
      'video/mp4',
      'video/mpeg',
      'video/avi',
      'video/mov',
      'video/quicktime',
      'video/wmv',
      'video/x-ms-wmv',
      'video/flv',
      'video/x-flv',
      'video/webm',
      'video/mkv',
      'video/x-matroska',
      'video/x-msvideo',
      'video/m4v',
      'video/3gp',
    ],
    documents: [
      'application/pdf',
      'application/postscript',
      'application/x-eps',
      'application/eps',
      'image/eps',
      'image/x-eps',
    ],
  },
};

/**
 * Check if file type supports thumbnail generation
 */
export function isFileTypeSupported(mimetype: string): boolean {
  const allSupportedTypes = [
    ...THUMBNAIL_CONFIG.supportedTypes.images,
    ...THUMBNAIL_CONFIG.supportedTypes.videos,
    ...THUMBNAIL_CONFIG.supportedTypes.documents,
  ];

  return allSupportedTypes.some(type => mimetype.toLowerCase() === type.toLowerCase());
}

/**
 * Get file category by mimetype
 */
export function getFileCategory(mimetype: string): 'image' | 'video' | 'document' | 'unknown' {
  if (THUMBNAIL_CONFIG.supportedTypes.images.includes(mimetype.toLowerCase())) {
    return 'image';
  }
  if (THUMBNAIL_CONFIG.supportedTypes.videos.includes(mimetype.toLowerCase())) {
    return 'video';
  }
  if (THUMBNAIL_CONFIG.supportedTypes.documents.includes(mimetype.toLowerCase())) {
    return 'document';
  }
  return 'unknown';
}

/**
 * Get recommended priority for file type
 */
export function getRecommendedPriority(mimetype: string): 'low' | 'normal' | 'high' {
  const category = getFileCategory(mimetype);

  switch (category) {
    case 'image':
      // Images are fast to process, give them high priority
      return 'high';
    case 'video':
      // Videos are slow to process, give them low priority
      return 'low';
    case 'document':
      // Documents are medium complexity
      return 'normal';
    default:
      return 'normal';
  }
}
