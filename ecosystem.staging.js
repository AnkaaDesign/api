require('dotenv').config({ path: '.env.staging' });

module.exports = {
  apps: [
    {
      name: 'ankaa-api-staging',
      script: 'dist/main.js',
      cwd: '/home/kennedy/repositories/api',

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

      // Environment Variables loaded from .env.staging
      env: process.env,

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
};
