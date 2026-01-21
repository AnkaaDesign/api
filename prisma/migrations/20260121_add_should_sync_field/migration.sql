-- Add shouldSync field to ServiceOrder table
-- This field controls bidirectional sync with TaskPricingItem
-- When false, prevents auto-recreation of service orders from pricing items
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "shouldSync" BOOLEAN NOT NULL DEFAULT true;

-- Add shouldSync field to TaskPricingItem table
-- This field controls bidirectional sync with ServiceOrder
-- When false, prevents auto-recreation of service orders from this pricing item
ALTER TABLE "TaskPricingItem" ADD COLUMN IF NOT EXISTS "shouldSync" BOOLEAN NOT NULL DEFAULT true;
