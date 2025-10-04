/**
 * Comprehensive File Type Icon System for Ankaa Project
 *
 * Provides consistent file type icons using Tabler Icons with proper categorization,
 * color coding, and support for both web and mobile platforms.
 *
 * Features:
 * - 100+ file type mappings
 * - Color-coded categories
 * - Processing/error states
 * - Consistent sizing
 * - Brazilian context support
 */

// ===================
// File Categories
// ===================

export const FileCategory = {
  // Documents
  DOCUMENT_PDF: "document_pdf",
  DOCUMENT_TEXT: "document_text",
  DOCUMENT_WORD: "document_word",
  DOCUMENT_EXCEL: "document_excel",
  DOCUMENT_POWERPOINT: "document_powerpoint",
  DOCUMENT_OTHER: "document_other",

  // Images
  IMAGE_PHOTO: "image_photo",
  IMAGE_VECTOR: "image_vector",
  IMAGE_ICON: "image_icon",
  IMAGE_RAW: "image_raw",

  // Video
  VIDEO_STANDARD: "video_standard",
  VIDEO_HIGH_QUALITY: "video_high_quality",
  VIDEO_WEB: "video_web",

  // Audio
  AUDIO_MUSIC: "audio_music",
  AUDIO_PODCAST: "audio_podcast",
  AUDIO_RAW: "audio_raw",

  // Code & Development
  CODE_JAVASCRIPT: "code_javascript",
  CODE_TYPESCRIPT: "code_typescript",
  CODE_HTML: "code_html",
  CODE_CSS: "code_css",
  CODE_PYTHON: "code_python",
  CODE_JAVA: "code_java",
  CODE_JSON: "code_json",
  CODE_XML: "code_xml",
  CODE_OTHER: "code_other",

  // Archives
  ARCHIVE_ZIP: "archive_zip",
  ARCHIVE_RAR: "archive_rar",
  ARCHIVE_OTHER: "archive_other",

  // 3D & CAD
  CAD_AUTOCAD: "cad_autocad",
  CAD_3D_MODEL: "cad_3d_model",
  CAD_OTHER: "cad_other",

  // Special
  FONT: "font",
  DATABASE: "database",
  EXECUTABLE: "executable",
  UNKNOWN: "unknown",
  PROCESSING: "processing",
  ERROR: "error",
} as const;

export type FileCategoryType = (typeof FileCategory)[keyof typeof FileCategory];

// ===================
// File Extension Mappings
// ===================

