-- =============================================
-- PHASE 1: Create new enums
-- =============================================

CREATE TYPE "BiometricMethod" AS ENUM ('FINGERPRINT', 'FACE_ID', 'IRIS', 'DEVICE_PIN', 'NONE');
CREATE TYPE "NetworkType" AS ENUM ('WIFI', 'CELLULAR', 'ETHERNET', 'UNKNOWN');
CREATE TYPE "TaskQuoteStatus" AS ENUM ('PENDING', 'BUDGET_APPROVED', 'VERIFIED_BY_FINANCIAL', 'BILLING_APPROVED', 'UPCOMING', 'DUE', 'PARTIAL', 'SETTLED');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'OVERDUE', 'CANCELLED');
CREATE TYPE "BankSlipStatus" AS ENUM ('CREATING', 'REGISTERING', 'ACTIVE', 'OVERDUE', 'PAID', 'CANCELLED', 'REJECTED', 'ERROR');
CREATE TYPE "NfseStatus" AS ENUM ('PENDING', 'PROCESSING', 'AUTHORIZED', 'CANCELLED', 'ERROR');
CREATE TYPE "BankSlipType" AS ENUM ('NORMAL', 'HIBRIDO');
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- =============================================
-- PHASE 2: Alter existing enums
-- =============================================

-- AlterEnum - ChangeLogEntityType: convert column to TEXT, remap values, replace enum
ALTER TABLE "ChangeLog" ALTER COLUMN "entityType" TYPE TEXT;
UPDATE "ChangeLog" SET "entityType" = 'TASK_QUOTE' WHERE "entityType" = 'TASK_PRICING';
UPDATE "ChangeLog" SET "entityType" = 'TASK_QUOTE_SERVICE' WHERE "entityType" = 'TASK_PRICING_ITEM';
DROP TYPE "public"."ChangeLogEntityType";
CREATE TYPE "ChangeLogEntityType" AS ENUM ('ABSENCE', 'ACTIVITY', 'AIRBRUSHING', 'BONUS', 'BORROW', 'CALCULATION', 'CALCULATION_DECOMPOSITION', 'CALCULATION_DETAIL', 'CATEGORY', 'COLLECTION', 'COMMISSION', 'CUSTOMER', 'CUT', 'CUT_ITEM', 'CUT_PLAN', 'CUT_REQUEST', 'DELIVERY', 'DEPLOYMENT', 'DISCOUNT', 'ECONOMIC_ACTIVITY', 'EXPENSE', 'EXTERNAL_WITHDRAWAL', 'EXTERNAL_WITHDRAWAL_ITEM', 'FILE', 'HOLIDAY', 'ITEM', 'ITEM_BRAND', 'ITEM_CATEGORY', 'LAYOUT', 'MAINTENANCE', 'MAINTENANCE_ITEM', 'MAINTENANCE_SCHEDULE', 'NOTIFICATION', 'NOTIFICATION_PREFERENCE', 'OBSERVATION', 'ORDER', 'ORDER_ITEM', 'ORDER_RULE', 'ORDER_SCHEDULE', 'PAINT', 'PAINT_FORMULA', 'PAINT_FORMULA_COMPONENT', 'PAINT_GROUND', 'PAINT_PRODUCTION', 'PAINT_TYPE', 'PARKING_SPOT', 'PAYROLL', 'PIECE', 'POSITION', 'PPE_CONFIG', 'PPE_DELIVERY', 'PPE_DELIVERY_ITEM', 'PPE_DELIVERY_SCHEDULE', 'PPE_REQUEST', 'PPE_SIZE', 'PRICE', 'PRODUCTION', 'PURCHASE', 'REPRESENTATIVE', 'RESPONSIBLE', 'SECTOR', 'SEEN_NOTIFICATION', 'SERVICE', 'SERVICE_ORDER', 'SUPPLIER', 'TASK', 'TASK_QUOTE', 'TASK_QUOTE_ITEM', 'TASK_QUOTE_SERVICE', 'TASK_QUOTE_CUSTOMER_CONFIG', 'TIME_CLOCK_ENTRY', 'TRUCK', 'USER', 'VACATION', 'VERIFICATION', 'WARNING');
ALTER TABLE "ChangeLog" ALTER COLUMN "entityType" TYPE "ChangeLogEntityType" USING ("entityType"::"ChangeLogEntityType");

