-- Replace tax field with icms and ipi fields
-- Migration: Replace single tax field with ICMS and IPI

-- Step 1: Add new columns to Item table
ALTER TABLE "Item" ADD COLUMN "icms" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Item" ADD COLUMN "ipi" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Step 2: Migrate existing tax data to icms for Item table
UPDATE "Item" SET "icms" = "tax" WHERE "tax" IS NOT NULL;

-- Step 3: Drop old tax column from Item table
ALTER TABLE "Item" DROP COLUMN "tax";

-- Step 4: Add new columns to OrderItem table
ALTER TABLE "OrderItem" ADD COLUMN "icms" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "ipi" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Step 5: Migrate existing tax data to icms for OrderItem table
UPDATE "OrderItem" SET "icms" = "tax" WHERE "tax" IS NOT NULL;

-- Step 6: Drop old tax column from OrderItem table
ALTER TABLE "OrderItem" DROP COLUMN "tax";
