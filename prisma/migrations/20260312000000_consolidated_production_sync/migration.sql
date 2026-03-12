-- =====================================================================
-- CONSOLIDATED PRODUCTION MIGRATION
-- Syncs production database (22 migrations) to current Prisma schema
--
-- This single migration replaces the following 20 individual migrations:
--   20260303120000_add_ppe_delivery_signature
--   20260303120000_add_financial_status_and_invoice_to_customer
--   20260303150000_rename_pricing_items_to_services_and_add_customer_config
--   20260303180000_add_invoice_billing_models
--   20260303190000_rename_financial_status_to_payment_status
--   20260303200000_remove_clicksign_fields
--   20260304120000_rename_payment_status_overdue_to_settled
--   20260304150000_add_responsible_to_customer_config
--   20260304160000_add_discount_reference_to_customer_config
--   20260304170000_cleanup_orphaned_columns
--   20260304180000_remove_financial_service_order_type
--   20260304190000_add_nfse_chave_acesso_and_ndps
--   20260304200000_collapse_installment_models
--   20260304210000_restore_payment_condition_on_customer_config
--   20260305000000_remove_redundant_pricing_global_fields
--   20260305100000_add_bankslip_registering_status_and_nfse_ndps_unique
--   20260305120000_add_service_order_checkin_checkout_files
--   20260305130000_rename_sector_manager_to_leader_add_production_manager
--   20260311120000_simplify_nfse_document
-- =====================================================================

-- =============================================
-- PHASE 1: DATA MIGRATIONS (before schema changes)
-- =============================================

-- 1a. Map TaskPricingStatus old values to new values BEFORE changing the enum
-- Production has: DRAFT, APPROVED, REJECTED, CANCELLED
-- Target has:     PENDING, BUDGET_APPROVED, VERIFIED, INTERNAL_APPROVED, UPCOMING, PARTIAL, SETTLED
ALTER TABLE "TaskPricing" ALTER COLUMN "status" TYPE TEXT;

UPDATE "TaskPricing" SET "status" = CASE "status"
  WHEN 'DRAFT' THEN 'PENDING'
  WHEN 'APPROVED' THEN 'BUDGET_APPROVED'
  WHEN 'REJECTED' THEN 'PENDING'
  WHEN 'CANCELLED' THEN 'PENDING'
  ELSE 'PENDING'
END;

-- 1b. Financial Service Order handling
-- For tasks where ALL financial service orders are COMPLETED and the task has pricing,
-- update the pricing status to SETTLED (statusOrder=7)
UPDATE "TaskPricing" tp
SET "status" = 'SETTLED'
FROM "Task" t
WHERE t."pricingId" = tp."id"
  AND EXISTS (
    SELECT 1 FROM "ServiceOrder" so
    WHERE so."taskId" = t.id AND so."type" = 'FINANCIAL'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ServiceOrder" so
    WHERE so."taskId" = t.id
      AND so."type" = 'FINANCIAL'
      AND so."status" != 'COMPLETED'
  );

-- 1c. Delete ALL financial service orders (type is being removed)
DELETE FROM "ServiceOrder" WHERE "type" = 'FINANCIAL';

-- 1d. Sector: Preserve managerId data into new leaderId column
ALTER TABLE "Sector" DROP CONSTRAINT "Sector_managerId_fkey";
ALTER TABLE "Sector" ADD COLUMN "leaderId" TEXT;
UPDATE "Sector" SET "leaderId" = "managerId";
DROP INDEX "Sector_managerId_key";
DROP INDEX "Sector_managerId_idx";
ALTER TABLE "Sector" DROP COLUMN "managerId";

-- 1e. Rename TaskPricingItem → TaskPricingService (preserves all 1058 rows of data!)
ALTER TABLE "TaskPricingItem" DROP CONSTRAINT "TaskPricingItem_pricingId_fkey";
ALTER TABLE "TaskPricingItem" RENAME TO "TaskPricingService";
ALTER TABLE "TaskPricingService" RENAME CONSTRAINT "TaskPricingItem_pkey" TO "TaskPricingService_pkey";
ALTER INDEX "TaskPricingItem_pricingId_idx" RENAME TO "TaskPricingService_pricingId_idx";
ALTER TABLE "TaskPricingService" ADD COLUMN "invoiceToCustomerId" TEXT;

