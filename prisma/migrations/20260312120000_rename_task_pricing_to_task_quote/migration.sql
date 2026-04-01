-- Rename TaskPricing entity to TaskQuote
-- Renames tables, columns, enum type and values, indexes, and constraints

-- =====================
-- 1. Rename enum type and update values
-- =====================

-- Rename the enum type
ALTER TYPE "TaskPricingStatus" RENAME TO "TaskQuoteStatus";

-- Rename enum value: VERIFIED -> VERIFIED_BY_FINANCIAL
ALTER TYPE "TaskQuoteStatus" RENAME VALUE 'VERIFIED' TO 'VERIFIED_BY_FINANCIAL';

-- Add new DUE status
ALTER TYPE "TaskQuoteStatus" ADD VALUE 'DUE' AFTER 'UPCOMING';

-- =====================
-- 2. Rename tables
-- =====================

ALTER TABLE "TaskPricing" RENAME TO "TaskQuote";
ALTER TABLE "TaskPricingService" RENAME TO "TaskQuoteService";
ALTER TABLE "TaskPricingCustomerConfig" RENAME TO "TaskQuoteCustomerConfig";

-- =====================
-- 3. Rename foreign key columns
-- =====================

-- TaskQuoteService: pricingId -> quoteId
ALTER TABLE "TaskQuoteService" RENAME COLUMN "pricingId" TO "quoteId";

-- TaskQuoteCustomerConfig: pricingId -> quoteId
ALTER TABLE "TaskQuoteCustomerConfig" RENAME COLUMN "pricingId" TO "quoteId";

-- Task: pricingId -> quoteId
ALTER TABLE "Task" RENAME COLUMN "pricingId" TO "quoteId";

-- =====================
-- 4. Rename indexes
-- =====================

-- TaskQuote indexes
ALTER INDEX "TaskPricing_pkey" RENAME TO "TaskQuote_pkey";
ALTER INDEX "TaskPricing_budgetNumber_key" RENAME TO "TaskQuote_budgetNumber_key";
ALTER INDEX "TaskPricing_status_idx" RENAME TO "TaskQuote_status_idx";
ALTER INDEX "TaskPricing_statusOrder_idx" RENAME TO "TaskQuote_statusOrder_idx";
ALTER INDEX "TaskPricing_expiresAt_idx" RENAME TO "TaskQuote_expiresAt_idx";
ALTER INDEX "TaskPricing_layoutFileId_idx" RENAME TO "TaskQuote_layoutFileId_idx";

-- TaskQuoteService indexes
ALTER INDEX "TaskPricingService_pkey" RENAME TO "TaskQuoteService_pkey";
ALTER INDEX "TaskPricingService_pricingId_idx" RENAME TO "TaskQuoteService_quoteId_idx";
ALTER INDEX "TaskPricingService_invoiceToCustomerId_idx" RENAME TO "TaskQuoteService_invoiceToCustomerId_idx";

-- TaskQuoteCustomerConfig indexes
ALTER INDEX "TaskPricingCustomerConfig_pkey" RENAME TO "TaskQuoteCustomerConfig_pkey";
ALTER INDEX "TaskPricingCustomerConfig_pricingId_customerId_key" RENAME TO "TaskQuoteCustomerConfig_quoteId_customerId_key";
ALTER INDEX "TaskPricingCustomerConfig_pricingId_idx" RENAME TO "TaskQuoteCustomerConfig_quoteId_idx";
ALTER INDEX "TaskPricingCustomerConfig_customerId_idx" RENAME TO "TaskQuoteCustomerConfig_customerId_idx";
ALTER INDEX "TaskPricingCustomerConfig_responsibleId_idx" RENAME TO "TaskQuoteCustomerConfig_responsibleId_idx";
ALTER INDEX "TaskPricingCustomerConfig_customerSignatureId_idx" RENAME TO "TaskQuoteCustomerConfig_customerSignatureId_idx";

-- Task pricingId index -> quoteId
ALTER INDEX "Task_pricingId_key" RENAME TO "Task_quoteId_key";

-- =====================
-- 5. Rename foreign key constraints
-- =====================

