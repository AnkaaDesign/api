-- Step 1: Add mock dates for admissional and birth where NULL
-- Set admissional to createdAt - 30 days for existing users
UPDATE "User"
SET "admissional" = "createdAt" - INTERVAL '30 days'
WHERE "admissional" IS NULL;

-- Set birth to a default date (1990-01-01) for existing users
UPDATE "User"
SET "birth" = '1990-01-01'::timestamp
WHERE "birth" IS NULL;

-- Step 2: Remove default temporarily
ALTER TABLE "User"
  ALTER COLUMN "status" DROP DEFAULT;

-- Step 3: Alter the UserStatus enum - recreate with new values
-- Note: PostgreSQL doesn't allow removing enum values directly
-- We need to recreate the enum type
-- Create a temporary enum type with all values (old and new)
CREATE TYPE "UserStatus_new" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2', 'CONTRACTED', 'DISMISSED');

-- Update the User table to use the new enum type temporarily
ALTER TABLE "User"
  ALTER COLUMN "status" TYPE "UserStatus_new"
  USING ("status"::text::"UserStatus_new");

-- Drop the old enum type
DROP TYPE "UserStatus";

-- Rename the new enum type to the original name
ALTER TYPE "UserStatus_new" RENAME TO "UserStatus";

-- Step 3: Update existing status values to new enum values
-- Map ACTIVE users to CONTRACTED status
UPDATE "User"
SET "status" = 'CONTRACTED', "statusOrder" = 3
WHERE "status" = 'ACTIVE';

-- Map INACTIVE users to DISMISSED status
UPDATE "User"
SET "status" = 'DISMISSED', "statusOrder" = 4
WHERE "status" = 'INACTIVE';

-- Step 5: Recreate enum with only new values
-- Create final enum type with only the new values
CREATE TYPE "UserStatus_final" AS ENUM ('EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2', 'CONTRACTED', 'DISMISSED');

-- Update the User table to use the final enum type
ALTER TABLE "User"
  ALTER COLUMN "status" TYPE "UserStatus_final"
  USING ("status"::text::"UserStatus_final");

-- Drop the temporary enum type
DROP TYPE "UserStatus";

-- Rename the final enum type to the original name
ALTER TYPE "UserStatus_final" RENAME TO "UserStatus";

-- Step 6: Alter User table to make birth and admissional NOT NULL
ALTER TABLE "User"
  ALTER COLUMN "birth" SET NOT NULL,
  ALTER COLUMN "admissional" SET NOT NULL;

-- Step 7: Update the default value for status in the User table
ALTER TABLE "User"
  ALTER COLUMN "status" SET DEFAULT 'EXPERIENCE_PERIOD_1'::"UserStatus";