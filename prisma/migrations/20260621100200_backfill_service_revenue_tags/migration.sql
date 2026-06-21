-- Backfill: tag already-reconciled CREDITs that settled a receivable (directly
-- via an installment match, or via the Sicredi boleto bridge) with the
-- service-revenue category, so historical entradas carry the same accounting
-- classification new reconciliations now get. Idempotent (NOT EXISTS guard +
-- the (transactionId, categoryId) unique index).
INSERT INTO "BankTransactionCategory" ("id", "transactionId", "categoryId", "source", "allocatedAmount", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  bt.id,
  cat.id,
  'AUTO',
  (
    SELECT COALESCE(SUM(rm."allocatedAmount"), 0)
    FROM "ReconciliationMatch" rm
    WHERE rm."transactionId" = bt.id AND rm."reversedAt" IS NULL
  ),
  now(),
  now()
FROM "BankTransaction" bt
CROSS JOIN (SELECT id FROM "TransactionCategory" WHERE slug = 'receita-servicos') cat
WHERE bt.type = 'CREDIT'
  AND bt."reconciliationStatus" IN ('RECONCILED', 'PARTIAL')
  AND EXISTS (
    SELECT 1 FROM "ReconciliationMatch" rm
    WHERE rm."transactionId" = bt.id
      AND rm."reversedAt" IS NULL
      AND (rm."installmentId" IS NOT NULL OR rm."bankSlipId" IS NOT NULL)
  )
  AND NOT EXISTS (
    SELECT 1 FROM "BankTransactionCategory" btc
    WHERE btc."transactionId" = bt.id AND btc."categoryId" = cat.id
  );
