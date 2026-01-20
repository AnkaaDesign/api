-- Migration: Convert Layout from One-to-One to One-to-Many (Shared Resource)
-- Date: 2026-01-21
-- Description: Remove @unique constraints from Truck layout foreign keys to allow multiple trucks to share the same layout

-- Step 1: Drop unique constraints on Truck layout foreign keys
-- This allows multiple trucks to reference the same layout
DROP INDEX IF EXISTS "Truck_backSideLayoutId_key";
DROP INDEX IF EXISTS "Truck_leftSideLayoutId_key";
DROP INDEX IF EXISTS "Truck_rightSideLayoutId_key";

-- Step 2: Add regular indexes for performance (non-unique)
-- These help with queries like "find all trucks using layout X"
CREATE INDEX IF NOT EXISTS "Truck_backSideLayoutId_idx" ON "Truck"("backSideLayoutId");
CREATE INDEX IF NOT EXISTS "Truck_leftSideLayoutId_idx" ON "Truck"("leftSideLayoutId");
CREATE INDEX IF NOT EXISTS "Truck_rightSideLayoutId_idx" ON "Truck"("rightSideLayoutId");

-- Step 3: No data migration needed - existing layout references remain valid
-- The only change is that NOW multiple trucks CAN share the same layout
-- Previous individual layouts can still exist until explicitly merged/standardized

-- Step 4: Add metadata to track shared vs individual layouts (optional future enhancement)
-- ALTER TABLE "Layout" ADD COLUMN "isTemplate" BOOLEAN DEFAULT false;
-- ALTER TABLE "Layout" ADD COLUMN "templateName" TEXT;
-- ALTER TABLE "Layout" ADD COLUMN "description" TEXT;

-- Migration completed successfully
-- Next steps:
-- 1. Update Prisma schema to reflect changes (Truck? -> Truck[])
-- 2. Update Layout service to handle shared layouts
-- 3. Add safety checks before deleting layouts (check usage count)
