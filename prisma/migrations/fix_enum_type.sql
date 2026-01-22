-- Safe enum value removal for PostgreSQL
-- First ensure no data uses the old values, then remove them from the enum type

-- Step 1: Final cleanup of any remaining old enum values in data
-- Update arrays to remove old values
UPDATE "NotificationPreference"
SET channels = (
  SELECT array_agg(DISTINCT val)
  FROM unnest(channels::text[]) AS val
  WHERE val NOT IN ('MOBILE_PUSH', 'DESKTOP_PUSH', 'SMS')
)::"NotificationChannel"[]
WHERE channels::text[] && ARRAY['MOBILE_PUSH', 'DESKTOP_PUSH', 'SMS'];

UPDATE "Notification"
SET channel = (
  SELECT array_agg(DISTINCT val)
  FROM unnest(channel::text[]) AS val
  WHERE val NOT IN ('MOBILE_PUSH', 'DESKTOP_PUSH', 'SMS')
)::"NotificationChannel"[]
WHERE channel::text[] && ARRAY['MOBILE_PUSH', 'DESKTOP_PUSH', 'SMS'];

UPDATE "Notification"
SET "deliveredChannels" = (
  SELECT array_agg(DISTINCT val)
  FROM unnest("deliveredChannels"::text[]) AS val
  WHERE val NOT IN ('MOBILE_PUSH', 'DESKTOP_PUSH', 'SMS')
)::"NotificationChannel"[]
WHERE "deliveredChannels"::text[] && ARRAY['MOBILE_PUSH', 'DESKTOP_PUSH', 'SMS'];

UPDATE "Notification"
SET "failedChannels" = (
  SELECT array_agg(DISTINCT val)
  FROM unnest("failedChannels"::text[]) AS val
  WHERE val NOT IN ('MOBILE_PUSH', 'DESKTOP_PUSH', 'SMS')
)::"NotificationChannel"[]
WHERE "failedChannels"::text[] && ARRAY['MOBILE_PUSH', 'DESKTOP_PUSH', 'SMS'];

UPDATE "NotificationDelivery"
SET channel = 'PUSH'
WHERE channel::text IN ('MOBILE_PUSH', 'DESKTOP_PUSH', 'SMS');

-- Step 2: For PostgreSQL, we can't easily remove enum values
-- The safest approach is to let Prisma handle this with --force-reset if needed
-- Or create a new enum and migrate