-- =============================================
-- PHASE 2: ENUM CHANGES
-- =============================================

-- 2a. Create new enums
CREATE TYPE "BiometricMethod" AS ENUM ('FINGERPRINT', 'FACE_ID', 'IRIS', 'DEVICE_PIN', 'NONE');
CREATE TYPE "NetworkType" AS ENUM ('WIFI', 'CELLULAR', 'ETHERNET', 'UNKNOWN');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'OVERDUE', 'CANCELLED');
CREATE TYPE "BankSlipStatus" AS ENUM ('CREATING', 'REGISTERING', 'ACTIVE', 'OVERDUE', 'PAID', 'CANCELLED', 'REJECTED', 'ERROR');
CREATE TYPE "NfseStatus" AS ENUM ('PENDING', 'PROCESSING', 'AUTHORIZED', 'CANCELLED', 'ERROR');
CREATE TYPE "BankSlipType" AS ENUM ('NORMAL', 'HIBRIDO');
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- 2b. Add values to existing enums
ALTER TYPE "ChangeLogEntityType" ADD VALUE 'TASK_PRICING_SERVICE';
ALTER TYPE "ChangeLogEntityType" ADD VALUE 'TASK_PRICING_CUSTOMER_CONFIG';
ALTER TYPE "SectorPrivileges" ADD VALUE 'PRODUCTION_MANAGER';

-- 2c. Replace ServiceOrderType enum (FINANCIAL rows already deleted above)
ALTER TYPE "ServiceOrderType" RENAME TO "ServiceOrderType_old";
CREATE TYPE "ServiceOrderType" AS ENUM ('PRODUCTION', 'COMMERCIAL', 'ARTWORK', 'LOGISTIC');
ALTER TABLE "ServiceOrder" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "ServiceOrder" ALTER COLUMN "type" TYPE "ServiceOrderType" USING ("type"::text::"ServiceOrderType");
ALTER TABLE "ServiceOrder" ALTER COLUMN "type" SET DEFAULT 'PRODUCTION';
DROP TYPE "ServiceOrderType_old";

-- 2d. Replace TaskPricingStatus enum (values already mapped to TEXT above)
-- Must drop the default first since it references the old enum type
ALTER TABLE "TaskPricing" ALTER COLUMN "status" DROP DEFAULT;
DROP TYPE "TaskPricingStatus";
CREATE TYPE "TaskPricingStatus" AS ENUM ('PENDING', 'BUDGET_APPROVED', 'VERIFIED', 'INTERNAL_APPROVED', 'UPCOMING', 'PARTIAL', 'SETTLED');
ALTER TABLE "TaskPricing" ALTER COLUMN "status" TYPE "TaskPricingStatus" USING ("status"::"TaskPricingStatus");
ALTER TABLE "TaskPricing" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- =============================================
-- PHASE 3: ALTER EXISTING TABLES
-- =============================================

-- 3a. TaskPricing: Add statusOrder, drop columns that moved to TaskPricingCustomerConfig
ALTER TABLE "TaskPricing" ADD COLUMN "statusOrder" INTEGER NOT NULL DEFAULT 1;

-- Set statusOrder based on the migrated status values
UPDATE "TaskPricing" SET "statusOrder" = CASE "status"::text
  WHEN 'PENDING' THEN 1
  WHEN 'BUDGET_APPROVED' THEN 2
  WHEN 'VERIFIED' THEN 3
  WHEN 'INTERNAL_APPROVED' THEN 4
  WHEN 'UPCOMING' THEN 5
  WHEN 'PARTIAL' THEN 6
  WHEN 'SETTLED' THEN 7
  ELSE 1
END;

-- Drop FK constraints before dropping columns
ALTER TABLE "TaskPricing" DROP CONSTRAINT IF EXISTS "TaskPricing_customerSignatureId_fkey";
ALTER TABLE "TaskPricing" DROP CONSTRAINT IF EXISTS "TaskPricing_responsibleId_fkey";
DROP INDEX IF EXISTS "TaskPricing_customerSignatureId_idx";
DROP INDEX IF EXISTS "TaskPricing_responsibleId_idx";

