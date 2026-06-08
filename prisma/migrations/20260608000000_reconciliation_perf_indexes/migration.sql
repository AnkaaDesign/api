-- Reconciliation auto-match performance indexes.
-- Serves the matchAll/matchDateRange pending-scan and the installment sibling
-- lookup (counterparty + status + posted-date window). IF NOT EXISTS keeps this
-- idempotent and safe to apply over a drifted schema.

CREATE INDEX IF NOT EXISTS "BankTransaction_reconciliationStatus_expectsFiscalDocument_postedAt_idx"
    ON "BankTransaction" ("reconciliationStatus", "expectsFiscalDocument", "postedAt");

CREATE INDEX IF NOT EXISTS "BankTransaction_counterpartyCnpjCpf_reconciliationStatus_postedAt_idx"
    ON "BankTransaction" ("counterpartyCnpjCpf", "reconciliationStatus", "postedAt");
