-- Reconciliation integrity, part 2 of 2: CONSTRAINT SWAP.
--
-- MUST NOT be applied before the accompanying application code is deployed.
-- The previously-shipped build upserts on the compound key
-- `transactionId_fiscalDocumentId`, which Prisma compiles to an ON CONFLICT
-- naming that exact constraint. Dropping it while that build is serving breaks
-- manual matching at runtime.
--
-- Replaces the full unique constraints with PARTIAL unique indexes scoped to
-- live (non-reversed) rows. The old constraints covered every row regardless of
-- reversedAt, so a reversed match permanently occupied (transactionId, anchor)
-- and blocked re-matching the same pair — which is why all three unmatch paths
-- stamped reversedAt and then DELETEd the row in the next statement, destroying
-- the audit trail and every precision signal with it.

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

-- A match must anchor to at least one target. A row with every anchor NULL
-- points at nothing and can never be interpreted; none exist today and nothing
-- previously prevented one.
--
-- Deliberately NOT "exactly one": two production rows legitimately carry both a
-- fiscalDocumentId and the orderInstallmentId that same payment settles, which
-- is a supplier NF and its order installment describing one liability. An
-- exactly-one rule would reject that valid shape.
ALTER TABLE "ReconciliationMatch"
  DROP CONSTRAINT IF EXISTS "ReconciliationMatch_exactly_one_anchor";
ALTER TABLE "ReconciliationMatch"
  DROP CONSTRAINT IF EXISTS "ReconciliationMatch_has_anchor";
ALTER TABLE "ReconciliationMatch"
  ADD CONSTRAINT "ReconciliationMatch_has_anchor" CHECK (
    (("fiscalDocumentId" IS NOT NULL)::int
   + ("bankSlipId" IS NOT NULL)::int
   + ("installmentId" IS NOT NULL)::int
   + ("orderInstallmentId" IS NOT NULL)::int
   + ("recurrentOccurrenceId" IS NOT NULL)::int
   + ("airbrushingId" IS NOT NULL)::int
   + ("payrollMonthSettlementId" IS NOT NULL)::int) >= 1
  );

