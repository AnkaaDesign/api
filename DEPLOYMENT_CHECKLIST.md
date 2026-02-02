# WhatsApp Baileys Migration - Deployment Checklist

## Pre-Deployment (Development Environment)

### ☐ 1. Backup Current System
```bash
# Backup old service files
mkdir -p backup/whatsapp-web-js-$(date +%Y%m%d)
cp src/modules/common/whatsapp/whatsapp.service.ts backup/whatsapp-web-js-$(date +%Y%m%d)/
cp src/modules/common/whatsapp/stores/redis-store.ts backup/whatsapp-web-js-$(date +%Y%m%d)/

# Backup session data
cp -r .wwebjs_auth backup/whatsapp-web-js-$(date +%Y%m%d)/ 2>/dev/null || echo "No session data"

# Backup package.json
cp package.json backup/package.json.backup
```

### ☐ 2. Install Dependencies
```bash
cd /home/kennedy/Documents/repositories/api

# Remove old
npm uninstall whatsapp-web.js qrcode-terminal

# Install new
npm install @whiskeysockets/baileys@^6.7.8 @hapi/boom@^10.0.1 pino@^9.5.0

# Verify installation
npm list @whiskeysockets/baileys @hapi/boom pino
```

### ☐ 3. Build Application
```bash
npm run build

# Check for TypeScript errors
npm run lint

# Verify dist folder
ls -la dist/modules/common/whatsapp/
```

### ☐ 4. Test Locally
```bash
# Start development server
npm run dev

# In another terminal, check health
curl http://localhost:3030/api/health

# Check WhatsApp status
curl http://localhost:3030/whatsapp/status
```

### ☐ 5. Verify QR Code Generation
```bash
# Get QR code
curl http://localhost:3030/whatsapp/qr

# Should return QR code data URL or null if already authenticated
# Scan with WhatsApp mobile app if needed
```

### ☐ 6. Test Message Sending
```bash
# Send test message (replace phone and token)
curl -X POST http://localhost:3030/whatsapp/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "phone": "5511999999999",
    "message": "🚀 Baileys migration test"
  }'
```

### ☐ 7. Test Session Persistence
```bash
# Restart app
pm2 restart all

# Wait 10 seconds, then check status
sleep 10
curl http://localhost:3030/whatsapp/connection-status

# Should show "READY" without needing QR code
```

---

## Deployment to Staging

### ☐ 1. Update Staging Environment
```bash
cd /home/kennedy/Documents/repositories/api

# Pull latest changes
git pull origin main

# Switch to staging environment
export NODE_ENV=staging

# Install dependencies
npm install

# Build
npm run build
```

### ☐ 2. Deploy to Staging Server
```bash
# If using PM2
pm2 restart ankaa-api-staging

# Monitor logs
pm2 logs ankaa-api-staging --lines 100
```

### ☐ 3. Staging Smoke Tests
```bash
# Health check
curl https://api.staging.ankaa.live/api/health

# WhatsApp status
curl https://api.staging.ankaa.live/whatsapp/status

# Connection details
curl https://api.staging.ankaa.live/whatsapp/connection-status
```

### ☐ 4. Monitor Staging (24 hours)
- [ ] Check error logs every 4 hours
- [ ] Verify message delivery rate >95%
- [ ] Monitor memory usage (<250MB expected)
- [ ] Test reconnection after network disruption
- [ ] Verify session persistence across restarts

---

## Production Deployment

### ☐ 1. Pre-Production Checklist
- [ ] Staging tests passed for 24+ hours
- [ ] No critical errors in staging logs
- [ ] Memory usage stable and improved
- [ ] Message delivery rate >95%
- [ ] Team notified of deployment window
- [ ] Rollback plan reviewed

### ☐ 2. Deployment Window Planning
- **Recommended:** Off-peak hours (2-4 AM local time)
- **Duration:** 15-30 minutes expected
- **Downtime:** 2-5 minutes maximum

### ☐ 3. Production Backup
```bash
# Full database backup
npm run backup:db

# Backup Redis data
redis-cli --rdb /backup/redis-$(date +%Y%m%d).rdb

# Backup current deployment
tar -czf /backup/ankaa-api-$(date +%Y%m%d).tar.gz dist/
```

### ☐ 4. Deploy to Production
```bash
cd /home/kennedy/Documents/repositories/api

# Pull latest
git pull origin main

# Install dependencies
NODE_ENV=production npm install

# Build
NODE_ENV=production npm run build

# Deploy
pm2 restart ankaa-api-production

# Verify startup
pm2 logs ankaa-api-production --lines 50
```

### ☐ 5. Post-Deployment Verification (First 5 Minutes)
```bash
# Health check
curl https://api.ankaa.live/api/health

# WhatsApp status
curl https://api.ankaa.live/whatsapp/connection-status

# Check PM2 status
pm2 status

# Monitor logs
pm2 logs ankaa-api-production --lines 100
```