-- AlterEnum - SectorPrivileges (add value)
ALTER TYPE "SectorPrivileges" ADD VALUE IF NOT EXISTS 'PRODUCTION_MANAGER';

-- AlterEnum - ServiceOrderType: delete FINANCIAL service orders, replace enum
DELETE FROM "ServiceOrder" WHERE "type"::text = 'FINANCIAL';
ALTER TABLE "ServiceOrder" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "ServiceOrder" ALTER COLUMN "type" TYPE TEXT;
DROP TYPE "public"."ServiceOrderType";
CREATE TYPE "ServiceOrderType" AS ENUM ('PRODUCTION', 'COMMERCIAL', 'ARTWORK', 'LOGISTIC');
ALTER TABLE "ServiceOrder" ALTER COLUMN "type" TYPE "ServiceOrderType" USING ("type"::"ServiceOrderType");
ALTER TABLE "ServiceOrder" ALTER COLUMN "type" SET DEFAULT 'PRODUCTION';

-- =============================================
-- PHASE 3: Create new tables (before dropping old ones, for data migration)
-- =============================================

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

CREATE TABLE "TaskQuote" (
    "id" TEXT NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "TaskQuoteStatus" NOT NULL DEFAULT 'PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "guaranteeYears" INTEGER,
    "customGuaranteeText" TEXT,
    "layoutFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "budgetNumber" INTEGER NOT NULL,
    "customForecastDays" INTEGER,
    "simultaneousTasks" INTEGER,
    CONSTRAINT "TaskQuote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskQuoteService" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "quoteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "observation" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" DECIMAL(10,2),
    "discountReference" TEXT,
    "invoiceToCustomerId" TEXT,
    CONSTRAINT "TaskQuoteService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskQuoteCustomerConfig" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "customPaymentText" TEXT,
    "generateInvoice" BOOLEAN NOT NULL DEFAULT true,
    "responsibleId" TEXT,
    "paymentCondition" TEXT,
    "customerSignatureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaskQuoteCustomerConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskForecastHistory" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "previousDate" TIMESTAMP(3),
    "newDate" TIMESTAMP(3),
    "reason" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskForecastHistory_pkey" PRIMARY KEY ("id")
);

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
    "paymentMethod" TEXT,
    "receiptFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

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
-- PHASE 4: Data migration - TaskPricing -> TaskQuote
-- =============================================

-- 4a. Migrate TaskPricing -> TaskQuote
-- Map old statuses: DRAFT -> PENDING, APPROVED -> BUDGET_APPROVED, REJECTED/CANCELLED -> PENDING
INSERT INTO "TaskQuote" ("id", "subtotal", "total", "expiresAt", "status", "statusOrder", "guaranteeYears", "customGuaranteeText", "layoutFileId", "createdAt", "updatedAt", "budgetNumber", "customForecastDays", "simultaneousTasks")
SELECT
    tp."id",
    tp."subtotal",
    tp."total",
    tp."expiresAt",
    CASE tp."status"::text
        WHEN 'APPROVED' THEN 'BUDGET_APPROVED'::"TaskQuoteStatus"
        WHEN 'DRAFT' THEN 'PENDING'::"TaskQuoteStatus"
        ELSE 'PENDING'::"TaskQuoteStatus"
    END,
    CASE tp."status"::text
        WHEN 'APPROVED' THEN 2
        ELSE 1
    END,
    tp."guaranteeYears",
    tp."customGuaranteeText",
    tp."layoutFileId",
    tp."createdAt",
    tp."updatedAt",
    tp."budgetNumber",
    tp."customForecastDays",
    tp."simultaneousTasks"
