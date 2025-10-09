-- Migration: Unify Price and PositionRemuneration into MonetaryValue
-- Description: Creates new MonetaryValue table with 'current' field and migrates data from Price and PositionRemuneration
-- Date: 2025-10-09
--
-- MIGRATION STRATEGY:
-- 1. Create MonetaryValue table
-- 2. Migrate data from Price table (for items)
-- 3. Migrate data from PositionRemuneration table (for positions)
-- 4. Mark most recent values as current
-- 5. Keep old tables for backwards compatibility (can be removed later)

BEGIN;

-- ========================================
-- Step 1: Create MonetaryValue table
-- ========================================

CREATE TABLE IF NOT EXISTS "MonetaryValue" (
  "id" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "current" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "itemId" TEXT,
  "positionId" TEXT,

  CONSTRAINT "MonetaryValue_pkey" PRIMARY KEY ("id")
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "MonetaryValue_itemId_idx" ON "MonetaryValue"("itemId");
CREATE INDEX IF NOT EXISTS "MonetaryValue_positionId_idx" ON "MonetaryValue"("positionId");
CREATE INDEX IF NOT EXISTS "MonetaryValue_current_idx" ON "MonetaryValue"("current");
CREATE INDEX IF NOT EXISTS "MonetaryValue_itemId_current_idx" ON "MonetaryValue"("itemId", "current");
CREATE INDEX IF NOT EXISTS "MonetaryValue_positionId_current_idx" ON "MonetaryValue"("positionId", "current");

-- Add foreign key constraints
ALTER TABLE "MonetaryValue"
  ADD CONSTRAINT "MonetaryValue_itemId_fkey"
  FOREIGN KEY ("itemId")
  REFERENCES "Item"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "MonetaryValue"
  ADD CONSTRAINT "MonetaryValue_positionId_fkey"
  FOREIGN KEY ("positionId")
  REFERENCES "Position"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- ========================================
-- Step 2: Migrate data from Price table
-- ========================================

-- Insert all price records into MonetaryValue with itemId populated
INSERT INTO "MonetaryValue" (id, value, "createdAt", "updatedAt", "itemId", "positionId", current)
SELECT
  id,
  value,
  "createdAt",
  "updatedAt",
  "itemId",
  NULL as "positionId",
  false as current  -- Will be updated in next step
FROM "Price";

-- Mark the most recent price for each item as current
WITH LatestPrices AS (
  SELECT
    mv.id,
    ROW_NUMBER() OVER (PARTITION BY mv."itemId" ORDER BY mv."createdAt" DESC) as rn
  FROM "MonetaryValue" mv
  WHERE mv."itemId" IS NOT NULL
)
UPDATE "MonetaryValue"
SET current = true
WHERE id IN (
  SELECT id FROM LatestPrices WHERE rn = 1
);

-- ========================================
-- Step 3: Migrate data from PositionRemuneration table
-- ========================================

-- Insert all remuneration records into MonetaryValue with positionId populated
INSERT INTO "MonetaryValue" (id, value, "createdAt", "updatedAt", "itemId", "positionId", current)
SELECT
  id,
  value,
  "createdAt",
  "updatedAt",
  NULL as "itemId",
  "positionId",
  false as current  -- Will be updated in next step
FROM "PositionRemuneration";

-- Mark the most recent remuneration for each position as current
WITH LatestRemunerations AS (
  SELECT
    mv.id,
    ROW_NUMBER() OVER (PARTITION BY mv."positionId" ORDER BY mv."createdAt" DESC) as rn
  FROM "MonetaryValue" mv
  WHERE mv."positionId" IS NOT NULL
)
UPDATE "MonetaryValue"
SET current = true
WHERE id IN (
  SELECT id FROM LatestRemunerations WHERE rn = 1
);

-- ========================================
-- Step 4: Verification queries (commented out)
-- ========================================

-- Uncomment these to verify the migration:

-- -- Check total counts match
-- -- SELECT 'Price count:', COUNT(*) FROM "Price";
-- -- SELECT 'PositionRemuneration count:', COUNT(*) FROM "PositionRemuneration";
-- -- SELECT 'MonetaryValue count:', COUNT(*) FROM "MonetaryValue";
-- -- SELECT 'MonetaryValue with itemId:', COUNT(*) FROM "MonetaryValue" WHERE "itemId" IS NOT NULL;
-- -- SELECT 'MonetaryValue with positionId:', COUNT(*) FROM "MonetaryValue" WHERE "positionId" IS NOT NULL;

-- -- Check current flags
-- -- SELECT 'MonetaryValue marked as current:', COUNT(*) FROM "MonetaryValue" WHERE current = true;
-- -- SELECT 'Items with current price:', COUNT(DISTINCT "itemId") FROM "MonetaryValue" WHERE "itemId" IS NOT NULL AND current = true;
-- -- SELECT 'Positions with current remuneration:', COUNT(DISTINCT "positionId") FROM "MonetaryValue" WHERE "positionId" IS NOT NULL AND current = true;

-- ========================================
-- Step 5: Update ChangeLog entity type enum (if needed)
-- ========================================

-- Add MONETARY_VALUE to ChangeLogEntityType enum if it doesn't exist
DO $$ BEGIN
  ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'MONETARY_VALUE';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Note: We're keeping Price and PositionRemuneration tables for backwards compatibility
-- They can be dropped in a future migration after confirming all code is updated

COMMIT;

-- ========================================
-- Rollback script (for emergencies)
-- ========================================

-- To rollback this migration, run:
-- BEGIN;
-- DELETE FROM "MonetaryValue" WHERE "itemId" IS NOT NULL OR "positionId" IS NOT NULL;
-- DROP TABLE IF EXISTS "MonetaryValue";
-- COMMIT;
