-- Reconciliation integrity, part 1 of 2: ADDITIVE ONLY.
--
-- Everything here is invisible to the currently-deployed API (a new nullable
-- column, new enum members), so it is safe to apply before the code that uses
-- it. The constraint swap that REQUIRES the new code lives in the sibling
-- migration 20260804120100_reconciliation_match_live_unique.

-- ---------------------------------------------------------------------------
-- 1b. Structured remainder reason
-- ---------------------------------------------------------------------------
-- The "restante sem nota" reason was folded into ReconciliationMatch.notes as
-- free text, so it was unqueryable and invisible to the status recompute.
DO $$ BEGIN
  CREATE TYPE "ReconciliationRemainderReason" AS ENUM ('FRETE', 'SEGURO', 'TAXAS', 'ITEM_SEM_NOTA', 'OUTROS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ReconciliationMatch"
  ADD COLUMN IF NOT EXISTS "remainderReason" "ReconciliationRemainderReason";

-- Backfill from the human-readable note manualMatch has been writing
-- ("… · Restante R$316,00 → Frete"). Conservative: only exact label matches.
UPDATE "ReconciliationMatch" SET "remainderReason" = 'FRETE'
  WHERE "remainderReason" IS NULL AND notes ~ 'Restante R\$[0-9.,]+ → Frete';
UPDATE "ReconciliationMatch" SET "remainderReason" = 'SEGURO'
  WHERE "remainderReason" IS NULL AND notes ~ 'Restante R\$[0-9.,]+ → Seguro';
UPDATE "ReconciliationMatch" SET "remainderReason" = 'TAXAS'
  WHERE "remainderReason" IS NULL AND notes ~ 'Restante R\$[0-9.,]+ → Taxas';
UPDATE "ReconciliationMatch" SET "remainderReason" = 'ITEM_SEM_NOTA'
  WHERE "remainderReason" IS NULL AND notes ~ 'Restante R\$[0-9.,]+ → Item sem nota';
UPDATE "ReconciliationMatch" SET "remainderReason" = 'OUTROS'
  WHERE "remainderReason" IS NULL AND notes ~ 'Restante R\$[0-9.,]+ → Outros';

-- ---------------------------------------------------------------------------
-- 2. ChangeLog entity types for reconciliation
-- ---------------------------------------------------------------------------
-- ChangeLogEntityType had no member covering bank transactions, matches or
-- fiscal documents, so there was no slot to log a reconciliation status change
-- against — the audit trail was impossible rather than merely absent.
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'BANK_TRANSACTION';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_MATCH';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'FISCAL_DOCUMENT';
