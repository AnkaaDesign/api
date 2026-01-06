# Recommended Prisma Indexes for Notification Module

## Overview
This document contains recommended database indexes to optimize notification query performance. These indexes should be added to your Prisma schema.

---

## Indexes to Add

### 1. Notification Model

```prisma
model Notification {
  id           String                    @id @default(uuid())
  userId       String?
  title        String
  body         String
  type         NotificationType
  channel      NotificationChannel[]
  importance   NotificationImportance    @default(NORMAL)
  actionType   NotificationActionType?
  actionUrl    String?
  scheduledAt  DateTime?
  sentAt       DateTime?
  createdAt    DateTime                  @default(now())
  updatedAt    DateTime                  @updatedAt

  user         User?                     @relation(fields: [userId], references: [id], onDelete: Cascade)
  seenBy       SeenNotification[]
  deliveries   NotificationDelivery[]

  // Performance Indexes
  @@index([userId, createdAt], name: "idx_notification_user_created")
  @@index([type, sentAt], name: "idx_notification_type_sent")
  @@index([scheduledAt], name: "idx_notification_scheduled")
  @@index([sentAt], name: "idx_notification_sent")
  @@index([importance, createdAt], name: "idx_notification_importance_created")
}
```

**Index Explanations**:

1. `@@index([userId, createdAt])` - **idx_notification_user_created**
   - **Purpose**: Optimize user notification queries sorted by date
   - **Used by**:
     - `getNotificationsByUser()`
     - `getUnseenNotifications()`
     - User dashboard queries
   - **Impact**: Fast retrieval of user's notifications in chronological order

2. `@@index([type, sentAt])` - **idx_notification_type_sent**
   - **Purpose**: Filter notifications by type and sent status
   - **Used by**:
     - Admin analytics queries
     - Type-based notification reports
     - Sent notification filtering
   - **Impact**: Efficient type-based queries with date filtering

3. `@@index([scheduledAt])` - **idx_notification_scheduled**
   - **Purpose**: Find notifications scheduled for sending
   - **Used by**:
     - `findScheduledNotifications()`
     - Scheduler cron jobs
     - Scheduled notification processing
   - **Impact**: Fast scheduled notification lookups for background jobs

4. `@@index([sentAt])` - **idx_notification_sent**
   - **Purpose**: Find unsent or sent notifications
   - **Used by**:
     - `deleteOldNotifications()`
     - Cleanup jobs
     - Sent vs pending queries
   - **Impact**: Efficient filtering by sent status

5. `@@index([importance, createdAt])` - **idx_notification_importance_created**
   - **Purpose**: Sort notifications by importance and date
   - **Used by**:
     - Priority-based notification retrieval
     - Important notification dashboards
   - **Impact**: Fast priority-based sorting

---

### 2. SeenNotification Model

```prisma
model SeenNotification {
  id             String       @id @default(uuid())
  notificationId String
  userId         String
  seenAt         DateTime     @default(now())
  remindAt       DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  notification   Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Performance Indexes
  @@unique([notificationId, userId], name: "unique_notification_user")
  @@index([userId, seenAt], name: "idx_seen_user_date")
  @@index([notificationId], name: "idx_seen_notification")
  @@index([remindAt], name: "idx_seen_remind")
}
```

**Index Explanations**:

1. `@@unique([notificationId, userId])` - **unique_notification_user**
   - **Purpose**: Ensure a user can only mark a notification as seen once
   - **Used by**:
     - `markAsSeen()`
     - Prevent duplicate seen records
   - **Impact**: Data integrity + fast duplicate checks

2. `@@index([userId, seenAt])` - **idx_seen_user_date**
   - **Purpose**: Get user's seen notifications by date
   - **Used by**:
     - `getSeenNotificationsByUser()`
     - User read history
   - **Impact**: Fast user read history queries

3. `@@index([notificationId])` - **idx_seen_notification**
   - **Purpose**: Find all users who saw a notification
   - **Used by**:
     - `getSeenNotificationsByNotification()`
     - Analytics queries
   - **Impact**: Fast notification read count queries