FROM "TaskPricing" tp;

-- 4b. Migrate TaskPricingItem -> TaskQuoteService
-- For PERCENTAGE discounts: apply same percentage to each service (mathematically equivalent)
-- For FIXED_VALUE discounts: distribute proportionally across services by amount
INSERT INTO "TaskQuoteService" ("id", "description", "amount", "quoteId", "createdAt", "updatedAt", "observation", "position", "discountType", "discountValue", "discountReference", "invoiceToCustomerId")
SELECT
    tpi."id",
    tpi."description",
    tpi."amount",
    tpi."pricingId",
    tpi."createdAt",
    tpi."updatedAt",
    tpi."observation",
    tpi."position",
    CASE
        WHEN tp."discountType"::text = 'NONE' THEN 'NONE'::"DiscountType"
        WHEN tp."discountType"::text = 'PERCENTAGE' THEN 'PERCENTAGE'::"DiscountType"
        WHEN tp."discountType"::text = 'FIXED_VALUE' THEN 'FIXED_VALUE'::"DiscountType"
        ELSE 'NONE'::"DiscountType"
    END,
    CASE
        WHEN tp."discountType"::text = 'NONE' THEN NULL
        WHEN tp."discountType"::text = 'PERCENTAGE' THEN tp."discountValue"
        WHEN tp."discountType"::text = 'FIXED_VALUE' THEN
            -- Distribute fixed discount proportionally by service amount
            CASE
                WHEN tp."subtotal" > 0 THEN ROUND((tpi."amount" / tp."subtotal") * tp."discountValue", 2)
                ELSE 0
            END
        ELSE NULL
    END,
    CASE
        WHEN tp."discountType"::text != 'NONE' THEN tp."discountReference"
        ELSE NULL
    END,
    NULL -- no invoiceToCustomerId in old model
FROM "TaskPricingItem" tpi
JOIN "TaskPricing" tp ON tp."id" = tpi."pricingId";