export const FILE_EXTENSION_TO_CATEGORY: Record<string, FileCategoryType> = {
  // Documents - PDF
  pdf: FileCategory.DOCUMENT_PDF,

  // Documents - Text
  txt: FileCategory.DOCUMENT_TEXT,
  rtf: FileCategory.DOCUMENT_TEXT,
  md: FileCategory.DOCUMENT_TEXT,
  log: FileCategory.DOCUMENT_TEXT,

  // Documents - Microsoft Office
  doc: FileCategory.DOCUMENT_WORD,
  docx: FileCategory.DOCUMENT_WORD,
  xls: FileCategory.DOCUMENT_EXCEL,
  xlsx: FileCategory.DOCUMENT_EXCEL,
  ppt: FileCategory.DOCUMENT_POWERPOINT,
  pptx: FileCategory.DOCUMENT_POWERPOINT,

  // Documents - OpenDocument
  odt: FileCategory.DOCUMENT_WORD,
  ods: FileCategory.DOCUMENT_EXCEL,
  odp: FileCategory.DOCUMENT_POWERPOINT,

  // Images - Photos
  jpg: FileCategory.IMAGE_PHOTO,
  jpeg: FileCategory.IMAGE_PHOTO,
  png: FileCategory.IMAGE_PHOTO,
  webp: FileCategory.IMAGE_PHOTO,
  gif: FileCategory.IMAGE_PHOTO,
  bmp: FileCategory.IMAGE_PHOTO,
  tiff: FileCategory.IMAGE_PHOTO,
  tga: FileCategory.IMAGE_PHOTO,

  // Images - Vector
  svg: FileCategory.IMAGE_VECTOR,
  eps: FileCategory.IMAGE_VECTOR,
  ai: FileCategory.IMAGE_VECTOR,
  cdr: FileCategory.IMAGE_VECTOR,

  // Images - Icons
  ico: FileCategory.IMAGE_ICON,
  icns: FileCategory.IMAGE_ICON,

  // Images - Raw
  raw: FileCategory.IMAGE_RAW,
  cr2: FileCategory.IMAGE_RAW,
  nef: FileCategory.IMAGE_RAW,
  arw: FileCategory.IMAGE_RAW,
  dng: FileCategory.IMAGE_RAW,

  // Video - Standard
  mp4: FileCategory.VIDEO_STANDARD,
  avi: FileCategory.VIDEO_STANDARD,
  mov: FileCategory.VIDEO_STANDARD,
  wmv: FileCategory.VIDEO_STANDARD,
  flv: FileCategory.VIDEO_STANDARD,

  // Video - High Quality
  mkv: FileCategory.VIDEO_HIGH_QUALITY,
  m4v: FileCategory.VIDEO_HIGH_QUALITY,
  mpg: FileCategory.VIDEO_HIGH_QUALITY,
  mpeg: FileCategory.VIDEO_HIGH_QUALITY,

  // Video - Web
  webm: FileCategory.VIDEO_WEB,
  ogv: FileCategory.VIDEO_WEB,

  // Audio - Music
  mp3: FileCategory.AUDIO_MUSIC,
  m4a: FileCategory.AUDIO_MUSIC,
  aac: FileCategory.AUDIO_MUSIC,
  ogg: FileCategory.AUDIO_MUSIC,
  wma: FileCategory.AUDIO_MUSIC,

  // Audio - Podcast/Voice
  podcast: FileCategory.AUDIO_PODCAST,
  m4b: FileCategory.AUDIO_PODCAST,

  // Audio - Raw
  wav: FileCategory.AUDIO_RAW,
  flac: FileCategory.AUDIO_RAW,
  alac: FileCategory.AUDIO_RAW,

  // Code - Web
  js: FileCategory.CODE_JAVASCRIPT,
  mjs: FileCategory.CODE_JAVASCRIPT,
  jsx: FileCategory.CODE_JAVASCRIPT,
  ts: FileCategory.CODE_TYPESCRIPT,
  tsx: FileCategory.CODE_TYPESCRIPT,
  html: FileCategory.CODE_HTML,
  htm: FileCategory.CODE_HTML,
  css: FileCategory.CODE_CSS,
  scss: FileCategory.CODE_CSS,
  sass: FileCategory.CODE_CSS,
  less: FileCategory.CODE_CSS,

  // Code - Languages
  py: FileCategory.CODE_PYTHON,
  java: FileCategory.CODE_JAVA,
  class: FileCategory.CODE_JAVA,
  jar: FileCategory.CODE_JAVA,
  php: FileCategory.CODE_OTHER,
  rb: FileCategory.CODE_OTHER,
  go: FileCategory.CODE_OTHER,
  rs: FileCategory.CODE_OTHER,
  cpp: FileCategory.CODE_OTHER,
  c: FileCategory.CODE_OTHER,
  cs: FileCategory.CODE_OTHER,
  swift: FileCategory.CODE_OTHER,
  kt: FileCategory.CODE_OTHER,

  // Code - Data
  json: FileCategory.CODE_JSON,
  xml: FileCategory.CODE_XML,
  yaml: FileCategory.CODE_XML,
  yml: FileCategory.CODE_XML,
  toml: FileCategory.CODE_OTHER,
  ini: FileCategory.CODE_OTHER,
  conf: FileCategory.CODE_OTHER,

  // Archives
  zip: FileCategory.ARCHIVE_ZIP,
  rar: FileCategory.ARCHIVE_RAR,
  "7z": FileCategory.ARCHIVE_OTHER,
  tar: FileCategory.ARCHIVE_OTHER,
  gz: FileCategory.ARCHIVE_OTHER,
  bz2: FileCategory.ARCHIVE_OTHER,
  xz: FileCategory.ARCHIVE_OTHER,

  // 3D & CAD
  dwg: FileCategory.CAD_AUTOCAD,
  dxf: FileCategory.CAD_AUTOCAD,
  obj: FileCategory.CAD_3D_MODEL,
  fbx: FileCategory.CAD_3D_MODEL,
  "3ds": FileCategory.CAD_3D_MODEL,
  max: FileCategory.CAD_3D_MODEL,
  blend: FileCategory.CAD_3D_MODEL,
  skp: FileCategory.CAD_3D_MODEL,

  // Fonts
  ttf: FileCategory.FONT,
  otf: FileCategory.FONT,
  woff: FileCategory.FONT,
  woff2: FileCategory.FONT,
  eot: FileCategory.FONT,

  // Database
  db: FileCategory.DATABASE,
  sqlite: FileCategory.DATABASE,
  sql: FileCategory.DATABASE,
  mdb: FileCategory.DATABASE,

  // Executable
  exe: FileCategory.EXECUTABLE,
  msi: FileCategory.EXECUTABLE,
  dmg: FileCategory.EXECUTABLE,
  pkg: FileCategory.EXECUTABLE,
  deb: FileCategory.EXECUTABLE,
  rpm: FileCategory.EXECUTABLE,
  apk: FileCategory.EXECUTABLE,
  app: FileCategory.EXECUTABLE,
};

