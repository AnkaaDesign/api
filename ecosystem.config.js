module.exports = {
  apps: [
    // ==========================================
    // PRODUCTION ENVIRONMENT (Port 3030)
    // ==========================================
    {
      name: 'ankaa-api-production',
      script: 'dist/apps/api/src/main.js',
      node_args: '-r ./scripts/module-alias-setup.js',
      cwd: '/home/kennedy/ankaa/apps/api',

      // Instance Configuration
      instances: 1,
      exec_mode: 'fork',

      // Auto-restart Configuration
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,

      // Memory Management
      max_memory_restart: '1G',

      // Watch Configuration - DISABLED for production
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'uploads', '.git'],

      // Environment Variables (secrets loaded from .env)
      env: {
        NODE_ENV: 'production',
        PORT: 3030,
        // Database connection (inherited from .env)
        DATABASE_URL: process.env.DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET,
        JWT_EXPIRATION: '7d',

        // API Configuration
        API_PREFIX: '/api',
        CORS_ORIGINS: 'http://localhost:5173,http://192.168.0.118:5173',

        // File Upload
        UPLOAD_DIR: './uploads',
        MAX_FILE_SIZE: '52428800',
        FILE_URL_PREFIX: '/files',

        // Rate Limiting
        RATE_LIMIT_WINDOW_MS: '900000',
        RATE_LIMIT_MAX: '100',

        // Logging
        LOG_LEVEL: 'info',
        LOG_FORMAT: 'json',

        // Secullum Integration
        SECULLUM_EMAIL: process.env.SECULLUM_EMAIL,
        SECULLUM_PASSWORD: process.env.SECULLUM_PASSWORD,
        SECULLUM_BASE_URL: 'https://pontoweb.secullum.com.br',
        USE_MOCK_SECULLUM: 'false',

        // Email Configuration (Nodemailer)
        EMAIL_USER: process.env.EMAIL_USER,
        EMAIL_PASS: process.env.EMAIL_PASS,

        // SMS Configuration (Twilio)
        TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
        TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
      },

      // Logging Configuration
      error_file: './logs/production-error.log',
      out_file: './logs/production-out.log',
      log_file: './logs/production-combined.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Process Monitoring
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Advanced PM2 Features
      post_update: ['npm run build'],
      source_map_support: true,
      instance_var: 'INSTANCE_ID',
    },

    // ==========================================
    // STAGING ENVIRONMENT (Port 3031)
    // ==========================================
    {
      name: 'ankaa-api-staging',
      script: 'dist/apps/api/src/main.js',
      node_args: '-r ./scripts/module-alias-setup.js',
      cwd: '/home/kennedy/ankaa/apps/api',

      // Instance Configuration
      instances: 1,
      exec_mode: 'fork',

      // Auto-restart Configuration
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,

      // Memory Management (lower for staging)
      max_memory_restart: '512M',

      // Watch Configuration - ENABLED for staging (auto-reload on changes)
      watch: true,
      watch_delay: 1000,
      ignore_watch: [
        'node_modules',
        'logs',
        'uploads',
        '.git',
        '*.log',
        '*.md',
        'dist',
        '.env*',
      ],

      // Environment Variables (secrets loaded from .env)
      env: {
        NODE_ENV: 'staging',
        PORT: 3031,
        // Staging Database (use different DB or schema)
        DATABASE_URL: process.env.DATABASE_URL_STAGING || process.env.DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET_STAGING || process.env.JWT_SECRET,
        JWT_EXPIRATION: '24h',

        // API Configuration
        API_PREFIX: '/api',
        CORS_ORIGINS: 'http://localhost:5174,http://192.168.0.118:5174',

        // File Upload (separate directory)
        UPLOAD_DIR: './uploads-staging',
        MAX_FILE_SIZE: '52428800',
        FILE_URL_PREFIX: '/files',

        // Rate Limiting (more lenient for staging)
        RATE_LIMIT_WINDOW_MS: '900000',
        RATE_LIMIT_MAX: '500',
        DISABLE_RATE_LIMITING: 'true',

        // Logging (more verbose)
        LOG_LEVEL: 'debug',
        LOG_FORMAT: 'json',

        // Secullum Integration (mock for staging)
        SECULLUM_EMAIL: process.env.SECULLUM_EMAIL_STAGING || 'staging@example.com',
        SECULLUM_PASSWORD: process.env.SECULLUM_PASSWORD_STAGING || 'staging-password',
        SECULLUM_BASE_URL: 'https://pontoweb.secullum.com.br',
        USE_MOCK_SECULLUM: 'true',

        // Email Configuration (Nodemailer)
        EMAIL_USER: process.env.EMAIL_USER,
        EMAIL_PASS: process.env.EMAIL_PASS,

        // SMS Configuration (Twilio)
        TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
        TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
      },

      // Logging Configuration (separate logs)
      error_file: './logs/staging-error.log',
      out_file: './logs/staging-out.log',
      log_file: './logs/staging-combined.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Process Monitoring
      kill_timeout: 3000,
      wait_ready: true,
      listen_timeout: 10000,

      // Advanced PM2 Features
      post_update: ['npm run build'],
      source_map_support: true,
      instance_var: 'INSTANCE_ID',
    },
  ],

  // ==========================================
  // DEPLOY CONFIGURATION (Optional)
  // ==========================================
  deploy: {
    production: {
      user: 'kennedy',
      host: 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:your-repo/ankaa.git',
      path: '/home/kennedy/ankaa',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --only ankaa-api-production',
      'pre-deploy-local': 'echo "Deploying to production..."',
    },
    staging: {
      user: 'kennedy',
      host: 'localhost',
      ref: 'origin/develop',
      repo: 'git@github.com:your-repo/ankaa.git',
      path: '/home/kennedy/ankaa',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --only ankaa-api-staging',
      'pre-deploy-local': 'echo "Deploying to staging..."',
    },
  },
};
