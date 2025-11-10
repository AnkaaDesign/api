export const environmentConfig = {
  // Environment detection
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',

  // Security environment settings
  security: {
    // Enable strict security only in production
    strictMode: process.env.NODE_ENV === 'production',

    // CSP configuration per environment
    csp: {
      reportOnly: process.env.NODE_ENV === 'development',
      reportUri: process.env.CSP_REPORT_URI || '/api/security/csp-report',
    },

    // HSTS settings
    hsts: {
      enabled: process.env.NODE_ENV === 'production',
      maxAge: parseInt(process.env.HSTS_MAX_AGE || '31536000'), // 1 year
      includeSubDomains: process.env.HSTS_INCLUDE_SUBDOMAINS !== 'false',
      preload: process.env.HSTS_PRELOAD !== 'false',
    },

    // CORS settings per environment
    cors: {
      production: {
        origin: process.env.CLIENT_HOST ? [process.env.CLIENT_HOST] : ['https://ankaa.app'],
        credentials: true,
        optionsSuccessStatus: 200,
      },
      development: {
        origin: [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:5173',
          'http://localhost:5174',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:5174',
        ],
        credentials: true,
        optionsSuccessStatus: 200,
      },
    },

    // Rate limiting per environment
    rateLimit: {
      disabled: process.env.DISABLE_RATE_LIMITING === 'true',
      production: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs
        standardHeaders: true,
        legacyHeaders: false,
      },
      development: {
        windowMs: 15 * 60 * 1000,
        max: 1000, // More permissive in development
        standardHeaders: true,
        legacyHeaders: false,
      },
    },

    // Session security
    session: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000'), // 24 hours
    },
  },

  // API configuration
  api: {
    host: process.env.HOST || '0.0.0.0',
    port: parseInt(process.env.PORT || '3000'),
    globalPrefix: process.env.API_PREFIX || 'api',
    version: process.env.API_VERSION || 'v1',
  },

  // Database configuration
  database: {
    url: process.env.DATABASE_URL,
    logQueries: process.env.NODE_ENV === 'development',
    ssl: process.env.NODE_ENV === 'production',
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'debug'),
    format: process.env.NODE_ENV === 'production' ? 'json' : 'simple',
    enableConsole: process.env.ENABLE_CONSOLE_LOGS !== 'false',
    enableFile: process.env.ENABLE_FILE_LOGS === 'true',
  },

  // File upload configuration
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800'), // 50MB
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/dxf',
      'application/postscript',
      'application/illustrator',
      'application/vnd.corel-draw',
      'application/x-corel-draw',
    ],
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    fileUrlPrefix: process.env.FILE_URL_PREFIX || '/files',
  },

  // External services configuration
  services: {
    firebase: {
      enabled: !!process.env.FIREBASE_PROJECT_ID,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    },
    twilio: {
      enabled: !!process.env.TWILIO_ACCOUNT_SID,
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
    },
    email: {
      enabled: !!process.env.EMAIL_HOST,
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true',
      user: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASSWORD,
    },
  },

  // Monitoring and health checks
  monitoring: {
    healthCheck: {
      enabled: true,
      timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000'),
      interval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'),
    },
    metrics: {
      enabled: process.env.ENABLE_METRICS === 'true',
      endpoint: process.env.METRICS_ENDPOINT || '/metrics',
    },
  },
};

/**
 * Validate environment configuration
 */
export function validateEnvironmentConfig(): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required environment variables
  const required = ['DATABASE_URL', 'JWT_SECRET'];

  for (const envVar of required) {
    if (!process.env[envVar]) {
      errors.push(`Missing required environment variable: ${envVar}`);
    }
  }

  // Production-specific requirements
  if (environmentConfig.isProduction) {
    const productionRequired = ['CLIENT_HOST', 'EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASSWORD'];

    for (const envVar of productionRequired) {
      if (!process.env[envVar]) {
        warnings.push(`Missing recommended production environment variable: ${envVar}`);
      }
    }

    // Check for insecure settings in production
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
      warnings.push('JWT_SECRET should be at least 32 characters long in production');
    }

    if (!process.env.HSTS_MAX_AGE) {
      warnings.push('Consider setting HSTS_MAX_AGE for production');
    }
  }

  // Development warnings
  if (environmentConfig.isDevelopment) {
    if (!process.env.JWT_SECRET) {
      warnings.push('JWT_SECRET not set - using default (not secure for production)');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