// ===================
// MIME Type Mappings (fallback)
// ===================

export const MIME_TYPE_TO_CATEGORY: Record<string, FileCategoryType> = {
  // Documents
  "application/pdf": FileCategory.DOCUMENT_PDF,
  "text/plain": FileCategory.DOCUMENT_TEXT,
  "text/rtf": FileCategory.DOCUMENT_TEXT,
  "text/markdown": FileCategory.DOCUMENT_TEXT,

  // Microsoft Office
  "application/msword": FileCategory.DOCUMENT_WORD,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": FileCategory.DOCUMENT_WORD,
  "application/vnd.ms-excel": FileCategory.DOCUMENT_EXCEL,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": FileCategory.DOCUMENT_EXCEL,
  "application/vnd.ms-powerpoint": FileCategory.DOCUMENT_POWERPOINT,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": FileCategory.DOCUMENT_POWERPOINT,

  // Images
  "image/jpeg": FileCategory.IMAGE_PHOTO,
  "image/png": FileCategory.IMAGE_PHOTO,
  "image/gif": FileCategory.IMAGE_PHOTO,
  "image/webp": FileCategory.IMAGE_PHOTO,
  "image/bmp": FileCategory.IMAGE_PHOTO,
  "image/svg+xml": FileCategory.IMAGE_VECTOR,
  "image/x-icon": FileCategory.IMAGE_ICON,
  "application/postscript": FileCategory.IMAGE_VECTOR,

  // Video
  "video/mp4": FileCategory.VIDEO_STANDARD,
  "video/quicktime": FileCategory.VIDEO_STANDARD,
  "video/x-msvideo": FileCategory.VIDEO_STANDARD,
  "video/webm": FileCategory.VIDEO_WEB,

  // Audio
  "audio/mpeg": FileCategory.AUDIO_MUSIC,
  "audio/mp4": FileCategory.AUDIO_MUSIC,
  "audio/wav": FileCategory.AUDIO_RAW,
  "audio/flac": FileCategory.AUDIO_RAW,

  // Archives
  "application/zip": FileCategory.ARCHIVE_ZIP,
  "application/x-rar-compressed": FileCategory.ARCHIVE_RAR,
  "application/x-7z-compressed": FileCategory.ARCHIVE_OTHER,

  // Code
  "text/javascript": FileCategory.CODE_JAVASCRIPT,
  "application/json": FileCategory.CODE_JSON,
  "text/html": FileCategory.CODE_HTML,
  "text/css": FileCategory.CODE_CSS,
  "application/xml": FileCategory.CODE_XML,
  "text/xml": FileCategory.CODE_XML,
};

// ===================
// Category Colors
// ===================

