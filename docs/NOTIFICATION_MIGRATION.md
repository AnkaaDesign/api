# Notification System Migration Guide

This guide helps existing users migrate to the new notification system.

## Overview

The notification system introduces:
- Multi-channel notifications (Push, WhatsApp, Email, SMS)
- User notification preferences
- Notification history and tracking
- Background job queue processing
- Deep linking support

## Prerequisites

Before starting the migration:
- [ ] Backup your database
- [ ] Ensure Redis is running
- [ ] Configure all required environment variables (see [NOTIFICATION_SETUP.md](./NOTIFICATION_SETUP.md))
- [ ] API server is stopped

## Migration Steps

### Step 1: Backup Database

```bash
# PostgreSQL backup
pg_dump -U username database_name > backup_$(date +%Y%m%d_%H%M%S).sql

# Or using Docker
docker exec postgres_container pg_dump -U username database_name > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Step 2: Update Environment Variables

Ensure all notification-related environment variables are configured in your `.env` file:

```bash
# API/.env
NOTIFICATION_QUEUE_CONCURRENCY=5
WHATSAPP_SESSION_PATH=./.wwebjs_auth
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
WEB_APP_URL=https://yourapp.com
MOBILE_APP_SCHEME=yourapp
WEB_BASE_URL=https://yourapp.com
MOBILE_UNIVERSAL_LINK=https://yourapp.com/app
```

### Step 3: Install Dependencies

```bash
cd api
npm install
```

New packages that will be installed:
- `@nestjs/bull` - Queue management
- `bull` - Background job processing
- `whatsapp-web.js` - WhatsApp integration
- `firebase-admin` - Firebase Cloud Messaging
- `qrcode-terminal` - WhatsApp QR code display

### Step 4: Run Database Migration

```bash
# Generate Prisma client with new models
npx prisma generate

# Run the migration
npx prisma migrate dev --name add-notification-system
```

This will create the following new tables:
- `Notification` - Stores all notifications
- `NotificationPreference` - User notification preferences
- `NotificationChannel` - Available notification channels
- `DeviceToken` - Device tokens for push notifications

### Step 5: Verify Migration

Check that the new tables were created:

```bash
# Connect to PostgreSQL
psql -U username -d database_name

# List tables
\dt

# Check Notification table structure
\d "Notification"

# Check NotificationPreference table structure
\d "NotificationPreference"

# Exit
\q
```

### Step 6: Seed Default Data

Create default notification preferences for existing users:

```bash
# Run the seed script
npm run seed:notification-preferences
```

If you don't have a seed script yet, create one at `scripts/seed-notification-preferences.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding notification preferences for existing users...');

  // Get all users
  const users = await prisma.user.findMany({
    select: { id: true, email: true }
  });

  console.log(`Found ${users.length} users`);

  // Create default preferences for each user
  for (const user of users) {
    // Check if preferences already exist
    const existing = await prisma.notificationPreference.findFirst({
      where: { userId: user.id }
    });

    if (existing) {
      console.log(`Preferences already exist for user ${user.email}`);
      continue;
    }

    // Create default preferences
    await prisma.notificationPreference.create({
      data: {
        userId: user.id,
        channel: 'push',
        enabled: true,
        categories: ['system', 'announcement', 'reminder']
      }
    });

    await prisma.notificationPreference.create({
      data: {
        userId: user.id,
        channel: 'email',
        enabled: true,
        categories: ['system', 'announcement']
      }
    });

    console.log(`Created default preferences for user ${user.email}`);
  }

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

Add to your `package.json`:
```json
{
  "scripts": {
    "seed:notification-preferences": "ts-node scripts/seed-notification-preferences.ts"
  }
}
```

### Step 7: Configure WhatsApp (Optional)

If you're using WhatsApp notifications:

1. Start the API server:
```bash
npm run start:dev
```

2. Watch for the QR code in the console
3. Scan with WhatsApp mobile app
4. Wait for "WhatsApp client is ready!" message

The session will be saved and auto-login on subsequent runs.

### Step 8: Restart Services

#### Development
```bash
npm run start:dev
```

#### Production with PM2
```bash
# Restart the API
pm2 restart api

# Or restart all services
pm2 restart all

# Check status
pm2 status

# View logs
pm2 logs api
```

#### Production with Docker
```bash
# Rebuild and restart
docker-compose up -d --build api

# Check logs
docker-compose logs -f api
```

### Step 9: Verify Notification System

#### Check API Health
```bash
curl http://localhost:3030/health
```

#### Check WhatsApp Status
```bash
curl http://localhost:3030/whatsapp/status
```

Expected response:
```json
{
  "status": "ready",
  "isConnected": true
}
```

#### Check Redis Connection
```bash
redis-cli ping
# Should return: PONG

# Check notification queue
redis-cli LLEN bull:notifications:wait
```

#### Send Test Notification
```bash
curl -X POST http://localhost:3030/admin/notifications/test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "userId": "user-id",
    "type": "system",
    "title": "Test Notification",
    "body": "This is a test notification",
    "channels": ["push"]
  }'
```

