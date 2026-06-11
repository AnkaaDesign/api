-- ExternalWithdrawal → ExternalOperation rename + billing support.
-- Combines the feature rename (tables, enums, enum values, join tables, stored rows)
-- with the billing additions (customer link, service items, invoice-chain decoupling).
-- Replaces the never-applied 20260609200000_external_withdrawal_billing migration.

-- ============================================================
-- 1. Rename enum TYPES
-- ============================================================
ALTER TYPE "ExternalWithdrawalType" RENAME TO "ExternalOperationType";
ALTER TYPE "ExternalWithdrawalStatus" RENAME TO "ExternalOperationStatus";

-- ============================================================
-- 2. Rename enum VALUES stored in data
-- ============================================================
ALTER TYPE "ActivityReason" RENAME VALUE 'EXTERNAL_WITHDRAWAL' TO 'EXTERNAL_OPERATION';
ALTER TYPE "ActivityReason" RENAME VALUE 'EXTERNAL_WITHDRAWAL_RETURN' TO 'EXTERNAL_OPERATION_RETURN';

ALTER TYPE "ChangeLogEntityType" RENAME VALUE 'EXTERNAL_WITHDRAWAL' TO 'EXTERNAL_OPERATION';
ALTER TYPE "ChangeLogEntityType" RENAME VALUE 'EXTERNAL_WITHDRAWAL_ITEM' TO 'EXTERNAL_OPERATION_ITEM';

ALTER TYPE "ChangeLogTriggeredByType" RENAME VALUE 'EXTERNAL_WITHDRAWAL' TO 'EXTERNAL_OPERATION';
ALTER TYPE "ChangeLogTriggeredByType" RENAME VALUE 'EXTERNAL_WITHDRAWAL_DELETE' TO 'EXTERNAL_OPERATION_DELETE';
ALTER TYPE "ChangeLogTriggeredByType" RENAME VALUE 'EXTERNAL_WITHDRAWAL_RETURN' TO 'EXTERNAL_OPERATION_RETURN';
ALTER TYPE "ChangeLogTriggeredByType" RENAME VALUE 'EXTERNAL_WITHDRAWAL_SYNC' TO 'EXTERNAL_OPERATION_SYNC';
ALTER TYPE "ChangeLogTriggeredByType" RENAME VALUE 'EXTERNAL_WITHDRAWAL_ITEM' TO 'EXTERNAL_OPERATION_ITEM';
ALTER TYPE "ChangeLogTriggeredByType" RENAME VALUE 'EXTERNAL_WITHDRAWAL_ITEM_UPDATE' TO 'EXTERNAL_OPERATION_ITEM_UPDATE';
ALTER TYPE "ChangeLogTriggeredByType" RENAME VALUE 'EXTERNAL_WITHDRAWAL_ITEM_DELETE' TO 'EXTERNAL_OPERATION_ITEM_DELETE';

-- ============================================================
-- 3. Rename tables (data preserved)
-- ============================================================
ALTER TABLE "ExternalWithdrawal" RENAME TO "ExternalOperation";
ALTER TABLE "ExternalWithdrawalItem" RENAME TO "ExternalOperationItem";

-- Implicit many-to-many join tables (File relations)
ALTER TABLE "_EXTERNAL_WITHDRAWAL_INVOICES" RENAME TO "_EXTERNAL_OPERATION_INVOICES";
ALTER TABLE "_EXTERNAL_WITHDRAWAL_INVOICE_REIMBURSEMENTS" RENAME TO "_EXTERNAL_OPERATION_INVOICE_REIMBURSEMENTS";
ALTER TABLE "_EXTERNAL_WITHDRAWAL_RECEIPTS" RENAME TO "_EXTERNAL_OPERATION_RECEIPTS";
ALTER TABLE "_EXTERNAL_WITHDRAWAL_REIMBURSEMENTS" RENAME TO "_EXTERNAL_OPERATION_REIMBURSEMENTS";

-- ============================================================
-- 4. Rename columns
-- ============================================================
ALTER TABLE "ExternalOperationItem" RENAME COLUMN "externalWithdrawalId" TO "externalOperationId";

