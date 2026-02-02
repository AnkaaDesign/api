-- Fix missing columns in database to match Prisma schema

-- Add position column to TaskPricingItem if it doesn't exist
ALTER TABLE "TaskPricingItem" ADD COLUMN IF NOT EXISTS "position" INTEGER DEFAULT 0;

-- Add position column to ServiceOrder if it doesn't exist
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "position" INTEGER DEFAULT 0;

-- Add position column to LayoutSection if it doesn't exist
ALTER TABLE "LayoutSection" ADD COLUMN IF NOT EXISTS "position" INTEGER DEFAULT 0;

-- Ensure Representative table has all columns
ALTER TABLE "Representative" ADD COLUMN IF NOT EXISTS "verified" BOOLEAN DEFAULT false;
ALTER TABLE "Representative" ADD COLUMN IF NOT EXISTS "verificationCode" TEXT;
ALTER TABLE "Representative" ADD COLUMN IF NOT EXISTS "verificationExpiresAt" TIMESTAMP(3);
ALTER TABLE "Representative" ADD COLUMN IF NOT EXISTS "sessionToken" TEXT;
ALTER TABLE "Representative" ADD COLUMN IF NOT EXISTS "resetToken" TEXT;
ALTER TABLE "Representative" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP(3);
ALTER TABLE "Representative" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

-- Add unique constraints if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Representative_sessionToken_key') THEN
    ALTER TABLE "Representative" ADD CONSTRAINT "Representative_sessionToken_key" UNIQUE ("sessionToken");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Representative_resetToken_key') THEN
    ALTER TABLE "Representative" ADD CONSTRAINT "Representative_resetToken_key" UNIQUE ("resetToken");
  END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS "TaskPricingItem_pricingId_idx" ON "TaskPricingItem"("pricingId");
CREATE INDEX IF NOT EXISTS "ServiceOrder_position_idx" ON "ServiceOrder"("position");
CREATE INDEX IF NOT EXISTS "LayoutSection_position_idx" ON "LayoutSection"("position");