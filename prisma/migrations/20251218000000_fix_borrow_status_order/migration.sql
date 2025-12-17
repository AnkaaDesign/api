-- Fix borrow statusOrder values based on status
-- This migration syncs statusOrder for all existing borrows that may have incorrect values

-- Update ACTIVE borrows to statusOrder = 1
UPDATE "Borrow"
SET "statusOrder" = 1
WHERE "status" = 'ACTIVE' AND ("statusOrder" IS NULL OR "statusOrder" != 1);

-- Update RETURNED borrows to statusOrder = 2
UPDATE "Borrow"
SET "statusOrder" = 2
WHERE "status" = 'RETURNED' AND ("statusOrder" IS NULL OR "statusOrder" != 2);

-- Update LOST borrows to statusOrder = 3
UPDATE "Borrow"
SET "statusOrder" = 3
WHERE "status" = 'LOST' AND ("statusOrder" IS NULL OR "statusOrder" != 3);
