-- Migration: Convert Artwork-Task relationship from One-to-Many to Many-to-Many
-- This migration handles the schema change where:
-- - Old: Artwork has taskId (one task per artwork)
-- - New: Artwork has tasks[] via junction table (many tasks per artwork)
--
-- IMPORTANT: Backup your database before running this migration!

-- Step 1: Create the junction table for Task-Artwork many-to-many relationship
-- Prisma uses the naming convention _[RelationName] for implicit many-to-many
CREATE TABLE IF NOT EXISTS "_TaskArtworks" (
    "A" TEXT NOT NULL,  -- Artwork ID
    "B" TEXT NOT NULL,  -- Task ID
    CONSTRAINT "_TaskArtworks_AB_pkey" PRIMARY KEY ("A", "B")
);

-- Step 2: Create indexes for the junction table
CREATE INDEX IF NOT EXISTS "_TaskArtworks_B_index" ON "_TaskArtworks"("B");

-- Step 3: Add foreign key constraints
ALTER TABLE "_TaskArtworks"
ADD CONSTRAINT "_TaskArtworks_A_fkey"
FOREIGN KEY ("A") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_TaskArtworks"
ADD CONSTRAINT "_TaskArtworks_B_fkey"
FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 4: Migrate existing Artwork-Task relationships to the junction table
-- Handle duplicates: If multiple Artworks have the same fileId, we need to:
-- 1. Keep only one Artwork per fileId
-- 2. Migrate all task associations to that one Artwork

-- First, insert existing relationships into the junction table
-- This handles the case where each Artwork currently has a single taskId
INSERT INTO "_TaskArtworks" ("A", "B")
SELECT "id", "taskId"
FROM "Artwork"
WHERE "taskId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Step 5: Handle duplicate Artworks (same fileId, different tasks)
-- We need to merge them into a single Artwork

-- Create a temp table to track which artworks to merge
CREATE TEMP TABLE artwork_merge_map AS
SELECT
    "fileId",
    MIN("id") as "keepArtworkId",  -- Keep the first artwork
    array_agg("id") as "allArtworkIds"
FROM "Artwork"
GROUP BY "fileId"
HAVING COUNT(*) > 1;

-- For each duplicate set, update the junction table to point to the kept artwork
-- and migrate task associations from the duplicates
DO $$
DECLARE
    merge_row RECORD;
    dup_id TEXT;
BEGIN
    FOR merge_row IN SELECT * FROM artwork_merge_map LOOP
        -- For each artwork ID that is NOT the kept one, migrate its task associations
        FOREACH dup_id IN ARRAY merge_row."allArtworkIds" LOOP
            IF dup_id != merge_row."keepArtworkId" THEN
                -- Migrate task associations to the kept artwork
                INSERT INTO "_TaskArtworks" ("A", "B")
                SELECT merge_row."keepArtworkId", "B"
                FROM "_TaskArtworks"
                WHERE "A" = dup_id
                ON CONFLICT DO NOTHING;

                -- Delete the duplicate artwork's associations
                DELETE FROM "_TaskArtworks" WHERE "A" = dup_id;
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- Step 6: Delete duplicate Artwork records (keep only one per fileId)
DELETE FROM "Artwork"
WHERE "id" IN (
    SELECT unnest("allArtworkIds")
    FROM artwork_merge_map
)
AND "id" NOT IN (
    SELECT "keepArtworkId" FROM artwork_merge_map
);

-- Clean up temp table
DROP TABLE artwork_merge_map;

-- Step 7: Add unique constraint on fileId (now that duplicates are removed)
-- Note: This might fail if there are still duplicates. Check first!
ALTER TABLE "Artwork" ADD CONSTRAINT "Artwork_fileId_key" UNIQUE ("fileId");

-- Step 8: Drop the old taskId column and its index
-- First drop the foreign key constraint
ALTER TABLE "Artwork" DROP CONSTRAINT IF EXISTS "Artwork_taskId_fkey";

-- Drop the index
DROP INDEX IF EXISTS "Artwork_taskId_idx";

-- Drop the column
ALTER TABLE "Artwork" DROP COLUMN IF EXISTS "taskId";

-- Verify the migration
-- Run this query to check the results:
-- SELECT COUNT(*) as total_artworks,
--        COUNT(DISTINCT "fileId") as unique_files,
--        (SELECT COUNT(*) FROM "_TaskArtworks") as task_artwork_relations
-- FROM "Artwork";