-- Drop columns (these fields now live on TaskPricingCustomerConfig)
ALTER TABLE "TaskPricing" DROP COLUMN "customPaymentText",
DROP COLUMN "customerSignatureId",
DROP COLUMN "discountReference",
DROP COLUMN "discountType",
DROP COLUMN "discountValue",
DROP COLUMN "downPaymentDate",
DROP COLUMN "paymentCondition",
DROP COLUMN "responsibleId";

-- 3b. PpeDelivery: Remove remaining ClickSign fields
DROP INDEX IF EXISTS "PpeDelivery_clicksignDocumentKey_idx";
ALTER TABLE "PpeDelivery" DROP COLUMN "clicksignDocumentKey",
DROP COLUMN "clicksignEnvelopeId",
DROP COLUMN "clicksignSignedAt",
DROP COLUMN "clicksignSignerKey";

-- 3c. Minor schema fixes detected by Prisma diff
ALTER TABLE "Backup" ALTER COLUMN "gdriveDeleteStatus" DROP NOT NULL,
ALTER COLUMN "gdriveDeleteStatus" DROP DEFAULT;

ALTER TABLE "ConsumptionSnapshot" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NotificationChannelConfig" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NotificationConfiguration" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NotificationRule" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NotificationSectorOverride" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NotificationTargetRule" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Representative" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- 3d. Join table PK changes (unique index → primary key)
ALTER TABLE "_TASK_CHECKIN_FILES" ADD CONSTRAINT "_TASK_CHECKIN_FILES_AB_pkey" PRIMARY KEY ("A", "B");
DROP INDEX "_TASK_CHECKIN_FILES_AB_unique";

ALTER TABLE "_TASK_CHECKOUT_FILES" ADD CONSTRAINT "_TASK_CHECKOUT_FILES_AB_pkey" PRIMARY KEY ("A", "B");
DROP INDEX "_TASK_CHECKOUT_FILES_AB_unique";

ALTER TABLE "_TASK_PROJECT_FILES" ADD CONSTRAINT "_TASK_PROJECT_FILES_AB_pkey" PRIMARY KEY ("A", "B");
DROP INDEX "_TASK_PROJECT_FILES_AB_unique";

-- =============================================
-- PHASE 4: CREATE NEW TABLES
-- =============================================

-- PpeDeliverySignature
CREATE TABLE "PpeDeliverySignature" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "signedByUserId" TEXT NOT NULL,
    "signedByCpf" TEXT NOT NULL,
    "biometricMethod" "BiometricMethod" NOT NULL DEFAULT 'NONE',
    "biometricSuccess" BOOLEAN NOT NULL DEFAULT false,
    "deviceBrand" TEXT,
    "deviceModel" TEXT,
    "deviceOs" TEXT,
    "deviceOsVersion" TEXT,
    "appVersion" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationAccuracy" DOUBLE PRECISION,
    "networkType" "NetworkType" NOT NULL DEFAULT 'UNKNOWN',
    "ipAddress" TEXT,
    "clientTimestamp" TIMESTAMP(3) NOT NULL,
    "serverTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceHash" TEXT NOT NULL,
    "hmacSignature" TEXT NOT NULL,
    "signedDocumentId" TEXT,
    "evidenceJson" JSONB NOT NULL,
    "legalBasis" TEXT NOT NULL DEFAULT 'NR-6/CLT Art. 166 - Comprovacao de entrega de EPI',
    "consentGiven" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PpeDeliverySignature_pkey" PRIMARY KEY ("id")
);

-- TaskPricingCustomerConfig
CREATE TABLE "TaskPricingCustomerConfig" (
    "id" TEXT NOT NULL,
    "pricingId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" DECIMAL(10,2),
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "customPaymentText" TEXT,
    "responsibleId" TEXT,
    "discountReference" TEXT,
    "paymentCondition" TEXT,
    "downPaymentDate" TIMESTAMP(3),
    "customerSignatureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaskPricingCustomerConfig_pkey" PRIMARY KEY ("id")
);