export const CATEGORY_COLORS = {
  [FileCategory.DOCUMENT_PDF]: {
    bg: "bg-red-50/80 dark:bg-red-950/20",
    border: "border-red-200/60 dark:border-red-800/40",
    text: "text-red-700 dark:text-red-400",
    icon: "text-red-600 dark:text-red-500",
  },
  [FileCategory.DOCUMENT_TEXT]: {
    bg: "bg-gray-50/80 dark:bg-gray-950/20",
    border: "border-gray-200/60 dark:border-gray-800/40",
    text: "text-gray-700 dark:text-gray-400",
    icon: "text-gray-600 dark:text-gray-500",
  },
  [FileCategory.DOCUMENT_WORD]: {
    bg: "bg-blue-50/80 dark:bg-blue-950/20",
    border: "border-blue-200/60 dark:border-blue-800/40",
    text: "text-blue-700 dark:text-blue-400",
    icon: "text-blue-600 dark:text-blue-500",
  },
  [FileCategory.DOCUMENT_EXCEL]: {
    bg: "bg-green-50/80 dark:bg-green-950/20",
    border: "border-green-200/60 dark:border-green-800/40",
    text: "text-green-700 dark:text-green-400",
    icon: "text-green-600 dark:text-green-500",
  },
  [FileCategory.DOCUMENT_POWERPOINT]: {
    bg: "bg-orange-50/80 dark:bg-orange-950/20",
    border: "border-orange-200/60 dark:border-orange-800/40",
    text: "text-orange-700 dark:text-orange-400",
    icon: "text-orange-600 dark:text-orange-500",
  },
  [FileCategory.DOCUMENT_OTHER]: {
    bg: "bg-slate-50/80 dark:bg-slate-950/20",
    border: "border-slate-200/60 dark:border-slate-800/40",
    text: "text-slate-700 dark:text-slate-400",
    icon: "text-slate-600 dark:text-slate-500",
  },
  [FileCategory.IMAGE_PHOTO]: {
    bg: "bg-purple-50/80 dark:bg-purple-950/20",
    border: "border-purple-200/60 dark:border-purple-800/40",
    text: "text-purple-700 dark:text-purple-400",
    icon: "text-purple-600 dark:text-purple-500",
  },
  [FileCategory.IMAGE_VECTOR]: {
    bg: "bg-indigo-50/80 dark:bg-indigo-950/20",
    border: "border-indigo-200/60 dark:border-indigo-800/40",
    text: "text-indigo-700 dark:text-indigo-400",
    icon: "text-indigo-600 dark:text-indigo-500",
  },
  [FileCategory.IMAGE_ICON]: {
    bg: "bg-violet-50/80 dark:bg-violet-950/20",
    border: "border-violet-200/60 dark:border-violet-800/40",
    text: "text-violet-700 dark:text-violet-400",
    icon: "text-violet-600 dark:text-violet-500",
  },
  [FileCategory.IMAGE_RAW]: {
    bg: "bg-pink-50/80 dark:bg-pink-950/20",
    border: "border-pink-200/60 dark:border-pink-800/40",
    text: "text-pink-700 dark:text-pink-400",
    icon: "text-pink-600 dark:text-pink-500",
  },
  [FileCategory.VIDEO_STANDARD]: {
    bg: "bg-emerald-50/80 dark:bg-emerald-950/20",
    border: "border-emerald-200/60 dark:border-emerald-800/40",
    text: "text-emerald-700 dark:text-emerald-400",
    icon: "text-emerald-600 dark:text-emerald-500",
  },
  [FileCategory.VIDEO_HIGH_QUALITY]: {
    bg: "bg-teal-50/80 dark:bg-teal-950/20",
    border: "border-teal-200/60 dark:border-teal-800/40",
    text: "text-teal-700 dark:text-teal-400",
    icon: "text-teal-600 dark:text-teal-500",
  },
  [FileCategory.VIDEO_WEB]: {
    bg: "bg-cyan-50/80 dark:bg-cyan-950/20",
    border: "border-cyan-200/60 dark:border-cyan-800/40",
    text: "text-cyan-700 dark:text-cyan-400",
    icon: "text-cyan-600 dark:text-cyan-500",
  },
  [FileCategory.AUDIO_MUSIC]: {
    bg: "bg-lime-50/80 dark:bg-lime-950/20",
    border: "border-lime-200/60 dark:border-lime-800/40",
    text: "text-lime-700 dark:text-lime-400",
    icon: "text-lime-600 dark:text-lime-500",
  },
  [FileCategory.AUDIO_PODCAST]: {
    bg: "bg-amber-50/80 dark:bg-amber-950/20",
    border: "border-amber-200/60 dark:border-amber-800/40",
    text: "text-amber-700 dark:text-amber-400",
    icon: "text-amber-600 dark:text-amber-500",
  },
  [FileCategory.AUDIO_RAW]: {
    bg: "bg-yellow-50/80 dark:bg-yellow-950/20",
    border: "border-yellow-200/60 dark:border-yellow-800/40",
    text: "text-yellow-700 dark:text-yellow-400",
    icon: "text-yellow-600 dark:text-yellow-500",
  },
  [FileCategory.CODE_JAVASCRIPT]: {
    bg: "bg-yellow-50/80 dark:bg-yellow-950/20",
    border: "border-yellow-200/60 dark:border-yellow-800/40",
    text: "text-yellow-700 dark:text-yellow-400",
    icon: "text-yellow-600 dark:text-yellow-500",
  },
  [FileCategory.CODE_TYPESCRIPT]: {
    bg: "bg-blue-50/80 dark:bg-blue-950/20",
    border: "border-blue-200/60 dark:border-blue-800/40",
    text: "text-blue-700 dark:text-blue-400",
    icon: "text-blue-600 dark:text-blue-500",
  },
  [FileCategory.CODE_HTML]: {
    bg: "bg-orange-50/80 dark:bg-orange-950/20",
    border: "border-orange-200/60 dark:border-orange-800/40",
    text: "text-orange-700 dark:text-orange-400",
    icon: "text-orange-600 dark:text-orange-500",
  },
  [FileCategory.CODE_CSS]: {
    bg: "bg-cyan-50/80 dark:bg-cyan-950/20",
    border: "border-cyan-200/60 dark:border-cyan-800/40",
    text: "text-cyan-700 dark:text-cyan-400",
    icon: "text-cyan-600 dark:text-cyan-500",
  },
  [FileCategory.CODE_PYTHON]: {
    bg: "bg-green-50/80 dark:bg-green-950/20",
    border: "border-green-200/60 dark:border-green-800/40",
    text: "text-green-700 dark:text-green-400",
    icon: "text-green-600 dark:text-green-500",
  },
  [FileCategory.CODE_JAVA]: {
    bg: "bg-red-50/80 dark:bg-red-950/20",
    border: "border-red-200/60 dark:border-red-800/40",
    text: "text-red-700 dark:text-red-400",
    icon: "text-red-600 dark:text-red-500",
  },
  [FileCategory.CODE_JSON]: {
    bg: "bg-emerald-50/80 dark:bg-emerald-950/20",
    border: "border-emerald-200/60 dark:border-emerald-800/40",
    text: "text-emerald-700 dark:text-emerald-400",
    icon: "text-emerald-600 dark:text-emerald-500",
  },
  [FileCategory.CODE_XML]: {
    bg: "bg-violet-50/80 dark:bg-violet-950/20",
    border: "border-violet-200/60 dark:border-violet-800/40",
    text: "text-violet-700 dark:text-violet-400",
    icon: "text-violet-600 dark:text-violet-500",
  },
  [FileCategory.CODE_OTHER]: {
    bg: "bg-slate-50/80 dark:bg-slate-950/20",
    border: "border-slate-200/60 dark:border-slate-800/40",
    text: "text-slate-700 dark:text-slate-400",
    icon: "text-slate-600 dark:text-slate-500",
  },
  [FileCategory.ARCHIVE_ZIP]: {
    bg: "bg-amber-50/80 dark:bg-amber-950/20",
    border: "border-amber-200/60 dark:border-amber-800/40",
    text: "text-amber-700 dark:text-amber-400",
    icon: "text-amber-600 dark:text-amber-500",
  },
  [FileCategory.ARCHIVE_RAR]: {
    bg: "bg-orange-50/80 dark:bg-orange-950/20",
    border: "border-orange-200/60 dark:border-orange-800/40",
    text: "text-orange-700 dark:text-orange-400",
    icon: "text-orange-600 dark:text-orange-500",
  },
  [FileCategory.ARCHIVE_OTHER]: {
    bg: "bg-yellow-50/80 dark:bg-yellow-950/20",
    border: "border-yellow-200/60 dark:border-yellow-800/40",
    text: "text-yellow-700 dark:text-yellow-400",
    icon: "text-yellow-600 dark:text-yellow-500",
  },
  [FileCategory.CAD_AUTOCAD]: {
    bg: "bg-red-50/80 dark:bg-red-950/20",
    border: "border-red-200/60 dark:border-red-800/40",
    text: "text-red-700 dark:text-red-400",
    icon: "text-red-600 dark:text-red-500",
  },
  [FileCategory.CAD_3D_MODEL]: {
    bg: "bg-purple-50/80 dark:bg-purple-950/20",
    border: "border-purple-200/60 dark:border-purple-800/40",
    text: "text-purple-700 dark:text-purple-400",
    icon: "text-purple-600 dark:text-purple-500",
  },
  [FileCategory.CAD_OTHER]: {
    bg: "bg-pink-50/80 dark:bg-pink-950/20",
    border: "border-pink-200/60 dark:border-pink-800/40",
    text: "text-pink-700 dark:text-pink-400",
    icon: "text-pink-600 dark:text-pink-500",
  },
  [FileCategory.FONT]: {
    bg: "bg-indigo-50/80 dark:bg-indigo-950/20",
    border: "border-indigo-200/60 dark:border-indigo-800/40",
    text: "text-indigo-700 dark:text-indigo-400",
    icon: "text-indigo-600 dark:text-indigo-500",
  },
  [FileCategory.DATABASE]: {
    bg: "bg-teal-50/80 dark:bg-teal-950/20",
    border: "border-teal-200/60 dark:border-teal-800/40",
    text: "text-teal-700 dark:text-teal-400",
    icon: "text-teal-600 dark:text-teal-500",
  },
  [FileCategory.EXECUTABLE]: {
    bg: "bg-gray-50/80 dark:bg-gray-950/20",
    border: "border-gray-200/60 dark:border-gray-800/40",
    text: "text-gray-700 dark:text-gray-400",
    icon: "text-gray-600 dark:text-gray-500",
  },
  [FileCategory.UNKNOWN]: {
    bg: "bg-muted/50",
    border: "border-border",
    text: "text-muted-foreground",
    icon: "text-muted-foreground",
  },
  [FileCategory.PROCESSING]: {
    bg: "bg-blue-50/80 dark:bg-blue-950/20",
    border: "border-blue-200/60 dark:border-blue-800/40",
    text: "text-blue-700 dark:text-blue-400",
    icon: "text-blue-600 dark:text-blue-500",
  },
  [FileCategory.ERROR]: {
    bg: "bg-red-50/80 dark:bg-red-950/20",
    border: "border-red-200/60 dark:border-red-800/40",
    text: "text-red-700 dark:text-red-400",
    icon: "text-red-600 dark:text-red-500",
  },
} as const;

