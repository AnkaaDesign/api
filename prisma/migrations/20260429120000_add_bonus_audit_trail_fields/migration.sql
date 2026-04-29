-- AlterTable
-- Add audit-trail columns for the salary-based logistic bonus algorithm.
-- All columns are nullable so existing rows (calculated under the legacy
-- position-name cascade) remain valid; new rows will populate them.
ALTER TABLE "Bonus"
  ADD COLUMN "salaryUsed"          DECIMAL(10, 2),
  ADD COLUMN "calculationVersion"  TEXT,
  ADD COLUMN "calculationParams"   JSONB;
