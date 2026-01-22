-- Replace NotificationChannel enum by creating new type and migrating

-- Step 1: Create new enum type
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notificationchannel_new') THEN
        CREATE TYPE "NotificationChannel_new" AS ENUM ('IN_APP', 'PUSH', 'EMAIL', 'WHATSAPP');
    END IF;
END $$;

-- Step 2: Alter all columns using NotificationChannel to use text temporarily and clean data

-- NotificationPreference.channels
ALTER TABLE "NotificationPreference" ALTER COLUMN channels DROP DEFAULT;
ALTER TABLE "NotificationPreference" ALTER COLUMN channels TYPE text[] USING channels::text[];
UPDATE "NotificationPreference" SET channels = array_remove(array_remove(array_remove(channels, 'MOBILE_PUSH'), 'DESKTOP_PUSH'), 'SMS');
UPDATE "NotificationPreference" SET channels = COALESCE(channels, ARRAY[]::text[]);
ALTER TABLE "NotificationPreference" ALTER COLUMN channels TYPE "NotificationChannel_new"[] USING channels::"NotificationChannel_new"[];

-- UserNotificationPreference.channels
ALTER TABLE "UserNotificationPreference" ALTER COLUMN channels DROP DEFAULT;
ALTER TABLE "UserNotificationPreference" ALTER COLUMN channels TYPE text[] USING channels::text[];
UPDATE "UserNotificationPreference" SET channels = array_remove(array_remove(array_remove(channels, 'MOBILE_PUSH'), 'DESKTOP_PUSH'), 'SMS');
UPDATE "UserNotificationPreference" SET channels = COALESCE(channels, ARRAY[]::text[]);
ALTER TABLE "UserNotificationPreference" ALTER COLUMN channels TYPE "NotificationChannel_new"[] USING channels::"NotificationChannel_new"[];

-- UserNotificationPreference.mandatoryChannels
ALTER TABLE "UserNotificationPreference" ALTER COLUMN "mandatoryChannels" DROP DEFAULT;
ALTER TABLE "UserNotificationPreference" ALTER COLUMN "mandatoryChannels" TYPE text[] USING "mandatoryChannels"::text[];
UPDATE "UserNotificationPreference" SET "mandatoryChannels" = array_remove(array_remove(array_remove("mandatoryChannels", 'MOBILE_PUSH'), 'DESKTOP_PUSH'), 'SMS');
UPDATE "UserNotificationPreference" SET "mandatoryChannels" = COALESCE("mandatoryChannels", ARRAY[]::text[]);
ALTER TABLE "UserNotificationPreference" ALTER COLUMN "mandatoryChannels" TYPE "NotificationChannel_new"[] USING "mandatoryChannels"::"NotificationChannel_new"[];

-- Notification.channel
ALTER TABLE "Notification" ALTER COLUMN channel DROP DEFAULT;
ALTER TABLE "Notification" ALTER COLUMN channel TYPE text[] USING channel::text[];
UPDATE "Notification" SET channel = array_remove(array_remove(array_remove(channel, 'MOBILE_PUSH'), 'DESKTOP_PUSH'), 'SMS');
UPDATE "Notification" SET channel = COALESCE(channel, ARRAY[]::text[]);
ALTER TABLE "Notification" ALTER COLUMN channel TYPE "NotificationChannel_new"[] USING channel::"NotificationChannel_new"[];

-- Notification.deliveredChannels
ALTER TABLE "Notification" ALTER COLUMN "deliveredChannels" DROP DEFAULT;
ALTER TABLE "Notification" ALTER COLUMN "deliveredChannels" TYPE text[] USING "deliveredChannels"::text[];
UPDATE "Notification" SET "deliveredChannels" = array_remove(array_remove(array_remove("deliveredChannels", 'MOBILE_PUSH'), 'DESKTOP_PUSH'), 'SMS');
UPDATE "Notification" SET "deliveredChannels" = COALESCE("deliveredChannels", ARRAY[]::text[]);
ALTER TABLE "Notification" ALTER COLUMN "deliveredChannels" TYPE "NotificationChannel_new"[] USING "deliveredChannels"::"NotificationChannel_new"[];

-- Notification.failedChannels
ALTER TABLE "Notification" ALTER COLUMN "failedChannels" DROP DEFAULT;
ALTER TABLE "Notification" ALTER COLUMN "failedChannels" TYPE text[] USING "failedChannels"::text[];
UPDATE "Notification" SET "failedChannels" = array_remove(array_remove(array_remove("failedChannels", 'MOBILE_PUSH'), 'DESKTOP_PUSH'), 'SMS');
UPDATE "Notification" SET "failedChannels" = COALESCE("failedChannels", ARRAY[]::text[]);
ALTER TABLE "Notification" ALTER COLUMN "failedChannels" TYPE "NotificationChannel_new"[] USING "failedChannels"::"NotificationChannel_new"[];

-- NotificationDelivery.channel (single value)
ALTER TABLE "NotificationDelivery" ALTER COLUMN channel DROP DEFAULT;
ALTER TABLE "NotificationDelivery" ALTER COLUMN channel TYPE text USING channel::text;
UPDATE "NotificationDelivery" SET channel = 'PUSH' WHERE channel IN ('MOBILE_PUSH', 'DESKTOP_PUSH', 'SMS');
ALTER TABLE "NotificationDelivery" ALTER COLUMN channel TYPE "NotificationChannel_new" USING channel::"NotificationChannel_new";

-- Step 3: Drop old enum and rename new one
DROP TYPE IF EXISTS "NotificationChannel";
ALTER TYPE "NotificationChannel_new" RENAME TO "NotificationChannel";
