-- Incremental order number + supplier sequential number.
--
-- Order.orderNumber: a fresh sequence starting at 1. The column is added WITHOUT a
-- default first, so all PRE-EXISTING orders keep NULL; the default (nextval) is then
-- attached for FUTURE inserts only. Net effect: the first order created after this
-- migration gets 1 -> displayed as "0001". nextval is non-transactional, so the number
-- is concurrency-safe and gap-tolerant across all create paths (manual/batch/schedule).
--
-- Supplier.sequentialNumber: same sequence technique, but EXISTING suppliers are
-- backfilled in createdAt order (1..N) so historical suppliers also carry a number;
-- the sequence is then advanced past the backfill so new suppliers continue from N+1.

-- ----- Order -----
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1 INCREMENT BY 1;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "orderNumber" INTEGER;
ALTER TABLE "Order" ALTER COLUMN "orderNumber" SET DEFAULT nextval('order_number_seq');

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Order_orderNumber_key') THEN
    ALTER TABLE "Order" ADD CONSTRAINT "Order_orderNumber_key" UNIQUE ("orderNumber");
  END IF;
END $$;

-- ----- Supplier -----
CREATE SEQUENCE IF NOT EXISTS supplier_number_seq START WITH 1 INCREMENT BY 1;

ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "sequentialNumber" INTEGER;

WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "Supplier"
)
UPDATE "Supplier" s
  SET "sequentialNumber" = o.rn
  FROM ordered o
  WHERE s.id = o.id AND s."sequentialNumber" IS NULL;

-- Advance the sequence past the backfilled max (is_called=false -> next nextval = max+1).
SELECT setval('supplier_number_seq', COALESCE((SELECT MAX("sequentialNumber") FROM "Supplier"), 0) + 1, false);

ALTER TABLE "Supplier" ALTER COLUMN "sequentialNumber" SET DEFAULT nextval('supplier_number_seq');

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Supplier_sequentialNumber_key') THEN
    ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_sequentialNumber_key" UNIQUE ("sequentialNumber");
  END IF;
END $$;