// ===================
// Tabler Icon Names
// ===================

export const CATEGORY_TABLER_ICONS = {
  [FileCategory.DOCUMENT_PDF]: "IconFileTypePdf",
  [FileCategory.DOCUMENT_TEXT]: "IconFileText",
  [FileCategory.DOCUMENT_WORD]: "IconFileTypeDoc",
  [FileCategory.DOCUMENT_EXCEL]: "IconFileTypeXls",
  [FileCategory.DOCUMENT_POWERPOINT]: "IconFileTypePpt",
  [FileCategory.DOCUMENT_OTHER]: "IconFileText",

  [FileCategory.IMAGE_PHOTO]: "IconPhoto",
  [FileCategory.IMAGE_VECTOR]: "IconVectorBezier",
  [FileCategory.IMAGE_ICON]: "IconIcons",
  [FileCategory.IMAGE_RAW]: "IconCamera",

  [FileCategory.VIDEO_STANDARD]: "IconVideo",
  [FileCategory.VIDEO_HIGH_QUALITY]: "IconDeviceTv",
  [FileCategory.VIDEO_WEB]: "IconBrandYoutube",

  [FileCategory.AUDIO_MUSIC]: "IconMusic",
  [FileCategory.AUDIO_PODCAST]: "IconMicrophone",
  [FileCategory.AUDIO_RAW]: "IconVolume",

  [FileCategory.CODE_JAVASCRIPT]: "IconBrandJavascript",
  [FileCategory.CODE_TYPESCRIPT]: "IconBrandTypescript",
  [FileCategory.CODE_HTML]: "IconBrandHtml5",
  [FileCategory.CODE_CSS]: "IconBrandCss3",
  [FileCategory.CODE_PYTHON]: "IconBrandPython",
  [FileCategory.CODE_JAVA]: "IconCoffee",
  [FileCategory.CODE_JSON]: "IconBraces",
  [FileCategory.CODE_XML]: "IconCode",
  [FileCategory.CODE_OTHER]: "IconFileCode",

  [FileCategory.ARCHIVE_ZIP]: "IconFileZip",
  [FileCategory.ARCHIVE_RAR]: "IconArchive",
  [FileCategory.ARCHIVE_OTHER]: "IconPackage",

  [FileCategory.CAD_AUTOCAD]: "IconRuler2",
  [FileCategory.CAD_3D_MODEL]: "IconBox",
  [FileCategory.CAD_OTHER]: "IconDimensions",

  [FileCategory.FONT]: "IconTypography",
  [FileCategory.DATABASE]: "IconDatabase",
  [FileCategory.EXECUTABLE]: "IconBinary",
  [FileCategory.UNKNOWN]: "IconFile",
  [FileCategory.PROCESSING]: "IconLoader",
  [FileCategory.ERROR]: "IconAlertCircle",
} as const;

