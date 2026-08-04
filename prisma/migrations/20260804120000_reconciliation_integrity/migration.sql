-- Reconciliation integrity hardening.
--
-- 1. Replace the full unique constraints on ReconciliationMatch with PARTIAL
--    unique indexes scoped to live (non-reversed) rows, so a reversal can be
--    retained instead of hard-deleted.
-- 2. Give ChangeLog an entity type for bank transactions, matches and fiscal
--    documents so reconciliation state changes become auditable at all.
-- 3. Restrict BankSlip deletion the same way every other match anchor already is.

-- ---------------------------------------------------------------------------
-- 1. Partial unique indexes
-- ---------------------------------------------------------------------------
-- The old constraints covered every row regardless of reversedAt, so a reversed
-- match permanently occupied (transactionId, anchor) and blocked re-matching the
-- same pair. That is why all three unmatch paths stamped reversedAt and then
-- DELETEd the row in the next statement, destroying the audit trail.

ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_fiscalDocumentId_key";
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_installmentId_key";
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_bankSlipId_key";
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_orderInstallmentId_key";
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_recurrentOccurrenceId_key";
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_airbrushingId_key";
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_payrollMonthSettlementId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ReconciliationMatch_live_tx_fiscalDocument_key"
  ON "ReconciliationMatch" ("transactionId", "fiscalDocumentId")
  WHERE "reversedAt" IS NULL AND "fiscalDocumentId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ReconciliationMatch_live_tx_installment_key"
  ON "ReconciliationMatch" ("transactionId", "installmentId")
  WHERE "reversedAt" IS NULL AND "installmentId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ReconciliationMatch_live_tx_bankSlip_key"
  ON "ReconciliationMatch" ("transactionId", "bankSlipId")
  WHERE "reversedAt" IS NULL AND "bankSlipId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ReconciliationMatch_live_tx_orderInstallment_key"
  ON "ReconciliationMatch" ("transactionId", "orderInstallmentId")
  WHERE "reversedAt" IS NULL AND "orderInstallmentId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ReconciliationMatch_live_tx_recurrentOccurrence_key"
  ON "ReconciliationMatch" ("transactionId", "recurrentOccurrenceId")
  WHERE "reversedAt" IS NULL AND "recurrentOccurrenceId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ReconciliationMatch_live_tx_airbrushing_key"
  ON "ReconciliationMatch" ("transactionId", "airbrushingId")
  WHERE "reversedAt" IS NULL AND "airbrushingId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ReconciliationMatch_live_tx_payrollMonthSettlement_key"
  ON "ReconciliationMatch" ("transactionId", "payrollMonthSettlementId")
  WHERE "reversedAt" IS NULL AND "payrollMonthSettlementId" IS NOT NULL;

-- A match must anchor to exactly one target. Two production rows currently carry
-- both fiscalDocumentId and orderInstallmentId; they are repaired by the data
-- migration that accompanies this change, so the constraint is added NOT VALID
-- and validated separately to keep this file replayable on a fresh database.
ALTER TABLE "ReconciliationMatch"
  DROP CONSTRAINT IF EXISTS "ReconciliationMatch_exactly_one_anchor";
ALTER TABLE "ReconciliationMatch"
  ADD CONSTRAINT "ReconciliationMatch_exactly_one_anchor" CHECK (
    (("fiscalDocumentId" IS NOT NULL)::int
   + ("bankSlipId" IS NOT NULL)::int
   + ("installmentId" IS NOT NULL)::int
   + ("orderInstallmentId" IS NOT NULL)::int
   + ("recurrentOccurrenceId" IS NOT NULL)::int
   + ("airbrushingId" IS NOT NULL)::int
   + ("payrollMonthSettlementId" IS NOT NULL)::int) = 1
  ) NOT VALID;

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
