-- Cleanup script to remove test notifications
-- Run this in your PostgreSQL database

-- First, delete all notification deliveries (foreign key constraint)
DELETE FROM "NotificationDelivery"
WHERE "notificationId" IN (
  SELECT id FROM "Notification"
  WHERE title LIKE '%teste%'
  OR title LIKE '%aaa%'
  OR body LIKE '%aaa%'
);

-- Then delete the notifications themselves
DELETE FROM "Notification"
WHERE title LIKE '%teste%'
OR title LIKE '%aaa%'
OR body LIKE '%aaa%';

-- Alternative: Delete ALL notifications (use with caution!)
-- DELETE FROM "NotificationDelivery";
-- DELETE FROM "NotificationSeen";
-- DELETE FROM "Notification";

-- Verify cleanup
SELECT COUNT(*) as remaining_notifications FROM "Notification";