### Step 10: Update Frontend Applications

#### Web Application
1. Ensure Firebase config is in `web/.env`
2. Rebuild the application:
```bash
cd web
npm run build
```

3. Test web push notifications in the browser

#### Mobile Application
1. Ensure Expo config is in `mobile/.env`
2. Rebuild with EAS:
```bash
cd mobile
eas build --profile production --platform all
```

3. Test push notifications on physical devices

## Rollback Plan

If you encounter issues and need to rollback:

### Step 1: Stop Services
```bash
pm2 stop api
# or
docker-compose stop api
```

### Step 2: Rollback Database Migration
```bash
# Revert the last migration
npx prisma migrate reset

# Or restore from backup
psql -U username -d database_name < backup_YYYYMMDD_HHMMSS.sql
```

### Step 3: Revert Code Changes
```bash
git revert HEAD
# or
git reset --hard PREVIOUS_COMMIT_HASH
```

### Step 4: Restart Services
```bash
pm2 restart api
```

## Post-Migration Checklist

- [ ] All database migrations applied successfully
- [ ] Default notification preferences created for existing users
- [ ] WhatsApp QR code scanned and authenticated
- [ ] Redis connection established
- [ ] Notification queue is processing jobs
- [ ] Test notifications sent successfully via all channels
- [ ] Frontend applications rebuilt and deployed
- [ ] Monitoring and logging configured
- [ ] Backup strategy updated to include new tables

## Monitoring

After migration, monitor the following:

### Database
```sql
-- Check notification count
SELECT COUNT(*) FROM "Notification";

-- Check preferences per user
SELECT COUNT(*) FROM "NotificationPreference" GROUP BY "userId";

-- Check notification status distribution
SELECT status, COUNT(*) FROM "Notification" GROUP BY status;

-- Check failed notifications
SELECT * FROM "Notification" WHERE status = 'failed' ORDER BY "createdAt" DESC LIMIT 10;
```

### Redis Queue
```bash
# Check queue metrics
redis-cli INFO stats

# Check pending notifications
redis-cli LLEN bull:notifications:wait

# Check active notifications
redis-cli LLEN bull:notifications:active

# Check failed jobs
redis-cli LLEN bull:notifications:failed
```

### Application Logs
```bash
# PM2 logs
pm2 logs api --lines 100

# Docker logs
docker-compose logs -f --tail=100 api

# Search for notification errors
pm2 logs api | grep -i "notification.*error"
```

## Troubleshooting

### Migration Fails

**Error:** `Migration failed: relation already exists`
```bash
# Solution: Reset and rerun
npx prisma migrate reset
npx prisma migrate dev --name add-notification-system
```

### WhatsApp Not Connecting

**Error:** `WhatsApp client not ready`
```bash
# Solution: Reset session
rm -rf .wwebjs_auth/
# Restart API and scan QR code again
```

### Redis Connection Failed

**Error:** `ECONNREFUSED 127.0.0.1:6379`
```bash
# Solution: Start Redis
sudo systemctl start redis
# or
brew services start redis
```

### Notifications Not Sending

1. Check queue processing:
```bash
redis-cli LLEN bull:notifications:active
```

2. Check failed jobs:
```bash
redis-cli LRANGE bull:notifications:failed 0 -1
```

3. Review API logs for errors
4. Verify environment variables are set correctly

## Performance Optimization

After migration, consider these optimizations:

### Database Indexing
The migration should include these indexes:
- `Notification.userId` (for user queries)
- `Notification.status` (for filtering)
- `Notification.createdAt` (for sorting)
- `NotificationPreference.userId` (for lookups)

### Queue Configuration
Adjust concurrency based on load:
```bash
# Low traffic
NOTIFICATION_QUEUE_CONCURRENCY=3

# Medium traffic
NOTIFICATION_QUEUE_CONCURRENCY=5

# High traffic
NOTIFICATION_QUEUE_CONCURRENCY=10
```

### Cleanup Old Notifications
Set up a cron job to clean old notifications:
```typescript
// In your notification service
async cleanupOldNotifications(daysToKeep: number = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  await this.prisma.notification.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
      status: { in: ['sent', 'delivered', 'read'] }
    }
  });
}
```

## Support

If you encounter issues during migration:
1. Check the [NOTIFICATION_SETUP.md](./NOTIFICATION_SETUP.md) guide
2. Review application logs for detailed error messages
3. Verify all prerequisites are met
4. Ensure all environment variables are correctly configured

## Next Steps

After successful migration:
1. Configure notification templates for your use cases
2. Set up monitoring and alerts
3. Create custom notification workflows
4. Train users on notification preferences
5. Document any custom configurations

---

**Migration completed successfully?** Don't forget to:
- Update your deployment documentation
- Inform your team about the new notification features
- Monitor the system for the first 24-48 hours
- Collect user feedback on notification delivery
