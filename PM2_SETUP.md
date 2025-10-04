# PM2 Ecosystem Configuration Guide

## Overview

This PM2 configuration manages two separate environments for the Ankaa API:

- **Production**: Port 3030 - Stable production environment
- **Staging**: Port 3031 - Testing and development environment

## Quick Start

### Start Both Environments
```bash
./pm2-start-both.sh
```

### Start Production Only
```bash
./pm2-start-production.sh
```

### Start Staging Only
```bash
./pm2-start-staging.sh
```

### View Status
```bash
./pm2-status.sh
# or
pm2 status
```

### View Logs
```bash
# All logs
./pm2-logs.sh

# Production logs only
./pm2-logs.sh production

# Staging logs only
./pm2-logs.sh staging
```

### Stop All Environments
```bash
./pm2-stop-all.sh
# or
pm2 stop all
```

## Environment Details

### Production Environment (`ankaa-api-production`)

**Port**: 3030
**Database**: `ankaa` (production database)
**Memory Limit**: 1GB
**Watch Mode**: Disabled (manual reload required)
**Log Level**: `info`
**Rate Limiting**: Enabled (100 requests/15min)

**Key Features**:
- Auto-restart on crashes (max 10 restarts)
- Source map support for better debugging
- Separate log files for errors and output
- Production-optimized settings

**Environment Variables**:
```env
NODE_ENV=production
PORT=3030
DATABASE_URL=postgresql://docker:docker@localhost:5432/ankaa?schema=public
LOG_LEVEL=info
RATE_LIMIT_MAX=100
USE_MOCK_SECULLUM=false
```

### Staging Environment (`ankaa-api-staging`)

**Port**: 3031
**Database**: `ankaa_staging` (separate staging database)
**Memory Limit**: 512MB
**Watch Mode**: Enabled (auto-reload on file changes)
**Log Level**: `debug`
**Rate Limiting**: Disabled

**Key Features**:
- Auto-reload on code changes (watch mode)
- More verbose logging for debugging
- Mock Secullum integration
- Separate uploads directory
- Higher rate limits for testing

**Environment Variables**:
```env
NODE_ENV=staging
PORT=3031
DATABASE_URL=postgresql://docker:docker@localhost:5432/ankaa_staging?schema=public
LOG_LEVEL=debug
DISABLE_RATE_LIMITING=true
USE_MOCK_SECULLUM=true
```

## Common PM2 Commands

### Process Management
```bash
# Start specific environment
pm2 start ecosystem.config.js --only ankaa-api-production
pm2 start ecosystem.config.js --only ankaa-api-staging

# Restart
pm2 restart ankaa-api-production
pm2 restart ankaa-api-staging
pm2 restart all

# Reload (zero-downtime restart)
pm2 reload ankaa-api-production

# Stop
pm2 stop ankaa-api-production
pm2 stop ankaa-api-staging
pm2 stop all

# Delete process
pm2 delete ankaa-api-production
pm2 delete all
```

### Monitoring
```bash
# Real-time monitoring dashboard
pm2 monit

# Process status
pm2 status

# Detailed process info
pm2 describe ankaa-api-production

# Show logs
pm2 logs
pm2 logs ankaa-api-production --lines 100
pm2 logs ankaa-api-staging --err  # errors only
```

### Log Management
```bash
# Flush logs
pm2 flush

# Rotate logs (if pm2-logrotate is installed)
pm2 install pm2-logrotate

# View log files directly
tail -f logs/production-error.log
tail -f logs/staging-out.log
```

### Startup & Persistence
```bash
# Save current process list
pm2 save

# Generate startup script (run on system boot)
pm2 startup

# Resurrect saved processes
pm2 resurrect

# Unstartup (disable auto-start)
pm2 unstartup
```

## Directory Structure

```
apps/api/
├── ecosystem.config.js          # PM2 configuration
├── pm2-start-production.sh      # Start production
├── pm2-start-staging.sh         # Start staging
├── pm2-start-both.sh           # Start both
├── pm2-stop-all.sh             # Stop all
├── pm2-logs.sh                 # View logs
├── pm2-status.sh               # Show status
├── logs/
│   ├── production-error.log    # Production errors
│   ├── production-out.log      # Production output
│   ├── production-combined.log # Production combined
│   ├── staging-error.log       # Staging errors
│   ├── staging-out.log         # Staging output
│   └── staging-combined.log    # Staging combined
├── uploads/                     # Production uploads
└── uploads-staging/            # Staging uploads
```

