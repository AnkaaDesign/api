-- ========================================
-- DELETE ALL NOTIFICATIONS FROM DATABASE
-- ========================================
-- ⚠️  WARNING: This will permanently delete ALL notifications and related data
-- Run this script carefully!

BEGIN;

-- Step 1: Delete all notification seen records
DELETE FROM "NotificationSeen";

-- Step 2: Delete all notification deliveries
DELETE FROM "NotificationDelivery";

-- Step 3: Delete all notification preferences (optional - uncomment if needed)
-- DELETE FROM "UserNotificationPreference";

-- Step 4: Delete all notifications
DELETE FROM "Notification";

-- Verify the cleanup
SELECT
  (SELECT COUNT(*) FROM "Notification") as notifications_remaining,
  (SELECT COUNT(*) FROM "NotificationDelivery") as deliveries_remaining,
  (SELECT COUNT(*) FROM "NotificationSeen") as seen_records_remaining;

-- If everything looks good, commit the transaction
COMMIT;

-- If you want to rollback instead, run:
-- ROLLBACK;
