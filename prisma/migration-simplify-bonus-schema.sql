-- Migration: Simplify Bonus Schema
-- This migration removes redundant fields from the Bonus table:
-- - ponderedTaskCount: Can be computed from tasks array (FULL=1.0, PARTIAL=0.5)
-- - averageTasksPerUser: Can be computed from tasks array / eligible users count
-- - calculationPeriodStart: Redundant with year/month (always 26th of prev month)
-- - calculationPeriodEnd: Redundant with year/month (always 25th of current month)
--
-- The period can be computed as:
-- - Start: Day 26 of (month - 1) at 00:00:00
-- - End: Day 25 of current month at 23:59:59
--
-- ponderedTasks can be computed from bonus.tasks where:
-- - FULL_COMMISSION = 1.0 weight
-- - PARTIAL_COMMISSION = 0.5 weight

-- Drop the indexes first
DROP INDEX IF EXISTS "Bonus_calculationPeriodStart_calculationPeriodEnd_idx";
DROP INDEX IF EXISTS "Bonus_ponderedTaskCount_idx";
DROP INDEX IF EXISTS "Bonus_averageTasksPerUser_idx";

-- Remove the redundant columns
ALTER TABLE "Bonus" DROP COLUMN IF EXISTS "ponderedTaskCount";
ALTER TABLE "Bonus" DROP COLUMN IF EXISTS "averageTasksPerUser";
ALTER TABLE "Bonus" DROP COLUMN IF EXISTS "calculationPeriodStart";
ALTER TABLE "Bonus" DROP COLUMN IF EXISTS "calculationPeriodEnd";
