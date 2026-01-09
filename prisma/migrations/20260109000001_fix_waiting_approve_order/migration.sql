-- Fix: Remove WAITING_APPROVE and re-add it in the correct position (before COMPLETED)

-- Step 1: Remove the incorrectly positioned enum value
-- (This works because no data is using it yet)
DELETE FROM pg_enum
WHERE enumlabel = 'WAITING_APPROVE'
AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ServiceOrderStatus');

-- Step 2: Add it back in the correct position (before COMPLETED)
ALTER TYPE "ServiceOrderStatus" ADD VALUE 'WAITING_APPROVE' BEFORE 'COMPLETED';
