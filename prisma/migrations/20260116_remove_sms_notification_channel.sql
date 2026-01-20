-- Migration: Remove SMS from NotificationChannel enum
-- Date: 2026-01-16
-- Reason: SMS (Twilio) is only for password recovery, NOT for notifications

-- Step 1: Remove SMS from all UserNotificationPreference records
UPDATE "UserNotificationPreference"
SET channels = ARRAY(
  SELECT unnest(channels)
  WHERE unnest(channels) != 'SMS'
)
WHERE 'SMS' = ANY(channels);

-- Step 2: Clean up legacy channels (MOBILE_PUSH, DESKTOP_PUSH) and merge to PUSH
UPDATE "UserNotificationPreference"
SET channels = ARRAY(
  SELECT DISTINCT unnest(
    CASE
      WHEN unnest(channels) = 'MOBILE_PUSH' THEN 'PUSH'
      WHEN unnest(channels) = 'DESKTOP_PUSH' THEN 'PUSH'
      ELSE unnest(channels)
    END
  )
  WHERE unnest(channels) NOT IN ('SMS', 'MOBILE_PUSH', 'DESKTOP_PUSH')
     OR unnest(channels) IN ('MOBILE_PUSH', 'DESKTOP_PUSH')
);

-- Step 3: Remove duplicate PUSH entries after merge
UPDATE "UserNotificationPreference"
SET channels = ARRAY(
  SELECT DISTINCT unnest(channels)
);

-- Step 4: Backup old enum
ALTER TYPE "NotificationChannel" RENAME TO "NotificationChannel_old";

-- Step 5: Create new enum with only valid notification channels
CREATE TYPE "NotificationChannel" AS ENUM (
  'IN_APP',
  'PUSH',
  'EMAIL',
  'WHATSAPP'
);

-- Step 6: Update all tables using NotificationChannel
ALTER TABLE "UserNotificationPreference"
  ALTER COLUMN channels TYPE "NotificationChannel"[]
  USING channels::text[]::"NotificationChannel"[];

-- If there are other tables using NotificationChannel, update them here
-- Example:
-- ALTER TABLE "NotificationDelivery"
--   ALTER COLUMN channel TYPE "NotificationChannel"
--   USING channel::text::"NotificationChannel";

-- Step 7: Drop old enum
DROP TYPE "NotificationChannel_old";

-- Step 8: Verify the cleanup
-- This should only show: IN_APP, PUSH, EMAIL, WHATSAPP
SELECT DISTINCT unnest(channels) as channel
FROM "UserNotificationPreference"
ORDER BY channel;

-- Step 9: Log the changes
DO $$
DECLARE
  affected_rows INTEGER;
BEGIN
  SELECT COUNT(*) INTO affected_rows
  FROM "UserNotificationPreference";

  RAISE NOTICE 'Migration completed successfully';
  RAISE NOTICE 'Total UserNotificationPreference records: %', affected_rows;
  RAISE NOTICE 'SMS channel removed from all preferences';
  RAISE NOTICE 'Legacy channels (MOBILE_PUSH, DESKTOP_PUSH) merged to PUSH';
  RAISE NOTICE 'Valid channels now: IN_APP, PUSH, EMAIL, WHATSAPP';
END $$;
