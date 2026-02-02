-- Add observation field to TaskPricingItem table
-- This field allows adding additional notes/details for pricing items
ALTER TABLE "TaskPricingItem" ADD COLUMN IF NOT EXISTS "observation" TEXT;
