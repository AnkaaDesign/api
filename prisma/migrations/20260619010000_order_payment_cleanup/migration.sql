-- Order payment workflow cleanup
-- -------------------------------
-- 1. Drop the vestigial `paymentRequestedAt` column. The legacy "Solicitar
--    pagamento" (REQUESTED) step was removed in 20260617160450; the column was
--    never cleared and only surfaced stale timestamps on old orders. The new
--    workflow has no request step (AWAITING_PAYMENT -> PARTIALLY_PAID -> PAID).
-- 2. Backfill `installmentCount` from the actual OrderInstallment rows. The count
--    chosen at creation was never persisted to Order.installmentCount (it stayed at
--    the default 1), so multi-installment boletos reported "1x" and an edit could
--    wrongly wipe their parcelas. Restore the true count for existing orders.

-- 1. Drop vestigial column.
ALTER TABLE "Order" DROP COLUMN IF EXISTS "paymentRequestedAt";

-- 2. Backfill installmentCount for orders that already have a parcela schedule.
UPDATE "Order" o
SET "installmentCount" = sub.cnt
FROM (
  SELECT "orderId", COUNT(*)::int AS cnt
  FROM "OrderInstallment"
  GROUP BY "orderId"
) sub
WHERE sub."orderId" = o."id"
  AND sub.cnt > o."installmentCount";