// ===================
// Utility Functions
// ===================

/**
 * Determines the file category based on extension or MIME type
 */
export function getFileTypeCategory(filename: string, mimeType?: string): FileCategoryType {
  // First try extension
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension && FILE_EXTENSION_TO_CATEGORY[extension]) {
    return FILE_EXTENSION_TO_CATEGORY[extension];
  }

  // Fallback to MIME type
  if (mimeType && MIME_TYPE_TO_CATEGORY[mimeType.toLowerCase()]) {
    return MIME_TYPE_TO_CATEGORY[mimeType.toLowerCase()];
  }

  return FileCategory.UNKNOWN;
}

/**
 * Gets the Tabler icon name for a file category
 */
export function getCategoryIconName(category: FileCategoryType): string {
  return CATEGORY_TABLER_ICONS[category] || CATEGORY_TABLER_ICONS[FileCategory.UNKNOWN];
}

/**
 * Gets the color scheme for a file category
 */
export function getCategoryColors(category: FileCategoryType) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS[FileCategory.UNKNOWN];
}

/**
 * Gets file info with category, colors, and icon
 */
export function getFileTypeInfo(filename: string, mimeType?: string) {
  const category = getFileTypeCategory(filename, mimeType);
  const colors = getCategoryColors(category);
  const iconName = getCategoryIconName(category);

  return {
    category,
    colors,
    iconName,
    isProcessing: category === FileCategory.PROCESSING,
    isError: category === FileCategory.ERROR,
  };
}

