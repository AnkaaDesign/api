-- Find and fix column defaults that reference old NotificationChannel enum values

-- Drop default constraints on NotificationChannel columns
ALTER TABLE "NotificationPreference" ALTER COLUMN channels DROP DEFAULT;
ALTER TABLE "Notification" ALTER COLUMN channel DROP DEFAULT;
ALTER TABLE "Notification" ALTER COLUMN "deliveredChannels" DROP DEFAULT;
ALTER TABLE "Notification" ALTER COLUMN "failedChannels" DROP DEFAULT;
ALTER TABLE "NotificationDelivery" ALTER COLUMN channel DROP DEFAULT;
