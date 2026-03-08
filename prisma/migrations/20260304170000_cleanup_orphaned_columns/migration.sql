-- Cleanup Migration: Remove orphaned columns, enums, and create TaskPricingInstallment
--
-- Context:
--   Payment condition/method fields were moved to the installment-based billing model
--   (Invoice -> Installment -> BankSlip). The old columns on TaskPricing,
--   TaskPricingCustomerConfig, Invoice, and Task are no longer in the Prisma schema
--   and need to be dropped from the database.
--
-- Changes:
--   1. Create TaskPricingInstallment table (new model, no migration existed)
--   2. Drop orphaned columns from TaskPricing, TaskPricingCustomerConfig, Invoice, Task
--   3. Drop orphaned indexes
--   4. Drop orphaned enum types (PaymentCondition, PaymentStatus)

-- ============================================================
-- 1. CREATE TaskPricingInstallment TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS "TaskPricingInstallment" (
    "id" TEXT NOT NULL,
    "customerConfigId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskPricingInstallment_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one installment number per customer config
CREATE UNIQUE INDEX IF NOT EXISTS "TaskPricingInstallment_customerConfigId_number_key"
    ON "TaskPricingInstallment"("customerConfigId", "number");

-- Indexes
CREATE INDEX IF NOT EXISTS "TaskPricingInstallment_customerConfigId_idx"
    ON "TaskPricingInstallment"("customerConfigId");

CREATE INDEX IF NOT EXISTS "TaskPricingInstallment_dueDate_idx"
    ON "TaskPricingInstallment"("dueDate");

-- Foreign key to TaskPricingCustomerConfig (skip if already exists from db push)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'TaskPricingInstallment_customerConfigId_fkey'
    ) THEN
        ALTER TABLE "TaskPricingInstallment"
            ADD CONSTRAINT "TaskPricingInstallment_customerConfigId_fkey"
            FOREIGN KEY ("customerConfigId") REFERENCES "TaskPricingCustomerConfig"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ============================================================
-- 2. DROP ORPHANED COLUMNS FROM TaskPricing
--    Origin: 0_init (paymentCondition, downPaymentDate)
-- ============================================================

ALTER TABLE "TaskPricing" DROP COLUMN IF EXISTS "paymentCondition";
ALTER TABLE "TaskPricing" DROP COLUMN IF EXISTS "downPaymentDate";

-- ============================================================
-- 3. DROP ORPHANED COLUMNS FROM TaskPricingCustomerConfig
--    Origin: 20260303150000 (paymentCondition, downPaymentDate)
--            20260303180000 (paymentMethod)
-- ============================================================

ALTER TABLE "TaskPricingCustomerConfig" DROP COLUMN IF EXISTS "paymentCondition";
ALTER TABLE "TaskPricingCustomerConfig" DROP COLUMN IF EXISTS "downPaymentDate";
ALTER TABLE "TaskPricingCustomerConfig" DROP COLUMN IF EXISTS "paymentMethod";

-- ============================================================
-- 4. DROP ORPHANED COLUMNS FROM Invoice
--    Origin: 20260303180000 (paymentMethod, installmentCount,
--            downPaymentDate, paymentCondition)
-- ============================================================

ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "paymentMethod";
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "installmentCount";
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "downPaymentDate";
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "paymentCondition";

-- ============================================================
-- 5. DROP ORPHANED COLUMNS AND INDEX FROM Task
--    Origin: 20260303120000 (financialStatus/financialStatusOrder,
--            renamed to paymentStatus/paymentStatusOrder in 20260303190000)
-- ============================================================

-- Drop the index first (name was not renamed when column was renamed)
DROP INDEX IF EXISTS "Task_financialStatusOrder_idx";

ALTER TABLE "Task" DROP COLUMN IF EXISTS "paymentStatus";
ALTER TABLE "Task" DROP COLUMN IF EXISTS "paymentStatusOrder";

-- ============================================================
-- 6. DROP ORPHANED ENUM TYPES
--    - PaymentCondition: created in 0_init, no longer referenced by any column
--    - PaymentStatus: created as FinancialStatus in 20260303120000,
--      renamed in 20260303190000, no longer referenced after column drop above
--    - PaymentMethod: KEPT (still used by Order model)
-- ============================================================

DROP TYPE IF EXISTS "PaymentCondition";
DROP TYPE IF EXISTS "PaymentStatus";
