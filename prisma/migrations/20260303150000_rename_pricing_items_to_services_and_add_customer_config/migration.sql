-- 1. Rename TaskPricingItem → TaskPricingService
ALTER TABLE "TaskPricingItem" RENAME TO "TaskPricingService";
ALTER INDEX "TaskPricingItem_pkey" RENAME TO "TaskPricingService_pkey";
ALTER INDEX "TaskPricingItem_pricingId_idx" RENAME TO "TaskPricingService_pricingId_idx";
ALTER INDEX "TaskPricingItem_invoiceToCustomerId_idx" RENAME TO "TaskPricingService_invoiceToCustomerId_idx";

-- 2. Create TaskPricingCustomerConfig
CREATE TABLE "TaskPricingCustomerConfig" (
    "id" TEXT NOT NULL,
    "pricingId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" DECIMAL(10,2),
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paymentCondition" "PaymentCondition",
    "downPaymentDate" TIMESTAMP(3),
    "customPaymentText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskPricingCustomerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskPricingCustomerConfig_pricingId_customerId_key" ON "TaskPricingCustomerConfig"("pricingId", "customerId");

-- CreateIndex
CREATE INDEX "TaskPricingCustomerConfig_pricingId_idx" ON "TaskPricingCustomerConfig"("pricingId");

-- CreateIndex
CREATE INDEX "TaskPricingCustomerConfig_customerId_idx" ON "TaskPricingCustomerConfig"("customerId");

-- AddForeignKey
ALTER TABLE "TaskPricingCustomerConfig" ADD CONSTRAINT "TaskPricingCustomerConfig_pricingId_fkey" FOREIGN KEY ("pricingId") REFERENCES "TaskPricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPricingCustomerConfig" ADD CONSTRAINT "TaskPricingCustomerConfig_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Migrate data from implicit M2M to new entity (filter orphaned records)
INSERT INTO "TaskPricingCustomerConfig" ("id", "pricingId", "customerId", "subtotal", "total", "updatedAt")
SELECT gen_random_uuid(), t."A", t."B", 0, 0, NOW()
FROM "_TaskPricingInvoiceTo" t
WHERE EXISTS (SELECT 1 FROM "TaskPricing" p WHERE p."id" = t."A")
  AND EXISTS (SELECT 1 FROM "Customer" c WHERE c."id" = t."B");

-- 4. Drop implicit M2M table
DROP TABLE "_TaskPricingInvoiceTo";

-- 5. Add new ChangeLogEntityType enum values
ALTER TYPE "ChangeLogEntityType" ADD VALUE 'TASK_PRICING_SERVICE';
ALTER TYPE "ChangeLogEntityType" ADD VALUE 'TASK_PRICING_CUSTOMER_CONFIG';
