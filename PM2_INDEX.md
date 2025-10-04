# PM2 Ecosystem Configuration - Complete Index

## 📚 Documentation Files

1. **[PM2_SETUP.md](PM2_SETUP.md)** - Complete setup guide with detailed instructions
2. **[PM2_QUICK_REFERENCE.md](PM2_QUICK_REFERENCE.md)** - Quick reference card for common commands
3. **[PM2_INDEX.md](PM2_INDEX.md)** - This file - index of all PM2 resources

## 🔧 Configuration Files

### Main Configuration
- **[ecosystem.config.js](ecosystem.config.js)** - PM2 ecosystem configuration
  - Production environment (port 3030)
  - Staging environment (port 3031)
  - Deploy configurations
  - Log management
  - Watch mode settings
  - Memory limits

### Environment Templates
- **[.env.production.example](.env.production.example)** - Production environment template
- **[.env.staging.example](.env.staging.example)** - Staging environment template

## 🚀 Management Scripts

### Start Scripts
- **[pm2-start-production.sh](pm2-start-production.sh)** - Start production only (port 3030)
- **[pm2-start-staging.sh](pm2-start-staging.sh)** - Start staging only (port 3031)
- **[pm2-start-both.sh](pm2-start-both.sh)** - Start both environments

### Control Scripts
- **[pm2-stop-all.sh](pm2-stop-all.sh)** - Stop all PM2 processes
- **[pm2-logs.sh](pm2-logs.sh)** - View logs (all, production, or staging)
- **[pm2-status.sh](pm2-status.sh)** - Show detailed status

### Utility Scripts
- **[pm2-validate.sh](pm2-validate.sh)** - Validate PM2 configuration and environment
- **[setup-staging-db.sh](setup-staging-db.sh)** - Setup staging database

## 🎯 Quick Start

### 1. First Time Setup
```bash
# Validate configuration
./pm2-validate.sh

# Setup staging database (optional)
./setup-staging-db.sh

# Build the application
npm run build

# Start both environments
./pm2-start-both.sh
```

### 2. Daily Usage
```bash
# Check status
./pm2-status.sh

# View logs
./pm2-logs.sh

# Restart after code changes
npm run build && pm2 reload all
```

### 3. Environment-Specific Operations
```bash
# Production only
./pm2-start-production.sh
pm2 logs ankaa-api-production

# Staging only
./pm2-start-staging.sh
pm2 logs ankaa-api-staging
```

## 🌐 Environments Overview

### Production Environment
- **Name**: `ankaa-api-production`
- **Port**: 3030
- **Database**: `ankaa`
- **Memory**: 1GB limit
- **Watch**: Disabled
- **Logs**: `logs/production-*.log`
- **Uploads**: `uploads/`
- **URL**: http://localhost:3030/api

### Staging Environment
- **Name**: `ankaa-api-staging`
- **Port**: 3031
- **Database**: `ankaa_staging`
- **Memory**: 512MB limit
- **Watch**: Enabled (auto-reload)
- **Logs**: `logs/staging-*.log`
- **Uploads**: `uploads-staging/`
- **URL**: http://localhost:3031/api

## 📋 File Summary

| File | Size | Purpose |
|------|------|---------|
| ecosystem.config.js | 5.7K | PM2 configuration |
| .env.production.example | 1.3K | Production env template |
| .env.staging.example | 1.5K | Staging env template |
| pm2-start-production.sh | 898B | Start production |
| pm2-start-staging.sh | 883B | Start staging |
| pm2-start-both.sh | 1.0K | Start both |
| pm2-stop-all.sh | 399B | Stop all |
| pm2-logs.sh | 439B | View logs |
| pm2-status.sh | 577B | Show status |
| pm2-validate.sh | 4.1K | Validate setup |
| setup-staging-db.sh | 3.6K | Setup staging DB |
| PM2_SETUP.md | 7.8K | Complete guide |
| PM2_QUICK_REFERENCE.md | 4.7K | Quick reference |

## 🔍 Common Commands

```bash
# Start
./pm2-start-both.sh              # Start all
./pm2-start-production.sh        # Production only
./pm2-start-staging.sh           # Staging only

# Monitor
./pm2-status.sh                  # Status overview
pm2 monit                        # Real-time monitor
./pm2-logs.sh                    # All logs
./pm2-logs.sh production         # Production logs

# Control
pm2 restart ankaa-api-production # Restart production
pm2 reload ankaa-api-staging     # Reload staging (zero-downtime)
./pm2-stop-all.sh                # Stop all

# Maintenance
./pm2-validate.sh                # Validate setup
npm run build                    # Build application
pm2 save                         # Save process list
```

## 🛠️ Troubleshooting

### Process won't start
1. Run `./pm2-validate.sh`
2. Check `npm run build` completed
3. View logs: `pm2 logs --err`

### Port conflicts
```bash
# Check what's using the port
lsof -i :3030
lsof -i :3031

# Kill process if needed
kill -9 <PID>
```

### Database issues
```bash
# Recreate staging database
./setup-staging-db.sh

# Check connection
psql -U docker -h localhost -d ankaa
```

### Memory issues
```bash
# Check memory usage
pm2 describe ankaa-api-production | grep memory

# Adjust in ecosystem.config.js
max_memory_restart: '2G'
```

## 📞 Support Resources

- **Full Documentation**: [PM2_SETUP.md](PM2_SETUP.md)
- **Quick Reference**: [PM2_QUICK_REFERENCE.md](PM2_QUICK_REFERENCE.md)
- **PM2 Official Docs**: https://pm2.keymetrics.io/
- **Validation Tool**: `./pm2-validate.sh`

## 🔄 Deployment Workflow

### Development → Staging
```bash
git pull origin develop
npm run build
pm2 restart ankaa-api-staging
curl http://localhost:3031/api/health
```

### Staging → Production
```bash
git checkout main
git merge develop
npm run build
pm2 reload ankaa-api-production  # Zero-downtime
curl http://localhost:3030/api/health
pm2 logs ankaa-api-production --lines 50
```

## ✅ Checklist

### Initial Setup
- [ ] Install PM2: `npm install -g pm2`
- [ ] Build application: `npm run build`
- [ ] Validate setup: `./pm2-validate.sh`
- [ ] Setup staging DB: `./setup-staging-db.sh`
- [ ] Configure `.env` files
- [ ] Start environments: `./pm2-start-both.sh`
- [ ] Test endpoints:
  - [ ] http://localhost:3030/api/health
  - [ ] http://localhost:3031/api/health

### Auto-start Setup
- [ ] Run `pm2 startup`
- [ ] Execute the generated command
- [ ] Run `pm2 save`
- [ ] Test: Reboot and verify processes start

### Maintenance Tasks
- [ ] Monitor logs regularly: `pm2 logs`
- [ ] Check memory usage: `pm2 status`
- [ ] Install log rotation: `pm2 install pm2-logrotate`
- [ ] Backup databases regularly
- [ ] Keep PM2 updated: `npm install -g pm2@latest`

## 📊 Success Criteria

Your PM2 setup is working correctly when:

✅ Both environments start without errors
✅ Health checks respond:
  - http://localhost:3030/api/health → Production
  - http://localhost:3031/api/health → Staging
✅ Logs are being written to `logs/` directory
✅ Watch mode auto-reloads staging on file changes
✅ Memory limits are respected
✅ Processes survive system reboot (if auto-start enabled)

---

**Last Updated**: $(date +"%Y-%m-%d")
**PM2 Version**: $(pm2 --version 2>/dev/null || echo "Not installed")
**Node Version**: $(node --version)
