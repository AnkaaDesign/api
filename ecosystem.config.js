module.exports = {
  apps: [
    // ==========================================
    // PRODUCTION ENVIRONMENT (Port 3030)
    // ==========================================
    {
      name: 'ankaa-api-production',
      script: 'dist/main.js',
      cwd: process.cwd(),

      // Instance Configuration
      instances: 2,
      exec_mode: 'cluster',

      // Auto-restart Configuration
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,

      // Memory Management
      max_memory_restart: '2G',

      // Watch Configuration - DISABLED for production
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'uploads', '.git'],

      // Environment File - Load production environment
      env_file: '.env.production',

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
      script: 'dist/main.js',
      cwd: process.cwd(),

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

      // Environment File - Load staging environment
      env_file: '.env.staging',

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
