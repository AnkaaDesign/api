-- Add the BONUS value to SalaryAdjustmentType. Bonus period reajustes are now
-- first-class SalaryAdjustment rows (single, unified adjustment system) instead
-- of a parallel BonusPeriodConfig.adjustment. Must be its own migration so the
-- new enum value is committed before the next migration uses it.
ALTER TYPE "SalaryAdjustmentType" ADD VALUE IF NOT EXISTS 'BONUS';
