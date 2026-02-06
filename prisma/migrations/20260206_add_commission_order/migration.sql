-- Add commissionOrder field to Task for proper commission sorting
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "commissionOrder" INTEGER NOT NULL DEFAULT 3;

-- Create index for efficient ordering
CREATE INDEX IF NOT EXISTS "Task_commissionOrder_idx" ON "Task"("commissionOrder");

-- Update existing records based on commission enum values
-- Order: FULL_COMMISSION=1, PARTIAL_COMMISSION=2, NO_COMMISSION=3, SUSPENDED_COMMISSION=4
UPDATE "Task"
SET "commissionOrder" = CASE
  WHEN "commission" = 'FULL_COMMISSION' THEN 1
  WHEN "commission" = 'PARTIAL_COMMISSION' THEN 2
  WHEN "commission" = 'NO_COMMISSION' THEN 3
  WHEN "commission" = 'SUSPENDED_COMMISSION' THEN 4
  ELSE 3
END;