## Configuration Customization

### Changing Ports

Edit `ecosystem.config.js`:

```javascript
// Production
env: {
  PORT: 3030,  // Change this
  // ...
}

// Staging
env: {
  PORT: 3031,  // Change this
  // ...
}
```

### Changing Database

```javascript
env: {
  DATABASE_URL: 'postgresql://user:pass@host:5432/dbname?schema=public',
  // ...
}
```

### Enabling/Disabling Watch Mode

```javascript
{
  name: 'ankaa-api-staging',
  watch: true,  // Set to false to disable
  watch_delay: 1000,
  ignore_watch: ['node_modules', 'logs', 'uploads'],
  // ...
}
```

### Adjusting Memory Limits

```javascript
{
  max_memory_restart: '1G',  // Restart if memory exceeds 1GB
  // ...
}
```

## Troubleshooting

### Process Won't Start

1. **Check build exists**:
   ```bash
   npm run build
   ```

2. **Check logs for errors**:
   ```bash
   pm2 logs ankaa-api-production --err
   ```

3. **Verify port is available**:
   ```bash
   lsof -i :3030
   lsof -i :3031
   ```

### High Memory Usage

1. **Check memory stats**:
   ```bash
   pm2 describe ankaa-api-production | grep memory
   ```

2. **Adjust memory limit in ecosystem.config.js**:
   ```javascript
   max_memory_restart: '2G',  // Increase if needed
   ```

### Logs Not Appearing

1. **Ensure log directory exists**:
   ```bash
   mkdir -p logs
   ```

2. **Check PM2 logs directly**:
   ```bash
   pm2 logs --nostream
   ```

3. **Verify log file permissions**:
   ```bash
   ls -la logs/
   ```

### Watch Mode Not Working

1. **Verify watch is enabled**:
   ```bash
   pm2 describe ankaa-api-staging | grep watch
   ```

2. **Check ignore patterns** don't exclude your files

3. **Try manual restart**:
   ```bash
   pm2 restart ankaa-api-staging
   ```

## Database Setup for Staging

Create a separate staging database:

```bash
# Connect to PostgreSQL
psql -U docker -h localhost

# Create staging database
CREATE DATABASE ankaa_staging;

# Copy schema from production
pg_dump -U docker -h localhost ankaa --schema-only | psql -U docker -h localhost ankaa_staging

# (Optional) Copy data
pg_dump -U docker -h localhost ankaa --data-only | psql -U docker -h localhost ankaa_staging
```

## Best Practices

1. **Always build before starting**:
   ```bash
   npm run build
   pm2 start ecosystem.config.js
   ```

2. **Use reload for zero-downtime**:
   ```bash
   pm2 reload ankaa-api-production  # Instead of restart
   ```

3. **Monitor regularly**:
   ```bash
   pm2 monit  # Real-time dashboard
   ```

4. **Save process list after changes**:
   ```bash
   pm2 save
   ```

5. **Keep logs rotated**:
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 10M
   ```

6. **Use environment-specific databases** to avoid data conflicts

7. **Test in staging** before deploying to production

## Deployment Workflow

### Development to Staging
```bash
# 1. Pull latest code
git pull origin develop

# 2. Build
npm run build

# 3. Restart staging
pm2 restart ankaa-api-staging

# 4. Verify
curl http://localhost:3031/api/health
```

### Staging to Production
```bash
# 1. Ensure staging is working
curl http://localhost:3031/api/health

# 2. Merge to main
git checkout main
git merge develop

# 3. Build
npm run build

# 4. Reload production (zero-downtime)
pm2 reload ankaa-api-production

# 5. Verify
curl http://localhost:3030/api/health

# 6. Monitor logs
pm2 logs ankaa-api-production --lines 50
```

## Health Check Endpoints

Test both environments:

```bash
# Production
curl http://localhost:3030/api/health

# Staging
curl http://localhost:3031/api/health

# With details
curl http://localhost:3030/api/health/detailed
```

## Support

For issues or questions:
1. Check PM2 logs: `pm2 logs`
2. Review this documentation
3. Check PM2 official docs: https://pm2.keymetrics.io/