-- TaskQuote
ALTER TABLE "TaskQuote" RENAME CONSTRAINT "TaskPricing_layoutFileId_fkey" TO "TaskQuote_layoutFileId_fkey";

-- TaskQuoteService
ALTER TABLE "TaskQuoteService" RENAME CONSTRAINT "TaskPricingService_pricingId_fkey" TO "TaskQuoteService_quoteId_fkey";
ALTER TABLE "TaskQuoteService" RENAME CONSTRAINT "TaskPricingService_invoiceToCustomerId_fkey" TO "TaskQuoteService_invoiceToCustomerId_fkey";

-- TaskQuoteCustomerConfig
ALTER TABLE "TaskQuoteCustomerConfig" RENAME CONSTRAINT "TaskPricingCustomerConfig_pricingId_fkey" TO "TaskQuoteCustomerConfig_quoteId_fkey";
ALTER TABLE "TaskQuoteCustomerConfig" RENAME CONSTRAINT "TaskPricingCustomerConfig_customerId_fkey" TO "TaskQuoteCustomerConfig_customerId_fkey";
ALTER TABLE "TaskQuoteCustomerConfig" RENAME CONSTRAINT "TaskPricingCustomerConfig_responsibleId_fkey" TO "TaskQuoteCustomerConfig_responsibleId_fkey";
ALTER TABLE "TaskQuoteCustomerConfig" RENAME CONSTRAINT "TaskPricingCustomerConfig_customerSignatureId_fkey" TO "TaskQuoteCustomerConfig_customerSignatureId_fkey";

-- Task
ALTER TABLE "Task" RENAME CONSTRAINT "Task_pricingId_fkey" TO "Task_quoteId_fkey";

-- =====================
-- 6. Update EntityType enum values (if stored in DB)
-- =====================

-- Update the EntityType enum if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EntityType') THEN
    BEGIN
      ALTER TYPE "EntityType" RENAME VALUE 'TASK_PRICING' TO 'TASK_QUOTE';
    EXCEPTION WHEN others THEN NULL;
    END;
    BEGIN
      ALTER TYPE "EntityType" RENAME VALUE 'TASK_PRICING_ITEM' TO 'TASK_QUOTE_ITEM';
    EXCEPTION WHEN others THEN NULL;
    END;
    BEGIN
      ALTER TYPE "EntityType" RENAME VALUE 'TASK_PRICING_SERVICE' TO 'TASK_QUOTE_SERVICE';
    EXCEPTION WHEN others THEN NULL;
    END;
    BEGIN
      ALTER TYPE "EntityType" RENAME VALUE 'TASK_PRICING_CUSTOMER_CONFIG' TO 'TASK_QUOTE_CUSTOMER_CONFIG';
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- Update ChangeLogEntityType if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChangeLogEntityType') THEN
    BEGIN
      ALTER TYPE "ChangeLogEntityType" RENAME VALUE 'TASK_PRICING' TO 'TASK_QUOTE';
    EXCEPTION WHEN others THEN NULL;
    END;
    BEGIN
      ALTER TYPE "ChangeLogEntityType" RENAME VALUE 'TASK_PRICING_ITEM' TO 'TASK_QUOTE_ITEM';
    EXCEPTION WHEN others THEN NULL;
    END;
    BEGIN
      ALTER TYPE "ChangeLogEntityType" RENAME VALUE 'TASK_PRICING_SERVICE' TO 'TASK_QUOTE_SERVICE';
    EXCEPTION WHEN others THEN NULL;
    END;
    BEGIN
      ALTER TYPE "ChangeLogEntityType" RENAME VALUE 'TASK_PRICING_CUSTOMER_CONFIG' TO 'TASK_QUOTE_CUSTOMER_CONFIG';
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- =====================
-- 7. Update existing data: VERIFIED -> VERIFIED_BY_FINANCIAL
-- =====================

UPDATE "TaskQuote" SET "status" = 'VERIFIED_BY_FINANCIAL' WHERE "status" = 'VERIFIED_BY_FINANCIAL';
-- Note: The enum rename already handles this since we renamed the value.
-- Any rows with the old 'VERIFIED' value are automatically 'VERIFIED_BY_FINANCIAL' after the enum rename.
