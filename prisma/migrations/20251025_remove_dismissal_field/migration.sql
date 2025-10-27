-- Remove the dismissal field and replace with dismissedAt
-- This migration removes the legacy dismissal field

-- Drop the index on dismissal
DROP INDEX IF EXISTS "User_dismissal_idx";

-- Drop the dismissal column
ALTER TABLE "User" DROP COLUMN IF EXISTS "dismissal";
