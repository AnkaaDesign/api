-- Add new enum values to UserStatus
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'EXPERIENCE_PERIOD_1';
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'EXPERIENCE_PERIOD_2';
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'CONTRACTED';
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'DISMISSED';

-- Update existing users
UPDATE "User" SET "status" = 'CONTRACTED', "statusOrder" = 3 WHERE "status" = 'ACTIVE';
UPDATE "User" SET "status" = 'DISMISSED', "statusOrder" = 4 WHERE "status" = 'INACTIVE';