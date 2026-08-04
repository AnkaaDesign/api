-- Reconciliation integrity, part 3: finish what 20260804120100 could not.
--
-- That migration meant to replace the full-table uniques on ReconciliationMatch
-- with partial ones scoped to live rows, and it created the partial indexes
-- correctly. But it removed the old ones with:
--
--     ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "..._key";
--
-- and in this database those objects are plain UNIQUE INDEXES, not table
-- CONSTRAINTS (`SELECT ... FROM pg_constraint WHERE contype = 'u'` returns zero
-- rows for this table). `DROP CONSTRAINT IF EXISTS` therefore matched nothing
-- and silently succeeded, leaving BOTH sets of indexes in place.
--
-- The consequence is a live bug, not cosmetic. The new build stopped
-- hard-deleting reversed matches — the whole point of the partial indexes — so
-- reversed rows now persist. But the surviving full-table index still counts
-- them, so (transactionId, fiscalDocumentId) stays occupied after an unmatch and
-- re-linking the same pair fails with P2002, surfaced in the UI as
-- "Este valor já está em uso no sistema". Reproduced on transaction
-- 7411a508 (PIX -1.815,00 ANGELO SOARES), whose two matches were reversed and
-- could not be recreated.
--
-- DROP INDEX is safe here precisely because these are not constraints: nothing
-- depends on them, and the partial indexes already enforce the intended
-- invariant (uniqueness among NON-reversed rows only).

DROP INDEX IF EXISTS "ReconciliationMatch_transactionId_fiscalDocumentId_key";
DROP INDEX IF EXISTS "ReconciliationMatch_transactionId_installmentId_key";
DROP INDEX IF EXISTS "ReconciliationMatch_transactionId_bankSlipId_key";
DROP INDEX IF EXISTS "ReconciliationMatch_transactionId_orderInstallmentId_key";
DROP INDEX IF EXISTS "ReconciliationMatch_transactionId_recurrentOccurrenceId_key";
DROP INDEX IF EXISTS "ReconciliationMatch_transactionId_airbrushingId_key";
DROP INDEX IF EXISTS "ReconciliationMatch_transactionId_payrollMonthSettlementId_key";

-- Belt and braces: if a future `prisma db push` against an older schema ever
-- recreates them as real constraints, drop those too.
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_fiscalDocumentId_key";
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_installmentId_key";
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_bankSlipId_key";
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_orderInstallmentId_key";
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_recurrentOccurrenceId_key";
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_airbrushingId_key";
ALTER TABLE "ReconciliationMatch" DROP CONSTRAINT IF EXISTS "ReconciliationMatch_transactionId_payrollMonthSettlementId_key";
