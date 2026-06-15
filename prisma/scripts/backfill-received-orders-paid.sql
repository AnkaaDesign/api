-- ============================================================================
-- One-time backfill: mark historically-received orders as PAID.
--
-- Context: payability was decoupled from fulfillment (an order is now payable
-- from creation until explicitly paid). That surfaced the entire pre-existing
-- order history (all NOT_REQUESTED) as open payables, even though those orders
-- were physically received long ago and paid in real life — the system simply
-- never recorded the payment.
--
-- This marks every RECEIVED / PARTIALLY_RECEIVED order that is still
-- NOT_REQUESTED as PAID, stamping paidAt from the latest item receipt date
-- (falling back to the order's createdAt when no item receivedAt exists).
-- The lone OVERDUE / CREATED / FULFILLED-but-unreceived orders are left
-- untouched — they are genuinely open obligations.
--
-- Idempotent: re-running only affects rows still in NOT_REQUESTED.
-- Run against PROD with the same command after reviewing the pre/post counts.
-- ============================================================================

BEGIN;

-- Pre-check: how many rows will be affected.
SELECT count(*) AS will_backfill
FROM "Order"
WHERE status IN ('RECEIVED', 'PARTIALLY_RECEIVED')
  AND "paymentStatus" = 'NOT_REQUESTED';

UPDATE "Order" o
SET "paymentStatus"      = 'PAID',
    "paymentStatusOrder" = 4,
    "paidAt"             = COALESCE(
      (SELECT max(oi."receivedAt") FROM "OrderItem" oi WHERE oi."orderId" = o.id),
      o."createdAt"
    )
WHERE o.status IN ('RECEIVED', 'PARTIALLY_RECEIVED')
  AND o."paymentStatus" = 'NOT_REQUESTED';

-- Post-check: remaining open (non-cancelled, non-paid) orders.
SELECT status, "paymentStatus", count(*)
FROM "Order"
WHERE status <> 'CANCELLED' AND "paymentStatus" <> 'PAID'
GROUP BY status, "paymentStatus"
ORDER BY status;

COMMIT;
