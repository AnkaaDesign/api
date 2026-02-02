-- Manual migration to add auto-order manual override fields to Item table
-- Run this manually in your PostgreSQL database

-- Add manual override tracking fields
ALTER TABLE "Item"
ADD COLUMN IF NOT EXISTS "isManualMaxQuantity" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "isManualReorderPoint" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "lastAutoOrderDate" TIMESTAMP(3);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "Item_isManualMaxQuantity_idx" ON "Item"("isManualMaxQuantity");
CREATE INDEX IF NOT EXISTS "Item_isManualReorderPoint_idx" ON "Item"("isManualReorderPoint");
CREATE INDEX IF NOT EXISTS "Item_lastAutoOrderDate_idx" ON "Item"("lastAutoOrderDate");

-- Add comment to track migration
COMMENT ON COLUMN "Item"."isManualMaxQuantity" IS 'Tracks if maxQuantity was manually set by user';
COMMENT ON COLUMN "Item"."isManualReorderPoint" IS 'Tracks if reorderPoint was manually set by user';
COMMENT ON COLUMN "Item"."lastAutoOrderDate" IS 'Last time an auto-order was created for this item';