-- ============================================================
-- 5. Rename constraints & indexes to Prisma-conventional names
--    (prevents schema drift on future `prisma migrate diff`).
--    Defensive: exact constraint/index names vary with the Prisma
--    version that created them (e.g. _AB_unique vs _AB_pkey), so
--    every rename is IF EXISTS / exception-guarded.
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conrelid::regclass::text AS tbl, conname
    FROM pg_constraint
    WHERE conname LIKE '%ExternalWithdrawal%' OR conname LIKE '%EXTERNAL_WITHDRAWAL%'
  LOOP
    EXECUTE format(
      'ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
      r.tbl,
      r.conname,
      replace(replace(replace(r.conname,
        'ExternalWithdrawal', 'ExternalOperation'),
        'EXTERNAL_WITHDRAWAL', 'EXTERNAL_OPERATION'),
        'externalWithdrawalId', 'externalOperationId')
    );
  END LOOP;

  FOR r IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND (indexname LIKE '%ExternalWithdrawal%' OR indexname LIKE '%EXTERNAL_WITHDRAWAL%')
  LOOP
    EXECUTE format(
      'ALTER INDEX %I RENAME TO %I',
      r.indexname,
      replace(replace(replace(r.indexname,
        'ExternalWithdrawal', 'ExternalOperation'),
        'EXTERNAL_WITHDRAWAL', 'EXTERNAL_OPERATION'),
        'externalWithdrawalId', 'externalOperationId')
    );
  END LOOP;
END $$;

-- ============================================================
-- 6. Rename stored notification-configuration keys
-- ============================================================
UPDATE "NotificationConfiguration"
SET "key" = REPLACE("key", 'external_withdrawal.', 'external_operation.'),
    "eventType" = REPLACE("eventType", 'external_withdrawal.', 'external_operation.')
WHERE "key" LIKE 'external_withdrawal.%';

-- ============================================================
-- 7. Billing: ExternalOperation customer + billing configuration
-- ============================================================
ALTER TABLE "ExternalOperation"
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "generateInvoice" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "generateBankSlip" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "paymentCondition" TEXT,
  ADD COLUMN "paymentConfig" JSONB,
  ADD COLUMN "billedAt" TIMESTAMP(3);

ALTER TABLE "ExternalOperation"
  ADD CONSTRAINT "ExternalOperation_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ExternalOperation_customerId_idx" ON "ExternalOperation"("customerId");

-- ============================================================
-- 8. Billing: service line items (mirrors TaskQuoteService)
-- ============================================================
CREATE TABLE "ExternalOperationServiceItem" (
  "id" TEXT NOT NULL,
  "externalOperationId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalOperationServiceItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExternalOperationServiceItem_externalOperationId_idx"
  ON "ExternalOperationServiceItem"("externalOperationId");

ALTER TABLE "ExternalOperationServiceItem"
  ADD CONSTRAINT "ExternalOperationServiceItem_externalOperationId_fkey"
  FOREIGN KEY ("externalOperationId") REFERENCES "ExternalOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 9. Billing: decouple Invoice/Installment from Task/TaskQuoteCustomerConfig
--    (exactly one source must be set, app-enforced)
-- ============================================================
ALTER TABLE "Invoice"
  ALTER COLUMN "customerConfigId" DROP NOT NULL,
  ALTER COLUMN "taskId" DROP NOT NULL,
  ADD COLUMN "externalOperationId" TEXT;

CREATE UNIQUE INDEX "Invoice_externalOperationId_key" ON "Invoice"("externalOperationId");

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_externalOperationId_fkey"
  FOREIGN KEY ("externalOperationId") REFERENCES "ExternalOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Installment"
  ALTER COLUMN "customerConfigId" DROP NOT NULL,
  ADD COLUMN "externalOperationId" TEXT;

CREATE UNIQUE INDEX "Installment_externalOperationId_number_key"
  ON "Installment"("externalOperationId", "number");

CREATE INDEX "Installment_externalOperationId_idx" ON "Installment"("externalOperationId");

ALTER TABLE "Installment"
  ADD CONSTRAINT "Installment_externalOperationId_fkey"
  FOREIGN KEY ("externalOperationId") REFERENCES "ExternalOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
