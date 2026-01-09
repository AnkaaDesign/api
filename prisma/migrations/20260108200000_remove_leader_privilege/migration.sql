-- Remove LEADER privilege from SectorPrivileges enum
-- Convert all existing LEADER sectors to PRODUCTION

-- First, update all sectors with LEADER privilege to PRODUCTION
UPDATE "Sector"
SET "privileges" = 'PRODUCTION'
WHERE "privileges" = 'LEADER';

-- Note: User table doesn't have a privilege column, it inherits from sector
-- So no need to update users directly

-- Now safely remove LEADER from the enum
-- Step 1: Create new enum without LEADER
CREATE TYPE "SectorPrivileges_new" AS ENUM (
  'BASIC',
  'PRODUCTION',
  'MAINTENANCE',
  'WAREHOUSE',
  'PLOTTING',
  'ADMIN',
  'HUMAN_RESOURCES',
  'EXTERNAL',
  'DESIGNER',
  'FINANCIAL',
  'LOGISTIC',
  'COMMERCIAL'
);

-- Step 2: Drop default constraint temporarily
ALTER TABLE "Sector"
  ALTER COLUMN "privileges" DROP DEFAULT;

-- Step 3: Alter Sector table to use new enum
ALTER TABLE "Sector"
  ALTER COLUMN "privileges" TYPE "SectorPrivileges_new"
  USING ("privileges"::text::"SectorPrivileges_new");

-- Step 4: Update Notification table targetSectors
ALTER TABLE "Notification"
  ALTER COLUMN "targetSectors" TYPE "SectorPrivileges_new"[]
  USING ("targetSectors"::text[]::"SectorPrivileges_new"[]);

-- Step 5: Update MessageTarget table sectorPrivilege
ALTER TABLE "MessageTarget"
  ALTER COLUMN "sectorPrivilege" TYPE "SectorPrivileges_new"
  USING ("sectorPrivilege"::text::"SectorPrivileges_new");

-- Step 6: Drop old enum and rename new one
DROP TYPE "SectorPrivileges";
ALTER TYPE "SectorPrivileges_new" RENAME TO "SectorPrivileges";

-- Step 7: Restore default constraint
ALTER TABLE "Sector"
  ALTER COLUMN "privileges" SET DEFAULT 'BASIC'::"SectorPrivileges";

-- Add comment documenting the change
COMMENT ON TYPE "SectorPrivileges" IS 'Sector privilege levels. LEADER was removed - use PRODUCTION with managerId check for team leader functionality.';
