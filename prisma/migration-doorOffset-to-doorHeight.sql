-- Migration: Rename doorOffset to doorHeight and remove sections field from Layout
-- Date: 2024
-- Description:
--   1. Rename 'doorOffset' column to 'doorHeight' in LayoutSection table
--   2. Remove 'sections' JSON column from Layout table
--   3. Update existing data - convert doorOffset (from top) to doorHeight (from bottom)
--      Formula: doorHeight = layoutHeight - doorOffset

-- Step 1: First, let's update the existing doorOffset values to doorHeight values
-- doorHeight = layout.height - doorOffset
-- We need to join with Layout to get the height
UPDATE "LayoutSection" AS ls
SET "doorOffset" = (
    SELECT l.height - ls."doorOffset"
    FROM "Layout" AS l
    WHERE l.id = ls."layoutId"
)
WHERE ls."isDoor" = true AND ls."doorOffset" IS NOT NULL;

-- Step 2: Rename the column from doorOffset to doorHeight
ALTER TABLE "LayoutSection" RENAME COLUMN "doorOffset" TO "doorHeight";

-- Step 3: Remove the sections JSON column from Layout table (if it exists)
-- Check if the column exists before dropping
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'Layout' AND column_name = 'sections'
    ) THEN
        ALTER TABLE "Layout" DROP COLUMN "sections";
    END IF;
END $$;

-- Step 4: Add a comment to the column for documentation
COMMENT ON COLUMN "LayoutSection"."doorHeight" IS 'Height of the door from bottom of layout to top of door opening (in meters)';
