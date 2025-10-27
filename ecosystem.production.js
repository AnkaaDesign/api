require('dotenv').config({ path: '.env.production' });

module.exports = {
  apps: [
    {
      name: 'ankaa-api-production',
      script: 'dist/main.js',
      cwd: '/home/kennedy/repositories/api',

      // Instance Configuration
      instances: 2,
      exec_mode: 'cluster',

      // Auto-restart Configuration
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,

      // Prevent simultaneous restarts in cluster mode
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Memory Management
      max_memory_restart: '1G',

      // Watch Configuration - DISABLED for production
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'uploads', '.git'],

      // Environment Variables loaded from .env.production
      env: process.env,

      // Logging Configuration
      error_file: './logs/production-error.log',
      out_file: './logs/production-out.log',
      log_file: './logs/production-combined.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Advanced PM2 Features
      post_update: ['npm run build'],
      source_map_support: true,
      instance_var: 'INSTANCE_ID',
    },
  ],
};