-- Invoice
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "customerConfigId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- Installment
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "customerConfigId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "number" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- BankSlip
CREATE TABLE "BankSlip" (
    "id" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "nossoNumero" TEXT NOT NULL,
    "seuNumero" TEXT,
    "barcode" TEXT,
    "digitableLine" TEXT,
    "pixQrCode" TEXT,
    "txid" TEXT,
    "type" "BankSlipType" NOT NULL DEFAULT 'HIBRIDO',
    "amount" DECIMAL(10,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "BankSlipStatus" NOT NULL DEFAULT 'CREATING',
    "sicrediStatus" TEXT,
    "pdfFileId" TEXT,
    "paidAmount" DECIMAL(10,2),
    "paidAt" TIMESTAMP(3),
    "liquidationData" JSONB,
    "errorMessage" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BankSlip_pkey" PRIMARY KEY ("id")
);

-- NfseDocument (simplified — just Elotech reference)
CREATE TABLE "NfseDocument" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "elotechNfseId" INTEGER,
    "status" "NfseStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "retryAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NfseDocument_pkey" PRIMARY KEY ("id")
);

-- SicrediToken
CREATE TABLE "SicrediToken" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenType" TEXT NOT NULL DEFAULT 'Bearer',
    "expiresIn" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresIn" INTEGER,
    "refreshExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "identifier" TEXT NOT NULL DEFAULT 'default',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SicrediToken_pkey" PRIMARY KEY ("id")
);

-- SicrediWebhookEvent
CREATE TABLE "SicrediWebhookEvent" (
    "id" TEXT NOT NULL,
    "idEventoWebhook" TEXT NOT NULL,
    "nossoNumero" TEXT NOT NULL,
    "movimento" TEXT NOT NULL,
    "valorLiquidacao" DECIMAL(10,2),
    "valorDesconto" DECIMAL(10,2),
    "valorJuros" DECIMAL(10,2),
    "valorMulta" DECIMAL(10,2),
    "valorAbatimento" DECIMAL(10,2),
    "dataEvento" TIMESTAMP(3),
    "dataPrevisaoPagamento" TIMESTAMP(3),
    "agencia" TEXT,
    "posto" TEXT,
    "beneficiario" TEXT,
    "carteira" TEXT,
    "rawPayload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SicrediWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- Service Order checkin/checkout files (M2M join tables)
CREATE TABLE "_SERVICE_ORDER_CHECKIN_FILES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_SERVICE_ORDER_CHECKIN_FILES_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE TABLE "_SERVICE_ORDER_CHECKOUT_FILES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_SERVICE_ORDER_CHECKOUT_FILES_AB_pkey" PRIMARY KEY ("A","B")
);

-- =============================================
-- PHASE 5: INDEXES
-- =============================================

-- PpeDeliverySignature indexes
CREATE UNIQUE INDEX "PpeDeliverySignature_deliveryId_key" ON "PpeDeliverySignature"("deliveryId");
CREATE INDEX "PpeDeliverySignature_signedByUserId_idx" ON "PpeDeliverySignature"("signedByUserId");
CREATE INDEX "PpeDeliverySignature_deliveryId_idx" ON "PpeDeliverySignature"("deliveryId");

-- TaskPricingService indexes (pricingId was already renamed, add new one)
CREATE INDEX "TaskPricingService_invoiceToCustomerId_idx" ON "TaskPricingService"("invoiceToCustomerId");

-- TaskPricingCustomerConfig indexes
CREATE INDEX "TaskPricingCustomerConfig_pricingId_idx" ON "TaskPricingCustomerConfig"("pricingId");
CREATE INDEX "TaskPricingCustomerConfig_customerId_idx" ON "TaskPricingCustomerConfig"("customerId");
CREATE INDEX "TaskPricingCustomerConfig_responsibleId_idx" ON "TaskPricingCustomerConfig"("responsibleId");
CREATE INDEX "TaskPricingCustomerConfig_customerSignatureId_idx" ON "TaskPricingCustomerConfig"("customerSignatureId");
CREATE UNIQUE INDEX "TaskPricingCustomerConfig_pricingId_customerId_key" ON "TaskPricingCustomerConfig"("pricingId", "customerId");

-- Invoice indexes
CREATE UNIQUE INDEX "Invoice_customerConfigId_key" ON "Invoice"("customerConfigId");
CREATE INDEX "Invoice_taskId_idx" ON "Invoice"("taskId");
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_createdById_idx" ON "Invoice"("createdById");

