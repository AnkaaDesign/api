-- Rollback SQL for Comprehensive Notification System Migration
-- Use this file to rollback the notification system changes if needed

-- Drop new tables
DROP TABLE IF EXISTS "NotificationDelivery";
DROP TABLE IF EXISTS "UserNotificationPreference";
DROP TABLE IF EXISTS "DeviceToken";

-- Revert Notification table changes to original state
-- Note: This assumes you want to rollback to the state before the comprehensive notification system
-- Adjust column drops based on what was added in the migration

-- Drop new columns from Notification table (if they were added)
ALTER TABLE "Notification" DROP COLUMN IF EXISTS "deliveredAt";
ALTER TABLE "Notification" DROP COLUMN IF EXISTS "deliveredChannels";
ALTER TABLE "Notification" DROP COLUMN IF EXISTS "failedChannels";
ALTER TABLE "Notification" DROP COLUMN IF EXISTS "retryCount";
ALTER TABLE "Notification" DROP COLUMN IF EXISTS "relatedEntityType";
ALTER TABLE "Notification" DROP COLUMN IF EXISTS "relatedEntityId";
ALTER TABLE "Notification" DROP COLUMN IF EXISTS "targetSectors";
ALTER TABLE "Notification" DROP COLUMN IF EXISTS "isMandatory";

-- Remove new enum values (this is more complex and may require recreating the enums)
-- Note: PostgreSQL doesn't support removing enum values directly
-- You would need to:
-- 1. Create new enum types without the new values
-- 2. Alter tables to use the new enum types
-- 3. Drop the old enum types
-- This is a destructive operation and should be done carefully

-- Example for NotificationChannel enum (if new values were added):
-- CREATE TYPE "NotificationChannel_old" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'IN_APP');
-- ALTER TABLE "Notification" ALTER COLUMN "channel" TYPE "NotificationChannel_old"[] USING "channel"::text::"NotificationChannel_old"[];
-- DROP TYPE "NotificationChannel";
-- ALTER TYPE "NotificationChannel_old" RENAME TO "NotificationChannel";

-- Example for NotificationType enum (if new values were added):
-- You'll need to handle this based on which values were added

-- IMPORTANT: Review the actual migration file to see exactly what changes were made
-- and adjust this rollback script accordingly before executing.

-- After running this rollback:
-- 1. Remove the migration file from prisma/migrations/
-- 2. Update your schema.prisma to reflect the rolled back state
-- 3. Run: npx prisma migrate resolve --rolled-back <migration-name>
-- 4. Run: npx prisma generate to update the Prisma Client
