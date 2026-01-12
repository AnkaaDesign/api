-- Migration: Add Service Order Creation and Status Change Notification Preferences
-- This migration adds notification preferences for:
-- 1. service-order.created event (for ADMINs to be notified when service orders are created)
-- 2. service-order.status.changed event (for ADMINs to be notified when service order status changes)

-- ========================================
-- Add 'created' event preference for SERVICE_ORDER notifications
-- ========================================
INSERT INTO "UserNotificationPreference" (
  "id",
  "userId",
  "notificationType",
  "eventType",
  "enabled",
  "channels",
  "isMandatory",
  "mandatoryChannels",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid() AS "id",
  u."id" AS "userId",
  'SERVICE_ORDER'::"NotificationType" AS "notificationType",
  'created' AS "eventType",
  true AS "enabled",
  ARRAY['IN_APP', 'PUSH', 'WHATSAPP']::"NotificationChannel"[] AS "channels",
  true AS "isMandatory",
  ARRAY['IN_APP', 'PUSH', 'WHATSAPP']::"NotificationChannel"[] AS "mandatoryChannels",
  NOW() AS "createdAt",
  NOW() AS "updatedAt"
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1
  FROM "UserNotificationPreference" unp
  WHERE unp."userId" = u."id"
    AND unp."notificationType" = 'SERVICE_ORDER'
    AND unp."eventType" = 'created'
);

-- ========================================
-- Add 'status.changed' event preference for SERVICE_ORDER notifications
-- ========================================
INSERT INTO "UserNotificationPreference" (
  "id",
  "userId",
  "notificationType",
  "eventType",
  "enabled",
  "channels",
  "isMandatory",
  "mandatoryChannels",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid() AS "id",
  u."id" AS "userId",
  'SERVICE_ORDER'::"NotificationType" AS "notificationType",
  'status.changed' AS "eventType",
  true AS "enabled",
  ARRAY['IN_APP', 'PUSH', 'WHATSAPP']::"NotificationChannel"[] AS "channels",
  true AS "isMandatory",
  ARRAY['IN_APP', 'PUSH', 'WHATSAPP']::"NotificationChannel"[] AS "mandatoryChannels",
  NOW() AS "createdAt",
  NOW() AS "updatedAt"
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1
  FROM "UserNotificationPreference" unp
  WHERE unp."userId" = u."id"
    AND unp."notificationType" = 'SERVICE_ORDER'
    AND unp."eventType" = 'status.changed'
);

-- ========================================
-- Verification: Log counts
-- ========================================
-- This is a comment-only verification - actual implementation would use a logging mechanism
-- Expected: All existing users should now have preferences for:
--   - SERVICE_ORDER / created
--   - SERVICE_ORDER / status.changed