-- Installment indexes
CREATE INDEX "Installment_customerConfigId_idx" ON "Installment"("customerConfigId");
CREATE INDEX "Installment_invoiceId_idx" ON "Installment"("invoiceId");
CREATE INDEX "Installment_dueDate_idx" ON "Installment"("dueDate");
CREATE INDEX "Installment_status_idx" ON "Installment"("status");
CREATE UNIQUE INDEX "Installment_customerConfigId_number_key" ON "Installment"("customerConfigId", "number");

-- BankSlip indexes
CREATE UNIQUE INDEX "BankSlip_installmentId_key" ON "BankSlip"("installmentId");
CREATE UNIQUE INDEX "BankSlip_nossoNumero_key" ON "BankSlip"("nossoNumero");
CREATE INDEX "BankSlip_nossoNumero_idx" ON "BankSlip"("nossoNumero");
CREATE INDEX "BankSlip_status_idx" ON "BankSlip"("status");
CREATE INDEX "BankSlip_dueDate_idx" ON "BankSlip"("dueDate");

-- NfseDocument indexes
CREATE INDEX "NfseDocument_invoiceId_idx" ON "NfseDocument"("invoiceId");
CREATE INDEX "NfseDocument_elotechNfseId_idx" ON "NfseDocument"("elotechNfseId");
CREATE INDEX "NfseDocument_status_idx" ON "NfseDocument"("status");

-- SicrediToken indexes
CREATE UNIQUE INDEX "SicrediToken_identifier_key" ON "SicrediToken"("identifier");
CREATE INDEX "SicrediToken_expiresAt_idx" ON "SicrediToken"("expiresAt");
CREATE INDEX "SicrediToken_identifier_idx" ON "SicrediToken"("identifier");

-- SicrediWebhookEvent indexes
CREATE UNIQUE INDEX "SicrediWebhookEvent_idEventoWebhook_key" ON "SicrediWebhookEvent"("idEventoWebhook");
CREATE INDEX "SicrediWebhookEvent_nossoNumero_idx" ON "SicrediWebhookEvent"("nossoNumero");
CREATE INDEX "SicrediWebhookEvent_status_idx" ON "SicrediWebhookEvent"("status");
CREATE INDEX "SicrediWebhookEvent_dataEvento_idx" ON "SicrediWebhookEvent"("dataEvento");

-- Join table indexes
CREATE INDEX "_SERVICE_ORDER_CHECKIN_FILES_B_index" ON "_SERVICE_ORDER_CHECKIN_FILES"("B");
CREATE INDEX "_SERVICE_ORDER_CHECKOUT_FILES_B_index" ON "_SERVICE_ORDER_CHECKOUT_FILES"("B");

-- Additional indexes on existing tables
CREATE INDEX "Item_isManualMaxQuantity_idx" ON "Item"("isManualMaxQuantity");
CREATE INDEX "Item_isManualReorderPoint_idx" ON "Item"("isManualReorderPoint");
CREATE INDEX "Item_lastAutoOrderDate_idx" ON "Item"("lastAutoOrderDate");

-- Sector indexes (for new leaderId column)
CREATE UNIQUE INDEX "Sector_leaderId_key" ON "Sector"("leaderId");
CREATE INDEX "Sector_leaderId_idx" ON "Sector"("leaderId");

-- TaskPricing statusOrder index
CREATE INDEX "TaskPricing_statusOrder_idx" ON "TaskPricing"("statusOrder");

-- UserNotificationPreference unique constraint
CREATE UNIQUE INDEX "UserNotificationPreference_userId_notificationType_eventTyp_key" ON "UserNotificationPreference"("userId", "notificationType", "eventType");

-- =============================================
-- PHASE 6: FOREIGN KEY CONSTRAINTS
-- =============================================

