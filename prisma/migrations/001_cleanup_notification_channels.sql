-- Migration: 001_cleanup_notification_channels
-- Description: Clean up invalid notification channels from preference tables
-- Date: 2026-01-16
--
-- IMPORTANT: This migration converts legacy channel values to the correct 4-channel system:
-- - MOBILE_PUSH → PUSH
-- - DESKTOP_PUSH → PUSH
-- - SMS → (removed)
--
-- Valid channels in preferences: IN_APP, PUSH, EMAIL, WHATSAPP

-- =====================================================
-- 1. Update UserNotificationPreference.channels
-- =====================================================
UPDATE "UserNotificationPreference"
SET channels = ARRAY(
  SELECT DISTINCT
    CASE
      WHEN unnest = 'MOBILE_PUSH' THEN 'PUSH'
      WHEN unnest = 'DESKTOP_PUSH' THEN 'PUSH'
      ELSE unnest
    END
  FROM unnest(channels)
  WHERE unnest NOT IN ('SMS')
)::\"NotificationChannel\"[]
WHERE 'MOBILE_PUSH' = ANY(channels)
   OR 'DESKTOP_PUSH' = ANY(channels)
   OR 'SMS' = ANY(channels);

-- =====================================================
-- 2. Update UserNotificationPreference.mandatoryChannels
-- =====================================================
UPDATE "UserNotificationPreference"
SET "mandatoryChannels" = ARRAY(
  SELECT DISTINCT
    CASE
      WHEN unnest = 'MOBILE_PUSH' THEN 'PUSH'
      WHEN unnest = 'DESKTOP_PUSH' THEN 'PUSH'
      ELSE unnest
    END
  FROM unnest("mandatoryChannels")
  WHERE unnest NOT IN ('SMS')
)::\"NotificationChannel\"[]
WHERE 'MOBILE_PUSH' = ANY("mandatoryChannels")
   OR 'DESKTOP_PUSH' = ANY("mandatoryChannels")
   OR 'SMS' = ANY("mandatoryChannels");

-- =====================================================
-- 3. Update NotificationPreference.channels (global defaults)
-- =====================================================
UPDATE "NotificationPreference"
SET channels = ARRAY(
  SELECT DISTINCT
    CASE
      WHEN unnest = 'MOBILE_PUSH' THEN 'PUSH'
      WHEN unnest = 'DESKTOP_PUSH' THEN 'PUSH'
      ELSE unnest
    END
  FROM unnest(channels)
  WHERE unnest NOT IN ('SMS')
)::\"NotificationChannel\"[]
WHERE 'MOBILE_PUSH' = ANY(channels)
   OR 'DESKTOP_PUSH' = ANY(channels)
   OR 'SMS' = ANY(channels);

-- =====================================================
-- 4. Update Notification.channel (existing notifications)
-- =====================================================
UPDATE "Notification"
SET channel = ARRAY(
  SELECT DISTINCT
    CASE
      WHEN unnest = 'MOBILE_PUSH' THEN 'PUSH'
      WHEN unnest = 'DESKTOP_PUSH' THEN 'PUSH'
      ELSE unnest
    END
  FROM unnest(channel)
  WHERE unnest NOT IN ('SMS')
)::\"NotificationChannel\"[]
WHERE 'MOBILE_PUSH' = ANY(channel)
   OR 'DESKTOP_PUSH' = ANY(channel)
   OR 'SMS' = ANY(channel);

-- =====================================================
-- 5. Update Notification.deliveredChannels
-- =====================================================
UPDATE "Notification"
SET "deliveredChannels" = ARRAY(
  SELECT DISTINCT
    CASE
      WHEN unnest = 'MOBILE_PUSH' THEN 'PUSH'
      WHEN unnest = 'DESKTOP_PUSH' THEN 'PUSH'
      ELSE unnest
    END
  FROM unnest("deliveredChannels")
  WHERE unnest NOT IN ('SMS')
)::\"NotificationChannel\"[]
WHERE 'MOBILE_PUSH' = ANY("deliveredChannels")
   OR 'DESKTOP_PUSH' = ANY("deliveredChannels")
   OR 'SMS' = ANY("deliveredChannels");