### ☐ 6. Smoke Tests (First 15 Minutes)
```bash
# Send test notification
curl -X POST https://api.ankaa.live/notifications \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{
    "type": "SYSTEM",
    "title": "Baileys Migration Complete",
    "body": "WhatsApp integration upgraded successfully",
    "channel": ["WHATSAPP"],
    "userId": "ADMIN_USER_ID"
  }'

# Verify delivery
# Check logs for: "Message sent successfully"
pm2 logs ankaa-api-production | grep "Message sent"
```

### ☐ 7. Monitor Production (First 2 Hours)
- [ ] Every 15 min: Check error logs
- [ ] Every 30 min: Verify message delivery
- [ ] Every 1 hour: Check memory usage
- [ ] Monitor Redis keys: `redis-cli KEYS "whatsapp:baileys:*"`

---

## Post-Deployment (First 48 Hours)

### ☐ 1. Daily Health Checks
**Day 1 (Every 4 hours):**
```bash
# Memory usage
pm2 monit

# Error count
pm2 logs ankaa-api-production --lines 1000 | grep -i error | wc -l

# WhatsApp delivery rate
# Check analytics dashboard
```

**Day 2 (Every 8 hours):**
- [ ] Same checks as Day 1
- [ ] Compare metrics with pre-migration baseline

### ☐ 2. Performance Metrics Comparison

Create a comparison table:

| Metric | Before (whatsapp-web.js) | After (Baileys) | Status |
|--------|--------------------------|-----------------|--------|
| Memory Usage | ___MB | ___MB | ☐ |
| Startup Time | ___s | ___s | ☐ |
| Message Delivery Rate | ___%  | ___% | ☐ |
| Error Count (24h) | ___ | ___ | ☐ |
| Session Restarts | ___ | ___ | ☐ |

### ☐ 3. User Feedback Collection
- [ ] Check support tickets for WhatsApp-related issues
- [ ] Survey team: "Any WhatsApp notification delays?"
- [ ] Monitor notification delivery dashboard

---

## Rollback Procedure (If Needed)

### Critical Issues That Require Rollback:
- Message delivery rate drops below 80%
- Persistent connection failures (>5 reconnects/hour)
- Memory usage exceeds 1GB
- Critical errors affecting other services

### Rollback Steps:

```bash
# 1. Stop current deployment
pm2 stop ankaa-api-production

# 2. Restore backup
cd /home/kennedy/Documents/repositories/api
tar -xzf /backup/ankaa-api-YYYYMMDD.tar.gz

# 3. Reinstall old dependencies
npm install whatsapp-web.js@^1.34.4 qrcode-terminal@^0.12.0
npm uninstall @whiskeysockets/baileys @hapi/boom pino

# 4. Restore old files
cp backup/whatsapp-web-js-YYYYMMDD/whatsapp.service.ts src/modules/common/whatsapp/
cp backup/whatsapp-web-js-YYYYMMDD/redis-store.ts src/modules/common/whatsapp/stores/

# 5. Rebuild
npm run build

# 6. Restart
pm2 restart ankaa-api-production

# 7. Restore Redis data
redis-cli --rdb /backup/redis-YYYYMMDD.rdb

# 8. Verify rollback
pm2 logs ankaa-api-production --lines 100
curl https://api.ankaa.live/api/health
```

---

## Success Criteria

Migration is considered **SUCCESSFUL** when:

✅ All checks passed:
- [ ] QR code authentication works
- [ ] Messages send successfully (>95% delivery)
- [ ] Session persists across restarts
- [ ] Memory usage reduced by 40%+
- [ ] No "No LID" errors
- [ ] Startup time <10 seconds
- [ ] Zero production incidents
- [ ] 48-hour monitoring period completed

---

## Team Communication

### Before Deployment
**Subject:** WhatsApp Integration Upgrade - Scheduled Maintenance

**Message:**
```
Hi Team,

We're upgrading our WhatsApp integration to improve reliability and performance.

When: [DATE] at [TIME]
Duration: 15-30 minutes
Expected Downtime: 2-5 minutes (WhatsApp only)

Benefits:
- Eliminates "No LID" errors
- 50% less memory usage
- Faster startup (6-10x)
- Better stability

Other channels (Email, Push, In-App) will continue working normally.

Thanks,
[Your Name]
```

### After Deployment
**Subject:** WhatsApp Integration Upgrade - Completed Successfully

**Message:**
```
Hi Team,

The WhatsApp integration upgrade is complete!

Results:
- ✅ All systems operational
- ✅ Memory usage reduced by X%
- ✅ Startup time: X seconds (was Ys)
- ✅ Message delivery rate: X%

Please report any issues to [support channel].

Thanks,
[Your Name]
```

---

## Contact & Support

- **Technical Lead:** [Your Name]
- **On-Call:** [Phone Number]
- **Slack Channel:** #ankaa-tech
- **Documentation:** `/api/BAILEYS_MIGRATION_COMPLETE.md`

---

**Last Updated:** 2026-01-25
**Deployment Version:** Baileys 6.7.8
**Checklist Owner:** [Your Name]
