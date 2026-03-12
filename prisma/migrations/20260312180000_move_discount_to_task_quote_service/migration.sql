-- AlterTable: Add discount fields to TaskQuoteService
ALTER TABLE "TaskQuoteService" ADD COLUMN "discountType" "DiscountType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "TaskQuoteService" ADD COLUMN "discountValue" DECIMAL(10,2);
ALTER TABLE "TaskQuoteService" ADD COLUMN "discountReference" TEXT;

-- Data Migration: Copy CustomerConfig discount to its assigned services
-- Strategy: For each CustomerConfig that has a discount, apply it to the first
-- service assigned to that customer (or first service if single-config quote).
-- This preserves the discount data during the migration.
WITH ranked_services AS (
  SELECT
    s.id AS service_id,
    cc.id AS config_id,
    cc."discountType",
    cc."discountValue",
    cc."discountReference",
    ROW_NUMBER() OVER (
      PARTITION BY cc.id
      ORDER BY s.position ASC, s."createdAt" ASC
    ) AS rn
  FROM "TaskQuoteCustomerConfig" cc
  JOIN "TaskQuoteService" s ON s."quoteId" = cc."quoteId"
  WHERE cc."discountType" != 'NONE'
    AND (
      -- Service is assigned to this customer
      s."invoiceToCustomerId" = cc."customerId"
      -- OR it's a single-config quote and service has no assignment
      OR (
        s."invoiceToCustomerId" IS NULL
        AND (
          SELECT COUNT(*) FROM "TaskQuoteCustomerConfig" cc2
          WHERE cc2."quoteId" = cc."quoteId"
        ) = 1
      )
    )
)
UPDATE "TaskQuoteService" s
SET
  "discountType" = rs."discountType",
  "discountValue" = rs."discountValue",
  "discountReference" = rs."discountReference"
FROM ranked_services rs
WHERE s.id = rs.service_id
  AND rs.rn = 1;

-- AlterTable: Remove discount fields from TaskQuoteCustomerConfig
ALTER TABLE "TaskQuoteCustomerConfig" DROP COLUMN "discountType";
ALTER TABLE "TaskQuoteCustomerConfig" DROP COLUMN "discountValue";
ALTER TABLE "TaskQuoteCustomerConfig" DROP COLUMN "discountReference";