/**
 * Gets a user-friendly label for a file category
 */
export function getCategoryLabel(category: FileCategoryType): string {
  const labels: Record<FileCategoryType, string> = {
    [FileCategory.DOCUMENT_PDF]: "PDF",
    [FileCategory.DOCUMENT_TEXT]: "Texto",
    [FileCategory.DOCUMENT_WORD]: "Word",
    [FileCategory.DOCUMENT_EXCEL]: "Excel",
    [FileCategory.DOCUMENT_POWERPOINT]: "PowerPoint",
    [FileCategory.DOCUMENT_OTHER]: "Documento",

    [FileCategory.IMAGE_PHOTO]: "Imagem",
    [FileCategory.IMAGE_VECTOR]: "Vetor",
    [FileCategory.IMAGE_ICON]: "Ícone",
    [FileCategory.IMAGE_RAW]: "Imagem RAW",

    [FileCategory.VIDEO_STANDARD]: "Vídeo",
    [FileCategory.VIDEO_HIGH_QUALITY]: "Vídeo HD",
    [FileCategory.VIDEO_WEB]: "Vídeo Web",

    [FileCategory.AUDIO_MUSIC]: "Música",
    [FileCategory.AUDIO_PODCAST]: "Podcast",
    [FileCategory.AUDIO_RAW]: "Áudio RAW",

    [FileCategory.CODE_JAVASCRIPT]: "JavaScript",
    [FileCategory.CODE_TYPESCRIPT]: "TypeScript",
    [FileCategory.CODE_HTML]: "HTML",
    [FileCategory.CODE_CSS]: "CSS",
    [FileCategory.CODE_PYTHON]: "Python",
    [FileCategory.CODE_JAVA]: "Java",
    [FileCategory.CODE_JSON]: "JSON",
    [FileCategory.CODE_XML]: "XML",
    [FileCategory.CODE_OTHER]: "Código",

    [FileCategory.ARCHIVE_ZIP]: "ZIP",
    [FileCategory.ARCHIVE_RAR]: "RAR",
    [FileCategory.ARCHIVE_OTHER]: "Arquivo",

    [FileCategory.CAD_AUTOCAD]: "AutoCAD",
    [FileCategory.CAD_3D_MODEL]: "Modelo 3D",
    [FileCategory.CAD_OTHER]: "CAD",

    [FileCategory.FONT]: "Fonte",
    [FileCategory.DATABASE]: "Banco de Dados",
    [FileCategory.EXECUTABLE]: "Executável",
    [FileCategory.UNKNOWN]: "Desconhecido",
    [FileCategory.PROCESSING]: "Processando",
    [FileCategory.ERROR]: "Erro",
  };

  return labels[category] || "Arquivo";
}