-- PpeDeliverySignature FKs
ALTER TABLE "PpeDeliverySignature" ADD CONSTRAINT "PpeDeliverySignature_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "PpeDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PpeDeliverySignature" ADD CONSTRAINT "PpeDeliverySignature_signedByUserId_fkey" FOREIGN KEY ("signedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PpeDeliverySignature" ADD CONSTRAINT "PpeDeliverySignature_signedDocumentId_fkey" FOREIGN KEY ("signedDocumentId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sector FK (new leaderId)
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TaskPricingService FKs
ALTER TABLE "TaskPricingService" ADD CONSTRAINT "TaskPricingService_pricingId_fkey" FOREIGN KEY ("pricingId") REFERENCES "TaskPricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskPricingService" ADD CONSTRAINT "TaskPricingService_invoiceToCustomerId_fkey" FOREIGN KEY ("invoiceToCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TaskPricingCustomerConfig FKs
ALTER TABLE "TaskPricingCustomerConfig" ADD CONSTRAINT "TaskPricingCustomerConfig_pricingId_fkey" FOREIGN KEY ("pricingId") REFERENCES "TaskPricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskPricingCustomerConfig" ADD CONSTRAINT "TaskPricingCustomerConfig_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskPricingCustomerConfig" ADD CONSTRAINT "TaskPricingCustomerConfig_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "Representative"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskPricingCustomerConfig" ADD CONSTRAINT "TaskPricingCustomerConfig_customerSignatureId_fkey" FOREIGN KEY ("customerSignatureId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invoice FKs
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerConfigId_fkey" FOREIGN KEY ("customerConfigId") REFERENCES "TaskPricingCustomerConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Installment FKs
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_customerConfigId_fkey" FOREIGN KEY ("customerConfigId") REFERENCES "TaskPricingCustomerConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BankSlip FKs
ALTER TABLE "BankSlip" ADD CONSTRAINT "BankSlip_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankSlip" ADD CONSTRAINT "BankSlip_pdfFileId_fkey" FOREIGN KEY ("pdfFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- NfseDocument FK
ALTER TABLE "NfseDocument" ADD CONSTRAINT "NfseDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Service Order checkin/checkout files FKs
ALTER TABLE "_SERVICE_ORDER_CHECKIN_FILES" ADD CONSTRAINT "_SERVICE_ORDER_CHECKIN_FILES_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_SERVICE_ORDER_CHECKIN_FILES" ADD CONSTRAINT "_SERVICE_ORDER_CHECKIN_FILES_B_fkey" FOREIGN KEY ("B") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_SERVICE_ORDER_CHECKOUT_FILES" ADD CONSTRAINT "_SERVICE_ORDER_CHECKOUT_FILES_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_SERVICE_ORDER_CHECKOUT_FILES" ADD CONSTRAINT "_SERVICE_ORDER_CHECKOUT_FILES_B_fkey" FOREIGN KEY ("B") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================
-- PHASE 7: DATA MIGRATION FOR NEW TABLES
-- =============================================

-- 7a. Migrate _TaskPricingInvoiceTo to TaskPricingCustomerConfig
-- A = Customer.id, B = TaskPricing.id
INSERT INTO "TaskPricingCustomerConfig" ("id", "pricingId", "customerId", "subtotal", "total", "updatedAt")
SELECT
  gen_random_uuid(),
  tpi."B",
  tpi."A",
  tp."subtotal",
  tp."total",
  NOW()
FROM "_TaskPricingInvoiceTo" tpi
JOIN "TaskPricing" tp ON tp."id" = tpi."B";

-- 7b. For pricings that had NO entry in _TaskPricingInvoiceTo,
-- create a default customer config using the task's customer
INSERT INTO "TaskPricingCustomerConfig" ("id", "pricingId", "customerId", "subtotal", "total", "updatedAt")
SELECT
  gen_random_uuid(),
  tp."id",
  t."customerId",
  tp."subtotal",
  tp."total",
  NOW()
FROM "TaskPricing" tp
JOIN "Task" t ON t."pricingId" = tp."id"
WHERE t."customerId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "TaskPricingCustomerConfig" tpcc
    WHERE tpcc."pricingId" = tp."id"
  );

-- =============================================
-- PHASE 8: CLEANUP
-- =============================================

-- Drop _TaskPricingInvoiceTo (data already migrated to TaskPricingCustomerConfig)
ALTER TABLE "_TaskPricingInvoiceTo" DROP CONSTRAINT "_TaskPricingInvoiceTo_A_fkey";
ALTER TABLE "_TaskPricingInvoiceTo" DROP CONSTRAINT "_TaskPricingInvoiceTo_B_fkey";
DROP TABLE "_TaskPricingInvoiceTo";

-- Drop PaymentCondition enum (no longer used — payment condition is now free-text on customer config)
DROP TYPE "PaymentCondition";
