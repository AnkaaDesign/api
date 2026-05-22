-- Reconciliation status/source/category split + classifier-ready columns.
--
-- The old `matchStatus` enum conflated lifecycle and source:
--   UNMATCHED / AUTO_MATCHED / MANUAL_MATCHED / PARTIAL / IGNORED / DISPUTED
-- This collapses lifecycle into ReconciliationStatus and pulls AUTO/MANUAL
-- into a sibling ReconciliationSource column. A new ReconciliationCategory
-- column tags each transaction with what kind of payment it is so the
-- classifier can auto-reconcile self-justifying flows (fees, taxes, payroll,
-- transfers, convênios, pro-labore, rent, refunds).
--
-- Production note: the 20260516120000_add_reconciliation_alias migration is
-- marked failed in prod's _prisma_migrations table even though the table was
-- created out-of-band. Before deploying this migration, resolve the prior:
--   pnpm prisma migrate resolve --applied 20260516120000_add_reconciliation_alias

-- 1. New enums.
CREATE TYPE "ReconciliationStatus" AS ENUM (
  'PENDING',
  'RECONCILED',
  'PARTIAL',
  'IGNORED',
  'DISPUTED'
);

CREATE TYPE "ReconciliationSource" AS ENUM (
  'AUTO',
  'MANUAL'
);

CREATE TYPE "ReconciliationCategory" AS ENUM (
  'NF',
  'TRIBUTO',
  'FOLHA',
  'TRANSFERENCIA',
  'TARIFA_BANCARIA',
  'CONVENIO',
  'PRO_LABORE',
  'ALUGUEL',
  'ESTORNO',
  'OUTROS',
  'UNCLASSIFIED'
);

-- 2. Add new columns to BankTransaction (nullable defaults first so backfill
--    can populate without violating NOT NULL).
ALTER TABLE "BankTransaction"
  ADD COLUMN "reconciliationStatus" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reconciliationSource" "ReconciliationSource",
  ADD COLUMN "category" "ReconciliationCategory" NOT NULL DEFAULT 'UNCLASSIFIED',
  ADD COLUMN "categorySource" "ReconciliationSource",
  ADD COLUMN "classifiedAt" TIMESTAMP(3);

-- 3. Backfill from the old matchStatus column.
UPDATE "BankTransaction" SET
  "reconciliationStatus" = CASE "matchStatus"
    WHEN 'UNMATCHED'      THEN 'PENDING'::"ReconciliationStatus"
    WHEN 'AUTO_MATCHED'   THEN 'RECONCILED'::"ReconciliationStatus"
    WHEN 'MANUAL_MATCHED' THEN 'RECONCILED'::"ReconciliationStatus"
    WHEN 'PARTIAL'        THEN 'PARTIAL'::"ReconciliationStatus"
    WHEN 'IGNORED'        THEN 'IGNORED'::"ReconciliationStatus"
    WHEN 'DISPUTED'       THEN 'DISPUTED'::"ReconciliationStatus"
  END,
  "reconciliationSource" = CASE "matchStatus"
    WHEN 'AUTO_MATCHED'   THEN 'AUTO'::"ReconciliationSource"
    WHEN 'MANUAL_MATCHED' THEN 'MANUAL'::"ReconciliationSource"
    ELSE NULL
  END,
  "category" = CASE
    WHEN "matchStatus" IN ('AUTO_MATCHED', 'MANUAL_MATCHED', 'PARTIAL')
      THEN 'NF'::"ReconciliationCategory"
    ELSE 'UNCLASSIFIED'::"ReconciliationCategory"
  END;

-- 4. Drop old column + enum + index.
DROP INDEX IF EXISTS "BankTransaction_matchStatus_idx";
ALTER TABLE "BankTransaction" DROP COLUMN "matchStatus";
DROP TYPE "ReconciliationMatchStatus";

-- 5. New indexes mirroring the schema.
CREATE INDEX "BankTransaction_reconciliationStatus_idx"
  ON "BankTransaction"("reconciliationStatus");

CREATE INDEX "BankTransaction_category_idx"
  ON "BankTransaction"("category");

-- 6. Extend ReconciliationAlias with optional category.
ALTER TABLE "ReconciliationAlias"
  ADD COLUMN "category" "ReconciliationCategory";
