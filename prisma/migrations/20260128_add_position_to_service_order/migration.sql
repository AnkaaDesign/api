-- Add position field to ServiceOrder for maintaining user-defined order within each type group
-- This allows services to be displayed in the same order they were added, grouped by type

-- Add position column with default value of 0
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;

-- Create index for efficient ordering
CREATE INDEX IF NOT EXISTS "ServiceOrder_position_idx" ON "ServiceOrder"("position");

-- Update existing records to have position based on createdAt order within each task
-- This ensures existing data maintains chronological order
WITH ranked_services AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "taskId" ORDER BY "createdAt" ASC) - 1 as new_position
  FROM "ServiceOrder"
)
UPDATE "ServiceOrder"
SET "position" = ranked_services.new_position
FROM ranked_services
WHERE "ServiceOrder".id = ranked_services.id;
