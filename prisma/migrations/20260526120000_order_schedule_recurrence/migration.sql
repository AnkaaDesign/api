-- Fix order-schedule recurrence so ONE schedule can produce MANY orders over
-- time (matching MaintenanceSchedule and PpeDeliverySchedule, whose record FKs
-- are non-unique). Previously Order.orderScheduleId was UNIQUE, which capped a
-- recurring schedule at a single order for its entire lifetime — every fire
-- after the first hit a unique-constraint violation. This migration is
-- non-destructive: it only relaxes a constraint and adds nullable columns.

-- 1) Drop the 1:1 unique constraint and replace it with a plain FK index so a
--    schedule can own many orders.
DROP INDEX IF EXISTS "Order_orderScheduleId_key";
CREATE INDEX IF NOT EXISTS "Order_orderScheduleId_idx" ON "Order"("orderScheduleId");

-- 2) Per-run observability on the schedule (outcome + last error message),
--    so failed/empty runs are visible instead of silently swallowed.
DO $$ BEGIN
  CREATE TYPE "ScheduleRunStatus" AS ENUM ('SUCCESS', 'SKIPPED_NO_ITEMS', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "OrderSchedule"
  ADD COLUMN IF NOT EXISTS "lastRunStatus" "ScheduleRunStatus",
  ADD COLUMN IF NOT EXISTS "lastRunError" TEXT;