-- =====================================================
-- 6. Update Notification.failedChannels
-- =====================================================
UPDATE "Notification"
SET "failedChannels" = ARRAY(
  SELECT DISTINCT
    CASE
      WHEN unnest = 'MOBILE_PUSH' THEN 'PUSH'
      WHEN unnest = 'DESKTOP_PUSH' THEN 'PUSH'
      ELSE unnest
    END
  FROM unnest("failedChannels")
  WHERE unnest NOT IN ('SMS')
)::\"NotificationChannel\"[]
WHERE 'MOBILE_PUSH' = ANY("failedChannels")
   OR 'DESKTOP_PUSH' = ANY("failedChannels")
   OR 'SMS' = ANY("failedChannels");

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================
-- Run these to verify the migration was successful
-- All counts should be 0

-- Check UserNotificationPreference
SELECT
  'UserNotificationPreference' as table_name,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE 'MOBILE_PUSH' = ANY(channels)) as with_mobile_push_channels,
  COUNT(*) FILTER (WHERE 'DESKTOP_PUSH' = ANY(channels)) as with_desktop_push_channels,
  COUNT(*) FILTER (WHERE 'SMS' = ANY(channels)) as with_sms_channels,
  COUNT(*) FILTER (WHERE 'MOBILE_PUSH' = ANY("mandatoryChannels")) as with_mobile_push_mandatory,
  COUNT(*) FILTER (WHERE 'DESKTOP_PUSH' = ANY("mandatoryChannels")) as with_desktop_push_mandatory,
  COUNT(*) FILTER (WHERE 'SMS' = ANY("mandatoryChannels")) as with_sms_mandatory
FROM "UserNotificationPreference"

UNION ALL

-- Check NotificationPreference
SELECT
  'NotificationPreference' as table_name,
  COUNT(*),
  COUNT(*) FILTER (WHERE 'MOBILE_PUSH' = ANY(channels)),
  COUNT(*) FILTER (WHERE 'DESKTOP_PUSH' = ANY(channels)),
  COUNT(*) FILTER (WHERE 'SMS' = ANY(channels)),
  0 as _1, 0 as _2, 0 as _3  -- NotificationPreference doesn't have mandatoryChannels
FROM "NotificationPreference"

UNION ALL

-- Check Notification
SELECT
  'Notification' as table_name,
  COUNT(*),
  COUNT(*) FILTER (WHERE 'MOBILE_PUSH' = ANY(channel)),
  COUNT(*) FILTER (WHERE 'DESKTOP_PUSH' = ANY(channel)),
  COUNT(*) FILTER (WHERE 'SMS' = ANY(channel)),
  COUNT(*) FILTER (WHERE 'MOBILE_PUSH' = ANY("deliveredChannels")),
  COUNT(*) FILTER (WHERE 'DESKTOP_PUSH' = ANY("deliveredChannels")),
  COUNT(*) FILTER (WHERE 'SMS' = ANY("deliveredChannels"))
FROM "Notification";

-- =====================================================
-- CHANNEL DISTRIBUTION REPORT
-- =====================================================
-- Shows how many preferences use each channel after migration

SELECT
  'UserNotificationPreference' as source,
  unnest(channels) as channel,
  COUNT(*) as count
FROM "UserNotificationPreference"
GROUP BY channel
ORDER BY count DESC;

-- =====================================================
-- NOTES
-- =====================================================
--
-- 1. NotificationDelivery table is NOT updated because it represents
--    actual deliveries using dispatch-layer channels (MOBILE_PUSH, WEB_PUSH, SMS)
--    These are valid at the delivery layer, just not at the preference layer
--
-- 2. After this migration, only 4 channels should exist in preference tables:
--    - IN_APP
--    - PUSH (unified, replaces MOBILE_PUSH and DESKTOP_PUSH)
--    - EMAIL
--    - WHATSAPP
--
-- 3. SMS is completely removed from notification preferences
--    SMS should only be used for password recovery via Twilio
--
-- 4. Rollback: If needed, this migration cannot be easily rolled back
--    because we're consolidating MOBILE_PUSH and DESKTOP_PUSH into PUSH
--    You would need to restore from a database backup