4. `@@index([remindAt])` - **idx_seen_remind**
   - **Purpose**: Find due reminders
   - **Used by**:
     - `findDueReminders()`
     - Reminder scheduler cron jobs
   - **Impact**: Efficient reminder processing

---

### 3. NotificationDelivery Model

```prisma
model NotificationDelivery {
  id             String              @id @default(uuid())
  notificationId String
  channel        NotificationChannel
  status         DeliveryStatus      @default(PENDING)
  sentAt         DateTime?
  deliveredAt    DateTime?
  failedAt       DateTime?
  errorMessage   String?
  retryCount     Int                 @default(0)
  metadata       Json?
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  notification   Notification        @relation(fields: [notificationId], references: [id], onDelete: Cascade)

  // Performance Indexes
  @@index([notificationId, channel], name: "idx_delivery_notification_channel")
  @@index([status, updatedAt], name: "idx_delivery_status_updated")
  @@index([retryCount, status], name: "idx_delivery_retry_status")
  @@index([channel, status], name: "idx_delivery_channel_status")
}
```

**Index Explanations**:

1. `@@index([notificationId, channel])` - **idx_delivery_notification_channel**
   - **Purpose**: Find delivery status for specific notification and channel
   - **Used by**:
     - `findByNotificationAndChannel()`
     - Channel-specific delivery updates
   - **Impact**: Fast delivery record lookups

2. `@@index([status, updatedAt])` - **idx_delivery_status_updated**
   - **Purpose**: Find deliveries by status ordered by update time
   - **Used by**:
     - `findFailedDeliveries()`
     - Retry processing
     - Status monitoring
   - **Impact**: Efficient retry queue processing

3. `@@index([retryCount, status])` - **idx_delivery_retry_status**
   - **Purpose**: Find failed deliveries eligible for retry
   - **Used by**:
     - `findFailedDeliveries({ maxRetries })`
     - Retry scheduling
   - **Impact**: Fast retry eligibility checks

4. `@@index([channel, status])` - **idx_delivery_channel_status**
   - **Purpose**: Channel-specific delivery statistics
   - **Used by**:
     - Channel performance analytics
     - Channel-based filtering
   - **Impact**: Efficient channel analytics

---

### 4. UserNotificationPreference Model

```prisma
model UserNotificationPreference {
  id               String              @id @default(uuid())
  userId           String
  notificationType NotificationType
  eventType        String?
  enabled          Boolean             @default(true)
  channels         NotificationChannel[]
  isMandatory      Boolean             @default(false)
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt

  user             User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Performance Indexes
  @@unique([userId, notificationType, eventType], name: "unique_user_type_event")
  @@index([userId, notificationType], name: "idx_pref_user_type")
  @@index([enabled], name: "idx_pref_enabled")
  @@index([notificationType, enabled], name: "idx_pref_type_enabled")
}
```

**Index Explanations**:

1. `@@unique([userId, notificationType, eventType])` - **unique_user_type_event**
   - **Purpose**: One preference per user per notification type/event
   - **Used by**:
     - Preference creation/update
     - Prevent duplicate preferences
   - **Impact**: Data integrity + fast preference lookups

2. `@@index([userId, notificationType])` - **idx_pref_user_type**
   - **Purpose**: Get user's preference for specific notification type
   - **Used by**:
     - `getUserChannels()`
     - Preference retrieval during dispatch
   - **Impact**: Fast preference lookups during notification sending

3. `@@index([enabled])` - **idx_pref_enabled**
   - **Purpose**: Find enabled/disabled preferences
   - **Used by**:
     - Preference statistics
     - Enabled preference counts
   - **Impact**: Fast preference filtering

4. `@@index([notificationType, enabled])` - **idx_pref_type_enabled**
   - **Purpose**: Find enabled preferences by type
   - **Used by**:
     - Type-based preference queries
     - Preference analytics
   - **Impact**: Efficient type-based preference filtering

---

### 5. NotificationPreference Model (Global Defaults)

```prisma
model NotificationPreference {
  id               String              @id @default(uuid())
  notificationType NotificationType    @unique
  channels         NotificationChannel[]
  enabled          Boolean             @default(true)
  isMandatory      Boolean             @default(false)
  description      String?
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt

  // Performance Indexes
  @@index([notificationType], name: "idx_global_pref_type")
  @@index([enabled], name: "idx_global_pref_enabled")
}
```

