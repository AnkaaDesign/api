-- Migration: Sector Manager Relation
-- This migration changes the leader relationship from User -> Sector to Sector -> User
-- and removes the LEADER privilege from the enum

-- Step 1: Add managerId column to Sector table
ALTER TABLE "Sector" ADD COLUMN "managerId" TEXT;

-- Step 2: Migrate data from User.managedSectorId to Sector.managerId
-- For each user that has a managedSectorId, set the corresponding sector's managerId
UPDATE "Sector" s
SET "managerId" = u.id
FROM "User" u
WHERE u."managedSectorId" = s.id;

-- Step 3: Add unique constraint on managerId (one manager per sector)
CREATE UNIQUE INDEX "Sector_managerId_key" ON "Sector"("managerId");

-- Step 4: Create index on managerId for performance
CREATE INDEX "Sector_managerId_idx" ON "Sector"("managerId");

-- Step 5: Add foreign key constraint
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 6: Convert sectors with LEADER privilege to PRODUCTION
UPDATE "Sector" SET "privileges" = 'PRODUCTION' WHERE "privileges" = 'LEADER';

-- Step 7: Drop the managedSectorId column from User table
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_managedSectorId_fkey";
ALTER TABLE "User" DROP COLUMN IF EXISTS "managedSectorId";

-- Note: The LEADER value will be removed from SectorPrivileges enum by Prisma
-- after regenerating the client. Any remaining LEADER values should have been
-- converted to PRODUCTION in Step 6.
