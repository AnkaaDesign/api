-- Migration: Replace CORRUGATED implement type with DRY_CARGO and REFRIGERATED
-- Date: 2026-01-30
-- Description: This migration replaces the CORRUGATED enum value with two new values:
--   - DRY_CARGO (Carga Seca)
--   - REFRIGERATED (Refrigerado)
-- Existing CORRUGATED entries will be migrated to REFRIGERATED as the new default.

-- Step 1: Create new enum type with desired values (without CORRUGATED)
CREATE TYPE "ImplementType_new" AS ENUM ('DRY_CARGO', 'REFRIGERATED', 'INSULATED', 'CURTAIN_SIDE', 'TANK', 'FLATBED');

-- Step 2: Alter column to use the new type, converting CORRUGATED -> REFRIGERATED in the same step
ALTER TABLE "Truck"
  ALTER COLUMN "implementType" TYPE "ImplementType_new"
  USING (
    CASE "implementType"::text
      WHEN 'CORRUGATED' THEN 'REFRIGERATED'
      ELSE "implementType"::text
    END
  )::"ImplementType_new";

-- Step 3: Drop old type and rename new type
DROP TYPE "ImplementType";
ALTER TYPE "ImplementType_new" RENAME TO "ImplementType";