**Index Explanations**:

1. `@@index([notificationType])` - **idx_global_pref_type**
   - **Purpose**: Fast global preference lookups by type
   - **Used by**:
     - `getUserChannels()` fallback
     - Default preference retrieval
   - **Impact**: Fast default preference lookups

2. `@@index([enabled])` - **idx_global_pref_enabled**
   - **Purpose**: Find enabled global preferences
   - **Used by**:
     - Preference management
     - Admin queries
   - **Impact**: Efficient global preference filtering

---

## Migration Instructions

### Step 1: Add Indexes to Schema
Copy the index definitions above into your Prisma schema file.

### Step 2: Generate Migration
```bash
npx prisma migrate dev --name add_notification_indexes
```

### Step 3: Apply to Production
```bash
npx prisma migrate deploy
```

### Step 4: Verify Indexes
```sql
-- PostgreSQL
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename LIKE 'Notification%'
ORDER BY tablename, indexname;

-- MySQL
SHOW INDEX FROM Notification;
SHOW INDEX FROM SeenNotification;
SHOW INDEX FROM NotificationDelivery;
SHOW INDEX FROM UserNotificationPreference;
```

---

## Expected Performance Impact

### Before Indexes
- User notification queries: ~100-500ms (10,000+ records)
- Scheduled notification lookup: ~200-800ms
- Delivery status queries: ~150-600ms
- Reminder processing: ~300-1000ms

### After Indexes
- User notification queries: ~10-50ms (80-95% improvement)
- Scheduled notification lookup: ~20-80ms (90% improvement)
- Delivery status queries: ~15-60ms (90% improvement)
- Reminder processing: ~30-100ms (90% improvement)

**Note**: Actual performance depends on:
- Database size
- Hardware specs
- Concurrent query load
- Database configuration

---

## Index Maintenance

### Monitoring Index Usage
```sql
-- PostgreSQL: Check index usage
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND tablename LIKE 'Notification%'
ORDER BY idx_scan DESC;

-- Find unused indexes
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan = 0
  AND indexname NOT LIKE '%pkey%'
ORDER BY tablename;
```

### Rebuilding Indexes (PostgreSQL)
```sql
-- If indexes become fragmented
REINDEX TABLE "Notification";
REINDEX TABLE "SeenNotification";
REINDEX TABLE "NotificationDelivery";
REINDEX TABLE "UserNotificationPreference";
```

### Analyzing Tables
```sql
-- Update statistics for query planner
ANALYZE "Notification";
ANALYZE "SeenNotification";
ANALYZE "NotificationDelivery";
ANALYZE "UserNotificationPreference";
```

---

## Best Practices

1. **Add indexes gradually** - Monitor performance after each addition
2. **Avoid over-indexing** - Too many indexes slow down writes
3. **Monitor index size** - Indexes consume disk space
4. **Update statistics regularly** - Helps query planner make better decisions
5. **Test in staging first** - Verify performance improvements
6. **Consider composite indexes** - More efficient than multiple single-column indexes
7. **Remove unused indexes** - Monitor index usage and remove if not used

---

## Troubleshooting

### Slow Queries After Adding Indexes
1. Check if query planner is using the index:
   ```sql
   EXPLAIN ANALYZE SELECT * FROM "Notification"
   WHERE "userId" = 'xxx'
   ORDER BY "createdAt" DESC;
   ```

2. Update table statistics:
   ```sql
   ANALYZE "Notification";
   ```

3. Consider index-only scans by adding more columns to index

### High Index Maintenance Cost
If writes are slow after adding indexes:
1. Evaluate which indexes are actually used
2. Remove unused indexes
3. Consider partial indexes for specific conditions
4. Use covering indexes to reduce table lookups

---

## Summary

Adding these indexes will significantly improve notification query performance, especially for:
- User notification retrieval
- Scheduled notification processing
- Delivery tracking queries
- Reminder management
- Preference lookups

**Estimated total improvement**: 80-95% faster queries for common operations
