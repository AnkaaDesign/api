-- Step 1: Add customerSignatureId column to TaskPricingCustomerConfig
ALTER TABLE "TaskPricingCustomerConfig" ADD COLUMN "customerSignatureId" TEXT;

-- Step 2: For any TaskPricing that has 0 customerConfigs, create one from the task's customer
-- Only for tasks that have a customerId (skip orphan pricings with no customer)
INSERT INTO "TaskPricingCustomerConfig" (
  "id", "pricingId", "customerId", "subtotal", "discountType", "discountValue",
  "total", "customPaymentText", "responsibleId", "discountReference",
  "customerSignatureId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  tp."id",
  t."customerId",
  tp."subtotal",
  tp."discountType",
  tp."discountValue",
  tp."total",
  tp."customPaymentText",
  tp."responsibleId",
  tp."discountReference",
  tp."customerSignatureId",
  NOW(),
  NOW()
FROM "TaskPricing" tp
JOIN "Task" t ON t."pricingId" = tp."id"
WHERE t."customerId" IS NOT NULL
  AND NOT EXISTS (
  SELECT 1 FROM "TaskPricingCustomerConfig" cc WHERE cc."pricingId" = tp."id"
);

-- Step 3: For existing customerConfigs, copy customerSignatureId from global pricing to first config
UPDATE "TaskPricingCustomerConfig" cc
SET "customerSignatureId" = tp."customerSignatureId"
FROM "TaskPricing" tp
WHERE cc."pricingId" = tp."id"
  AND tp."customerSignatureId" IS NOT NULL
  AND cc."customerSignatureId" IS NULL
  AND cc."id" = (
    SELECT cc2."id"
    FROM "TaskPricingCustomerConfig" cc2
    WHERE cc2."pricingId" = tp."id"
    ORDER BY cc2."createdAt" ASC
    LIMIT 1
  );

-- Step 4: Drop indexes on columns being removed
DROP INDEX IF EXISTS "TaskPricing_customerSignatureId_idx";
DROP INDEX IF EXISTS "TaskPricing_responsibleId_idx";

-- Step 5: Drop the redundant columns from TaskPricing
ALTER TABLE "TaskPricing" DROP COLUMN "discountType";
ALTER TABLE "TaskPricing" DROP COLUMN "discountValue";
ALTER TABLE "TaskPricing" DROP COLUMN "discountReference";
ALTER TABLE "TaskPricing" DROP COLUMN "customPaymentText";
ALTER TABLE "TaskPricing" DROP COLUMN "responsibleId";
ALTER TABLE "TaskPricing" DROP COLUMN "customerSignatureId";

-- Step 6: Add index on new column
CREATE INDEX "TaskPricingCustomerConfig_customerSignatureId_idx" ON "TaskPricingCustomerConfig"("customerSignatureId");

-- Step 7: Add FK constraint for customerSignatureId -> File
ALTER TABLE "TaskPricingCustomerConfig" ADD CONSTRAINT "TaskPricingCustomerConfig_customerSignatureId_fkey" FOREIGN KEY ("customerSignatureId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