-- 4c. Migrate _TaskPricingInvoiceTo -> TaskQuoteCustomerConfig
-- A = customerId, B = pricingId (now quoteId)
-- Carry over customer-level fields from TaskPricing (responsibleId, paymentCondition, customerSignatureId, customPaymentText)
INSERT INTO "TaskQuoteCustomerConfig" ("id", "quoteId", "customerId", "subtotal", "total", "customPaymentText", "generateInvoice", "responsibleId", "paymentCondition", "customerSignatureId", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    inv."B",
    inv."A",
    tp."subtotal",
    tp."total",
    tp."customPaymentText",
    true,
    tp."responsibleId",
    tp."paymentCondition"::text,
    tp."customerSignatureId",
    tp."createdAt",
    tp."updatedAt"
FROM "_TaskPricingInvoiceTo" inv
JOIN "TaskPricing" tp ON tp."id" = inv."B";

-- 4d. Set BUDGET_APPROVED for quotes linked to tasks with COMPLETED or IN_PRODUCTION status
UPDATE "TaskQuote" tq
SET "status" = 'BUDGET_APPROVED'::"TaskQuoteStatus", "statusOrder" = 2
FROM "Task" t
WHERE t."pricingId" = tq."id"
  AND t."status"::text IN ('COMPLETED', 'IN_PRODUCTION');

-- =============================================
-- PHASE 5: Drop old foreign keys and indexes
-- =============================================

ALTER TABLE "Sector" DROP CONSTRAINT "Sector_managerId_fkey";
ALTER TABLE "Task" DROP CONSTRAINT "Task_pricingId_fkey";
ALTER TABLE "TaskPricing" DROP CONSTRAINT "TaskPricing_customerSignatureId_fkey";
ALTER TABLE "TaskPricing" DROP CONSTRAINT "TaskPricing_layoutFileId_fkey";
ALTER TABLE "TaskPricing" DROP CONSTRAINT "TaskPricing_responsibleId_fkey";
ALTER TABLE "TaskPricingItem" DROP CONSTRAINT "TaskPricingItem_pricingId_fkey";
ALTER TABLE "_TaskPricingInvoiceTo" DROP CONSTRAINT "_TaskPricingInvoiceTo_A_fkey";
ALTER TABLE "_TaskPricingInvoiceTo" DROP CONSTRAINT "_TaskPricingInvoiceTo_B_fkey";

DROP INDEX "PpeDelivery_clicksignDocumentKey_idx";
DROP INDEX "Sector_managerId_idx";
DROP INDEX "Sector_managerId_key";
DROP INDEX "Task_pricingId_key";

-- =============================================
-- PHASE 6: Alter existing tables
-- =============================================

ALTER TABLE "Backup" ALTER COLUMN "gdriveDeleteStatus" DROP NOT NULL,
ALTER COLUMN "gdriveDeleteStatus" DROP DEFAULT;

ALTER TABLE "ConsumptionSnapshot" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NotificationChannelConfig" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NotificationConfiguration" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NotificationRule" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NotificationSectorOverride" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NotificationTargetRule" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Representative" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "PpeDelivery" DROP COLUMN "clicksignDocumentKey",
DROP COLUMN "clicksignEnvelopeId",
DROP COLUMN "clicksignSignedAt",
DROP COLUMN "clicksignSignerKey";

-- Sector: migrate managerId -> leaderId
ALTER TABLE "Sector" ADD COLUMN "leaderId" TEXT;
UPDATE "Sector" SET "leaderId" = "managerId";
ALTER TABLE "Sector" DROP COLUMN "managerId";

ALTER TABLE "ServiceOrder" DROP COLUMN "shouldSync";

-- Task: migrate pricingId -> quoteId
ALTER TABLE "Task" ADD COLUMN "cleared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN "quoteId" TEXT;
UPDATE "Task" SET "quoteId" = "pricingId";
ALTER TABLE "Task" DROP COLUMN "pricingId";

-- Convert implicit join table unique indexes to primary keys
ALTER TABLE "_TASK_CHECKIN_FILES" ADD CONSTRAINT "_TASK_CHECKIN_FILES_AB_pkey" PRIMARY KEY ("A", "B");
DROP INDEX "_TASK_CHECKIN_FILES_AB_unique";

ALTER TABLE "_TASK_CHECKOUT_FILES" ADD CONSTRAINT "_TASK_CHECKOUT_FILES_AB_pkey" PRIMARY KEY ("A", "B");
DROP INDEX "_TASK_CHECKOUT_FILES_AB_unique";

ALTER TABLE "_TASK_PROJECT_FILES" ADD CONSTRAINT "_TASK_PROJECT_FILES_AB_pkey" PRIMARY KEY ("A", "B");
DROP INDEX "_TASK_PROJECT_FILES_AB_unique";

-- =============================================
-- PHASE 7: Drop old tables and enums
-- =============================================

DROP TABLE "TaskPricingItem";
DROP TABLE "_TaskPricingInvoiceTo";
DROP TABLE "TaskPricing";
DROP TYPE "PaymentCondition";
DROP TYPE "TaskPricingStatus";

-- =============================================
-- PHASE 8: Create indexes
-- =============================================

CREATE UNIQUE INDEX "PpeDeliverySignature_deliveryId_key" ON "PpeDeliverySignature"("deliveryId");
CREATE INDEX "PpeDeliverySignature_signedByUserId_idx" ON "PpeDeliverySignature"("signedByUserId");
CREATE INDEX "PpeDeliverySignature_deliveryId_idx" ON "PpeDeliverySignature"("deliveryId");

CREATE UNIQUE INDEX "TaskQuote_budgetNumber_key" ON "TaskQuote"("budgetNumber");
CREATE INDEX "TaskQuote_status_idx" ON "TaskQuote"("status");
CREATE INDEX "TaskQuote_statusOrder_idx" ON "TaskQuote"("statusOrder");
CREATE INDEX "TaskQuote_expiresAt_idx" ON "TaskQuote"("expiresAt");
CREATE INDEX "TaskQuote_layoutFileId_idx" ON "TaskQuote"("layoutFileId");

CREATE INDEX "TaskQuoteService_quoteId_idx" ON "TaskQuoteService"("quoteId");
CREATE INDEX "TaskQuoteService_invoiceToCustomerId_idx" ON "TaskQuoteService"("invoiceToCustomerId");

CREATE INDEX "TaskQuoteCustomerConfig_quoteId_idx" ON "TaskQuoteCustomerConfig"("quoteId");
CREATE INDEX "TaskQuoteCustomerConfig_customerId_idx" ON "TaskQuoteCustomerConfig"("customerId");
CREATE INDEX "TaskQuoteCustomerConfig_responsibleId_idx" ON "TaskQuoteCustomerConfig"("responsibleId");
CREATE INDEX "TaskQuoteCustomerConfig_customerSignatureId_idx" ON "TaskQuoteCustomerConfig"("customerSignatureId");
CREATE UNIQUE INDEX "TaskQuoteCustomerConfig_quoteId_customerId_key" ON "TaskQuoteCustomerConfig"("quoteId", "customerId");

CREATE INDEX "TaskForecastHistory_taskId_idx" ON "TaskForecastHistory"("taskId");
CREATE INDEX "TaskForecastHistory_createdAt_idx" ON "TaskForecastHistory"("createdAt");
CREATE INDEX "TaskForecastHistory_taskId_createdAt_idx" ON "TaskForecastHistory"("taskId", "createdAt");

CREATE UNIQUE INDEX "Invoice_customerConfigId_key" ON "Invoice"("customerConfigId");
CREATE INDEX "Invoice_taskId_idx" ON "Invoice"("taskId");
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_createdById_idx" ON "Invoice"("createdById");

CREATE INDEX "Installment_customerConfigId_idx" ON "Installment"("customerConfigId");
CREATE INDEX "Installment_invoiceId_idx" ON "Installment"("invoiceId");
CREATE INDEX "Installment_dueDate_idx" ON "Installment"("dueDate");
CREATE INDEX "Installment_status_idx" ON "Installment"("status");
CREATE UNIQUE INDEX "Installment_customerConfigId_number_key" ON "Installment"("customerConfigId", "number");

CREATE UNIQUE INDEX "BankSlip_installmentId_key" ON "BankSlip"("installmentId");
CREATE UNIQUE INDEX "BankSlip_nossoNumero_key" ON "BankSlip"("nossoNumero");
CREATE INDEX "BankSlip_nossoNumero_idx" ON "BankSlip"("nossoNumero");
CREATE INDEX "BankSlip_status_idx" ON "BankSlip"("status");
CREATE INDEX "BankSlip_dueDate_idx" ON "BankSlip"("dueDate");

CREATE INDEX "NfseDocument_invoiceId_idx" ON "NfseDocument"("invoiceId");
CREATE INDEX "NfseDocument_elotechNfseId_idx" ON "NfseDocument"("elotechNfseId");
CREATE INDEX "NfseDocument_status_idx" ON "NfseDocument"("status");

CREATE UNIQUE INDEX "SicrediToken_identifier_key" ON "SicrediToken"("identifier");
CREATE INDEX "SicrediToken_expiresAt_idx" ON "SicrediToken"("expiresAt");
CREATE INDEX "SicrediToken_identifier_idx" ON "SicrediToken"("identifier");

CREATE UNIQUE INDEX "SicrediWebhookEvent_idEventoWebhook_key" ON "SicrediWebhookEvent"("idEventoWebhook");
CREATE INDEX "SicrediWebhookEvent_nossoNumero_idx" ON "SicrediWebhookEvent"("nossoNumero");
CREATE INDEX "SicrediWebhookEvent_status_idx" ON "SicrediWebhookEvent"("status");
CREATE INDEX "SicrediWebhookEvent_dataEvento_idx" ON "SicrediWebhookEvent"("dataEvento");

CREATE INDEX "_SERVICE_ORDER_CHECKIN_FILES_B_index" ON "_SERVICE_ORDER_CHECKIN_FILES"("B");
CREATE INDEX "_SERVICE_ORDER_CHECKOUT_FILES_B_index" ON "_SERVICE_ORDER_CHECKOUT_FILES"("B");

CREATE INDEX "Item_isManualMaxQuantity_idx" ON "Item"("isManualMaxQuantity");
CREATE INDEX "Item_isManualReorderPoint_idx" ON "Item"("isManualReorderPoint");
CREATE INDEX "Item_lastAutoOrderDate_idx" ON "Item"("lastAutoOrderDate");

CREATE UNIQUE INDEX "Sector_leaderId_key" ON "Sector"("leaderId");
CREATE INDEX "Sector_leaderId_idx" ON "Sector"("leaderId");

CREATE UNIQUE INDEX "Task_quoteId_key" ON "Task"("quoteId");

CREATE UNIQUE INDEX "UserNotificationPreference_userId_notificationType_eventTyp_key" ON "UserNotificationPreference"("userId", "notificationType", "eventType");

-- =============================================
-- PHASE 9: Add foreign keys
-- =============================================

ALTER TABLE "PpeDeliverySignature" ADD CONSTRAINT "PpeDeliverySignature_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "PpeDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PpeDeliverySignature" ADD CONSTRAINT "PpeDeliverySignature_signedByUserId_fkey" FOREIGN KEY ("signedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PpeDeliverySignature" ADD CONSTRAINT "PpeDeliverySignature_signedDocumentId_fkey" FOREIGN KEY ("signedDocumentId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Sector" ADD CONSTRAINT "Sector_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskQuote" ADD CONSTRAINT "TaskQuote_layoutFileId_fkey" FOREIGN KEY ("layoutFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskQuoteService" ADD CONSTRAINT "TaskQuoteService_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "TaskQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskQuoteService" ADD CONSTRAINT "TaskQuoteService_invoiceToCustomerId_fkey" FOREIGN KEY ("invoiceToCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskQuoteCustomerConfig" ADD CONSTRAINT "TaskQuoteCustomerConfig_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "TaskQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskQuoteCustomerConfig" ADD CONSTRAINT "TaskQuoteCustomerConfig_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskQuoteCustomerConfig" ADD CONSTRAINT "TaskQuoteCustomerConfig_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "Representative"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskQuoteCustomerConfig" ADD CONSTRAINT "TaskQuoteCustomerConfig_customerSignatureId_fkey" FOREIGN KEY ("customerSignatureId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task" ADD CONSTRAINT "Task_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "TaskQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskForecastHistory" ADD CONSTRAINT "TaskForecastHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskForecastHistory" ADD CONSTRAINT "TaskForecastHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerConfigId_fkey" FOREIGN KEY ("customerConfigId") REFERENCES "TaskQuoteCustomerConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Installment" ADD CONSTRAINT "Installment_customerConfigId_fkey" FOREIGN KEY ("customerConfigId") REFERENCES "TaskQuoteCustomerConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BankSlip" ADD CONSTRAINT "BankSlip_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankSlip" ADD CONSTRAINT "BankSlip_pdfFileId_fkey" FOREIGN KEY ("pdfFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NfseDocument" ADD CONSTRAINT "NfseDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_SERVICE_ORDER_CHECKIN_FILES" ADD CONSTRAINT "_SERVICE_ORDER_CHECKIN_FILES_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_SERVICE_ORDER_CHECKIN_FILES" ADD CONSTRAINT "_SERVICE_ORDER_CHECKIN_FILES_B_fkey" FOREIGN KEY ("B") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_SERVICE_ORDER_CHECKOUT_FILES" ADD CONSTRAINT "_SERVICE_ORDER_CHECKOUT_FILES_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_SERVICE_ORDER_CHECKOUT_FILES" ADD CONSTRAINT "_SERVICE_ORDER_CHECKOUT_FILES_B_fkey" FOREIGN KEY ("B") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
