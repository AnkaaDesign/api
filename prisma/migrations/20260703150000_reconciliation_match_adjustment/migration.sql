-- Note-shortfall write-off: when a payment settles a note for LESS than its
-- total (e.g. a negotiated discount), the unpaid slice is recorded with a reason
-- so the note closes as fully settled instead of lingering as an open parcela.
CREATE TYPE "ReconciliationAdjustmentReason" AS ENUM ('DESCONTO', 'FRETE', 'GARANTIA_ESTENDIDA', 'SEGURO', 'TAXAS', 'OUTROS');

ALTER TABLE "ReconciliationMatch" ADD COLUMN "adjustmentAmount" DECIMAL(14,2);
ALTER TABLE "ReconciliationMatch" ADD COLUMN "adjustmentReason" "ReconciliationAdjustmentReason";
