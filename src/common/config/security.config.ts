export const securityConfig = {
  // Helmet security headers configuration
  helmet: {
    // Content Security Policy (CSP) - Enhanced for Brazilian manufacturing system
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        // Script sources - only allow self and specific trusted sources
        scriptSrc: [
          "'self'",
          // Allow inline scripts for development only
          ...(process.env.NODE_ENV === 'development' ? ["'unsafe-inline'"] : []),
          // Trusted CDNs for production
          'https://cdn.jsdelivr.net',
          'https://unpkg.com',
        ],

        // Style sources - allow self and inline styles for UI libraries
        styleSrc: [
          "'self'",
          "'unsafe-inline'", // Required for dynamic CSS-in-JS and UI libraries
          'https://fonts.googleapis.com',
        ],

        // Image sources - allow self, data URLs, and HTTPS
        imgSrc: [
          "'self'",
          'data:',
          'https:',
          'blob:', // For file previews and uploads
        ],

        // Connection sources - API calls and WebSocket connections
        connectSrc: [
          "'self'",
          // Development servers
          ...(process.env.NODE_ENV === 'development'
            ? [
                'http://localhost:*',
                'ws://localhost:*',
                'wss://localhost:*',
                'http://192.168.0.13:*',
                'ws://192.168.0.128:*',
                'wss://192.168.0.128:*',
              ]
            : []),
          // Production API endpoints
          process.env.API_URL || "'self'",
          // Firebase services for file storage
          'https://*.firebaseio.com',
          'https://*.googleapis.com',
          // Twilio for SMS verification
          'https://api.twilio.com',
        ].filter(Boolean),

        // Font sources
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],

        // Object and embed sources - deny for security
        objectSrc: ["'none'"],
        embedSrc: ["'none'"],

        // Media sources - for video/audio content
        mediaSrc: [
          "'self'",
          'blob:', // For recorded media content
        ],

        // Frame sources - deny for clickjacking protection
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],

        // Worker sources
        workerSrc: [
          "'self'",
          'blob:', // For service workers and web workers
        ],

        // Form action - restrict form submissions
        formAction: ["'self'"],

        // Base URI - prevent injection of base tags
        baseUri: ["'self'"],

        // Manifest source - for PWA manifest
        manifestSrc: ["'self'"],

        // Upgrade insecure requests in production
        ...(process.env.NODE_ENV === 'production' && {
          upgradeInsecureRequests: [],
        }),
      },
      // Report violations for monitoring
      reportOnly: process.env.NODE_ENV === 'development',
      reportUri: '/api/security/csp-report',
    },

    // Cross-Origin Embedder Policy
    crossOriginEmbedderPolicy: false, // Keep false for file uploads

    // HTTP Strict Transport Security (HSTS)
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
      // Only enable in production with HTTPS
      ...(process.env.NODE_ENV !== 'production' && { disabled: true }),
    },

    // X-Content-Type-Options
    noSniff: true,

    // X-Frame-Options - prevent clickjacking
    frameguard: {
      action: 'deny' as const,
    },

    // X-Permitted-Cross-Domain-Policies
    permittedCrossDomainPolicies: false,

    // Referrer-Policy - control referrer information
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin' as const,
    },

    // X-DNS-Prefetch-Control
    dnsPrefetchControl: {
      allow: false,
    },

    // Hide X-Powered-By header
    hidePoweredBy: true,

    // Cross-Origin Resource Policy - Allow cross-origin for file serving
    crossOriginResourcePolicy: {
      policy: 'cross-origin' as const,
    },

    // Cross-Origin Opener Policy
    crossOriginOpenerPolicy: {
      policy: 'same-origin' as const,
    },

    // Origin Agent Cluster
    originAgentCluster: true,

    // Permissions Policy (Feature Policy)
    permissionsPolicy: {
      // Camera access for photo capture in mobile app
      camera: ['self'],

      // Microphone access if needed
      microphone: ['none'],

      // Geolocation for location-based features
      geolocation: ['self'],

      // Notifications
      notifications: ['self'],

      // Payment APIs
      payment: ['none'],

      // USB access
      usb: ['none'],

      // Bluetooth access
      bluetooth: ['none'],

      // Accelerometer and gyroscope for mobile
      accelerometer: ['self'],
      gyroscope: ['self'],

      // Ambient light sensor
      'ambient-light-sensor': ['none'],

      // Autoplay media
      autoplay: ['none'],

      // Fullscreen
      fullscreen: ['self'],

      // Picture-in-picture
      'picture-in-picture': ['none'],

      // Screen wake lock
      'screen-wake-lock': ['self'],

      // Synchronous XMLHttpRequest
      'sync-xhr': ['none'],
    },
  },

  // JWT security configuration
  jwt: {
    // JWT token expiration settings
    accessTokenTtl: process.env.JWT_EXPIRATION || '7d',
    refreshTokenTtl: '30d',

    // JWT security options
    issuer: 'ankaa-api',
    audience: 'ankaa-clients',
    algorithm: 'HS256',

    // Security headers for JWT
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    },
  },

  // CORS security configuration
  cors: {
    origin:
      process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging'
        ? [
            'https://ankaa.live',
            'https://www.ankaa.live',
            'https://staging.ankaa.live',
            'http://ankaa.live',
            'http://www.ankaa.live',
            'http://staging.ankaa.live',
            ...(process.env.CLIENT_HOST ? [process.env.CLIENT_HOST] : []),
          ]
        : [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:5173',
            'http://localhost:5174',
            'http://localhost:5175',
            'http://localhost:5176',
            'http://localhost:5177',
            'https://ankaa.live',
            'https://staging.ankaa.live',
            'http://192.168.0.13:3000',
            'http://192.168.0.13:5174',
            'http://192.168.0.13:5175',
            'http://192.168.0.13:5176',
            'http://192.168.0.13:5177',
            'http://192.168.0.13:8081',
            'http://192.168.0.13:19000',
            'http://192.168.0.13:19006',
            ...(process.env.NODE_ENV === 'development' ? ['http://localhost:*'] : []),
          ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'x-request-id',
      'x-api-key',
      'cache-control',
      // File upload headers
      'x-file-size',
      'x-file-name',
      'x-file-type',
      'content-disposition',
      'content-length',
    ],
    exposedHeaders: [
      'x-request-id',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ],
    credentials: true,
    maxAge: 86400, // 24 hours
    optionsSuccessStatus: 200, // Some legacy browsers choke on 204
  },

  // Rate limiting configuration
  rateLimit: {
    windowMs: process.env.NODE_ENV === 'production' ? 15 * 60 * 1000 : 60 * 1000, // 15 min prod, 1 min dev
    max: process.env.NODE_ENV === 'production' ? 100 : 1000, // More permissive in dev
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Muitas tentativas. Tente novamente em alguns minutos.',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  },

  // Additional security configuration
  additional: {
    // File upload security
    upload: {
      maxFileSize: 50 * 1024 * 1024, // 50MB
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'text/plain',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      virusScanEnabled: process.env.NODE_ENV === 'production',
    },

    // Session security
    session: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },

    // Security monitoring
    monitoring: {
      enabled: true,
      logSecurityEvents: true,
      alertThresholds: {
        cspViolations: 50,
        suspiciousRequests: 100,
        failedLogins: 10,
      },
    },
  },
};
