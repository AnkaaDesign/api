-- CollapseInstallmentModels
-- Merges TaskPricingInstallment into Installment so there is a single installment table.

-- 1. Add customerConfigId to Installment (nullable initially)
ALTER TABLE "Installment" ADD COLUMN "customerConfigId" TEXT;

-- 2. Make invoiceId nullable
ALTER TABLE "Installment" ALTER COLUMN "invoiceId" DROP NOT NULL;

-- 3. Backfill customerConfigId from Invoice.customerConfigId (post-approval installments)
UPDATE "Installment" i SET "customerConfigId" = inv."customerConfigId"
FROM "Invoice" inv WHERE i."invoiceId" = inv."id";

-- 4. Migrate pre-approval TaskPricingInstallments that have no Invoice yet
INSERT INTO "Installment" ("id","customerConfigId","number","dueDate","amount","paidAmount","status","createdAt","updatedAt")
SELECT tpi."id", tpi."customerConfigId", tpi."number", tpi."dueDate", tpi."amount", 0, 'PENDING', tpi."createdAt", tpi."updatedAt"
FROM "TaskPricingInstallment" tpi
WHERE NOT EXISTS (
  SELECT 1 FROM "Installment" inst JOIN "Invoice" inv ON inst."invoiceId" = inv."id"
  WHERE inv."customerConfigId" = tpi."customerConfigId" AND inst."number" = tpi."number"
);

-- 5. Make customerConfigId NOT NULL
ALTER TABLE "Installment" ALTER COLUMN "customerConfigId" SET NOT NULL;

-- 6. Swap unique constraints
ALTER TABLE "Installment" DROP CONSTRAINT IF EXISTS "Installment_invoiceId_number_key";
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_customerConfigId_number_key" UNIQUE ("customerConfigId", "number");

-- 7. Drop old FK, add new FKs
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_customerConfigId_fkey"
  FOREIGN KEY ("customerConfigId") REFERENCES "TaskPricingCustomerConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Installment" DROP CONSTRAINT IF EXISTS "Installment_invoiceId_fkey";
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 8. Add indexes
CREATE INDEX IF NOT EXISTS "Installment_customerConfigId_idx" ON "Installment"("customerConfigId");
CREATE INDEX IF NOT EXISTS "Installment_invoiceId_idx" ON "Installment"("invoiceId");

-- 9. Drop TaskPricingInstallment table
DROP TABLE IF EXISTS "TaskPricingInstallment";