/**
 * Groups file categories by type for filtering/organization
 */
export function getCategoryGroups() {
  return {
    documents: [
      FileCategory.DOCUMENT_PDF,
      FileCategory.DOCUMENT_TEXT,
      FileCategory.DOCUMENT_WORD,
      FileCategory.DOCUMENT_EXCEL,
      FileCategory.DOCUMENT_POWERPOINT,
      FileCategory.DOCUMENT_OTHER,
    ],
    images: [FileCategory.IMAGE_PHOTO, FileCategory.IMAGE_VECTOR, FileCategory.IMAGE_ICON, FileCategory.IMAGE_RAW],
    media: [FileCategory.VIDEO_STANDARD, FileCategory.VIDEO_HIGH_QUALITY, FileCategory.VIDEO_WEB, FileCategory.AUDIO_MUSIC, FileCategory.AUDIO_PODCAST, FileCategory.AUDIO_RAW],
    code: [
      FileCategory.CODE_JAVASCRIPT,
      FileCategory.CODE_TYPESCRIPT,
      FileCategory.CODE_HTML,
      FileCategory.CODE_CSS,
      FileCategory.CODE_PYTHON,
      FileCategory.CODE_JAVA,
      FileCategory.CODE_JSON,
      FileCategory.CODE_XML,
      FileCategory.CODE_OTHER,
    ],
    archives: [FileCategory.ARCHIVE_ZIP, FileCategory.ARCHIVE_RAR, FileCategory.ARCHIVE_OTHER],
    specialized: [FileCategory.CAD_AUTOCAD, FileCategory.CAD_3D_MODEL, FileCategory.CAD_OTHER, FileCategory.FONT, FileCategory.DATABASE, FileCategory.EXECUTABLE],
  };
}
