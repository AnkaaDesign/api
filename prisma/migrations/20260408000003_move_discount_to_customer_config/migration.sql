-- Move discount fields from TaskQuoteService to TaskQuoteCustomerConfig
-- This restores the global customer discount workflow (one discount per customer, not per service)

-- Step 1: Add discount columns to TaskQuoteCustomerConfig
ALTER TABLE "TaskQuoteCustomerConfig" ADD COLUMN "discountType" "DiscountType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "TaskQuoteCustomerConfig" ADD COLUMN "discountValue" DECIMAL(10, 2);
ALTER TABLE "TaskQuoteCustomerConfig" ADD COLUMN "discountReference" TEXT;

-- Step 2: Migrate existing per-service discounts to per-customer config
-- Strategy: For each customer config, calculate the effective discount percentage
-- from the sum of per-service discounts relative to the customer's subtotal
UPDATE "TaskQuoteCustomerConfig" cc
SET
  "discountType" = sub.effective_type,
  "discountValue" = sub.effective_value,
  "discountReference" = sub.effective_reference
FROM (
  SELECT
    cc2."id" AS config_id,
    CASE
      WHEN COALESCE(SUM(
        CASE
          WHEN s."discountType"::text = 'PERCENTAGE' AND s."discountValue" IS NOT NULL
            THEN ROUND(s."amount" * s."discountValue" / 100, 2)
          WHEN s."discountType"::text = 'FIXED_VALUE' AND s."discountValue" IS NOT NULL
            THEN LEAST(s."discountValue", s."amount")
          ELSE 0
        END
      ), 0) > 0 THEN 'PERCENTAGE'::"DiscountType"
      ELSE 'NONE'::"DiscountType"
    END AS effective_type,
    CASE
      WHEN cc2."subtotal" > 0 AND COALESCE(SUM(
        CASE
          WHEN s."discountType"::text = 'PERCENTAGE' AND s."discountValue" IS NOT NULL
            THEN ROUND(s."amount" * s."discountValue" / 100, 2)
          WHEN s."discountType"::text = 'FIXED_VALUE' AND s."discountValue" IS NOT NULL
            THEN LEAST(s."discountValue", s."amount")
          ELSE 0
        END
      ), 0) > 0 THEN ROUND(
        COALESCE(SUM(
          CASE
            WHEN s."discountType"::text = 'PERCENTAGE' AND s."discountValue" IS NOT NULL
              THEN ROUND(s."amount" * s."discountValue" / 100, 2)
            WHEN s."discountType"::text = 'FIXED_VALUE' AND s."discountValue" IS NOT NULL
              THEN LEAST(s."discountValue", s."amount")
            ELSE 0
          END
        ), 0) / cc2."subtotal" * 100
      , 2)
      ELSE NULL
    END AS effective_value,
    (
      SELECT s2."discountReference"
      FROM "TaskQuoteService" s2
      WHERE s2."quoteId" = cc2."quoteId"
        AND (s2."invoiceToCustomerId" = cc2."customerId" OR s2."invoiceToCustomerId" IS NULL)
        AND s2."discountType"::text != 'NONE'
        AND s2."discountReference" IS NOT NULL
      LIMIT 1
    ) AS effective_reference
  FROM "TaskQuoteCustomerConfig" cc2
  LEFT JOIN "TaskQuoteService" s ON s."quoteId" = cc2."quoteId"
    AND (s."invoiceToCustomerId" = cc2."customerId" OR s."invoiceToCustomerId" IS NULL)
  GROUP BY cc2."id", cc2."quoteId", cc2."customerId", cc2."subtotal"
) sub
WHERE cc."id" = sub.config_id;

-- Step 3: Remove discount columns from TaskQuoteService
ALTER TABLE "TaskQuoteService" DROP COLUMN "discountType";
ALTER TABLE "TaskQuoteService" DROP COLUMN "discountValue";
ALTER TABLE "TaskQuoteService" DROP COLUMN "discountReference";
