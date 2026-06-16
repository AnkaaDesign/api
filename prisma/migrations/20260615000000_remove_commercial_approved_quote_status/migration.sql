-- Remove the COMMERCIAL_APPROVED double-check step from the task quote workflow.
--
-- The commercial sector now approves the budget once (BUDGET_APPROVED, blue badge).
-- There is no separate second commercial approval before invoicing: once the linked
-- task is COMPLETED, billing is approved directly from BUDGET_APPROVED.
--
-- Step 1: fold every existing COMMERCIAL_APPROVED quote into BUDGET_APPROVED
--         (statusOrder 3 == BUDGET_APPROVED display priority).
-- Step 2: recreate the TaskQuoteStatus enum without COMMERCIAL_APPROVED.
--         (Postgres cannot DROP an enum value in place; the type must be recreated.)
--         Only TaskQuote.status uses this enum, so a single column is rebound.

-- Step 1 — data migration (must run BEFORE the value is removed from the type)
UPDATE "TaskQuote"
SET "status" = 'BUDGET_APPROVED',
    "statusOrder" = 3
WHERE "status" = 'COMMERCIAL_APPROVED';

-- Step 2 — recreate the enum without COMMERCIAL_APPROVED
ALTER TYPE "TaskQuoteStatus" RENAME TO "TaskQuoteStatus_old";

CREATE TYPE "TaskQuoteStatus" AS ENUM (
  'PENDING',
  'BUDGET_APPROVED',
  'BILLING_APPROVED',
  'UPCOMING',
  'DUE',
  'PARTIAL',
  'SETTLED'
);

ALTER TABLE "TaskQuote" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TaskQuote"
  ALTER COLUMN "status" TYPE "TaskQuoteStatus"
  USING ("status"::text::"TaskQuoteStatus");
ALTER TABLE "TaskQuote" ALTER COLUMN "status" SET DEFAULT 'PENDING';

DROP TYPE "TaskQuoteStatus_old";
