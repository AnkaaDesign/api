-- ============================================================================
-- CONSOLIDATED MIGRATION: Production Backup → Current Schema
-- ============================================================================
--
-- This script brings a restored production backup (with migrations through
-- 20260130_add_ppe_delivery_signature_statuses) up to the current schema.
--
-- The backup has 19 migrations applied (0_init through 20260130).
-- The current codebase has a squashed 0_init + 9 new migrations.
-- This script applies all changes that bridge the gap.
--
-- Run this AGAINST the restored backup DB, then use:
--   npx prisma migrate resolve --applied <migration_name>
-- for each migration, OR let Step 17 handle it automatically.
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create RepresentativeRole enum
-- ============================================================================

CREATE TYPE "RepresentativeRole" AS ENUM (
    'COMMERCIAL',
    'MARKETING',
    'COORDINATOR',
    'FINANCIAL',
    'FLEET_MANAGER'
);

-- ============================================================================
-- STEP 2: Create Representative table
-- ============================================================================

CREATE TABLE "Representative" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "password" TEXT,
    "role" "RepresentativeRole" NOT NULL,
    "customerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verificationCode" TEXT,
    "verificationExpiresAt" TIMESTAMP(3),
    "sessionToken" TEXT,
    "resetToken" TEXT,
    "resetTokenExpiry" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Representative_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Representative_email_key" ON "Representative"("email");
CREATE UNIQUE INDEX "Representative_phone_key" ON "Representative"("phone");
CREATE UNIQUE INDEX "Representative_sessionToken_key" ON "Representative"("sessionToken");
CREATE UNIQUE INDEX "Representative_resetToken_key" ON "Representative"("resetToken");
CREATE INDEX "Representative_email_idx" ON "Representative"("email");
CREATE INDEX "Representative_phone_idx" ON "Representative"("phone");
CREATE INDEX "Representative_customerId_idx" ON "Representative"("customerId");
CREATE INDEX "Representative_role_idx" ON "Representative"("role");

ALTER TABLE "Representative" ADD CONSTRAINT "Representative_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- STEP 3: Create _TaskRepresentatives join table
-- ============================================================================

CREATE TABLE "_TaskRepresentatives" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TaskRepresentatives_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_TaskRepresentatives_B_index" ON "_TaskRepresentatives"("B");

ALTER TABLE "_TaskRepresentatives" ADD CONSTRAINT "_TaskRepresentatives_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Representative"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_TaskRepresentatives" ADD CONSTRAINT "_TaskRepresentatives_B_fkey"
    FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- STEP 4: Migrate Task.negotiatingWith JSONB → Representative records
-- ============================================================================
-- The negotiatingWith column contains JSONB data with name/phone/email.
-- We create Representative records with role=COMMERCIAL and link them to tasks.

DO $$
DECLARE
    task_record RECORD;
    neg_data JSONB;
    rep_name TEXT;
    rep_phone TEXT;
    rep_email TEXT;
    rep_id TEXT;
    existing_rep_id TEXT;
    arr_elem JSONB;
BEGIN
    FOR task_record IN
        SELECT id, "customerId", "negotiatingWith"
        FROM "Task"
        WHERE "negotiatingWith" IS NOT NULL
          AND "negotiatingWith"::text NOT IN ('null', '[]', '{}', '')
    LOOP
        neg_data := task_record."negotiatingWith";

        -- Handle array format: [{"name": "...", "phone": "...", "email": "..."}, ...]
        IF jsonb_typeof(neg_data) = 'array' THEN
            FOR arr_elem IN SELECT * FROM jsonb_array_elements(neg_data) LOOP
                rep_name := arr_elem->>'name';
                rep_phone := arr_elem->>'phone';
                rep_email := NULLIF(arr_elem->>'email', '');

                IF rep_name IS NOT NULL AND rep_phone IS NOT NULL AND rep_phone != '' THEN
                    -- Check if representative already exists by phone
                    SELECT id INTO existing_rep_id
                    FROM "Representative"
                    WHERE phone = rep_phone
                    LIMIT 1;

                    IF existing_rep_id IS NULL THEN
                        rep_id := gen_random_uuid()::text;
                        INSERT INTO "Representative" (
                            id, name, phone, email, role, "customerId",
                            "isActive", verified, "createdAt", "updatedAt"
                        ) VALUES (
                            rep_id, rep_name, rep_phone, rep_email, 'COMMERCIAL',
                            task_record."customerId", true, false, NOW(), NOW()
                        );
                    ELSE
                        rep_id := existing_rep_id;
                    END IF;

                    -- Link representative to task (ignore duplicates)
                    INSERT INTO "_TaskRepresentatives" ("A", "B")
                    VALUES (rep_id, task_record.id)
                    ON CONFLICT DO NOTHING;
                END IF;
            END LOOP;

        -- Handle object format: {"name": "...", "phone": "...", "email": "..."}
        ELSIF jsonb_typeof(neg_data) = 'object' THEN
            rep_name := neg_data->>'name';
            rep_phone := neg_data->>'phone';
            rep_email := NULLIF(neg_data->>'email', '');

            IF rep_name IS NOT NULL AND rep_phone IS NOT NULL AND rep_phone != '' THEN
                SELECT id INTO existing_rep_id
                FROM "Representative"
                WHERE phone = rep_phone
                LIMIT 1;

                IF existing_rep_id IS NULL THEN
                    rep_id := gen_random_uuid()::text;
                    INSERT INTO "Representative" (
                        id, name, phone, email, role, "customerId",
                        "isActive", verified, "createdAt", "updatedAt"
                    ) VALUES (
                        rep_id, rep_name, rep_phone, rep_email, 'COMMERCIAL',
                        task_record."customerId", true, false, NOW(), NOW()
                    );
                ELSE
                    rep_id := existing_rep_id;
                END IF;

                INSERT INTO "_TaskRepresentatives" ("A", "B")
                VALUES (rep_id, task_record.id)
                ON CONFLICT DO NOTHING;
            END IF;
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- STEP 5: Drop Task.negotiatingWith column
-- (Migration: 20260207230134_remove_negotiating_with)
-- ============================================================================

ALTER TABLE "Task" DROP COLUMN "negotiatingWith";

-- ============================================================================
-- STEP 6: Add Task.commissionOrder column
-- ============================================================================

ALTER TABLE "Task" ADD COLUMN "commissionOrder" INTEGER NOT NULL DEFAULT 3;

-- Backfill commissionOrder based on commission status
UPDATE "Task" SET "commissionOrder" = CASE
    WHEN commission = 'FULL_COMMISSION' THEN 1
    WHEN commission = 'PARTIAL_COMMISSION' THEN 2
    WHEN commission = 'NO_COMMISSION' THEN 3
    WHEN commission = 'SUSPENDED_COMMISSION' THEN 4
    ELSE 3
END;

CREATE INDEX "Task_commissionOrder_idx" ON "Task"("commissionOrder");

-- ============================================================================
-- STEP 7: Add Customer.stateRegistration column
-- (Migration: 20260210121010_add_customer_state_registration)
-- ============================================================================

ALTER TABLE "Customer" ADD COLUMN "stateRegistration" TEXT;

-- ============================================================================
-- STEP 8: Create _TaskPricingInvoiceTo and migrate invoiceToId data
-- (Migration: 20260211000000_remove_task_invoice_to_add_pricing_fields)
-- ============================================================================

-- Create the many-to-many join table
CREATE TABLE "_TaskPricingInvoiceTo" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TaskPricingInvoiceTo_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_TaskPricingInvoiceTo_B_index" ON "_TaskPricingInvoiceTo"("B");

ALTER TABLE "_TaskPricingInvoiceTo" ADD CONSTRAINT "_TaskPricingInvoiceTo_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_TaskPricingInvoiceTo" ADD CONSTRAINT "_TaskPricingInvoiceTo_B_fkey"
    FOREIGN KEY ("B") REFERENCES "TaskPricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing invoiceToId data to the many-to-many relationship
INSERT INTO "_TaskPricingInvoiceTo" ("A", "B")
SELECT DISTINCT t."invoiceToId", t."pricingId"
FROM "Task" t
WHERE t."invoiceToId" IS NOT NULL
  AND t."pricingId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Add new TaskPricing columns
ALTER TABLE "TaskPricing" ADD COLUMN "discountReference" TEXT;
ALTER TABLE "TaskPricing" ADD COLUMN "simultaneousTasks" INTEGER;

-- Drop the old invoiceToId column and its constraints
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_invoiceToId_fkey";
DROP INDEX IF EXISTS "Task_invoiceToId_idx";
ALTER TABLE "Task" DROP COLUMN "invoiceToId";

-- ============================================================================
-- STEP 9: Copy User.admissional → exp1StartAt, then drop admissional
-- (Migration: 20260211150000_remove_admissional_field)
-- ============================================================================

UPDATE "User"
SET "exp1StartAt" = "admissional"
WHERE "exp1StartAt" IS NULL
  AND "admissional" IS NOT NULL;

DROP INDEX IF EXISTS "User_admissional_idx";
ALTER TABLE "User" DROP COLUMN IF EXISTS "admissional";

-- ============================================================================
-- STEP 10: Add TASK_PRICING and REPRESENTATIVE to ChangeLogEntityType enum
-- (Migration: 20260211174227_add_task_pricing_changelog_entity_type)
-- ============================================================================

ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'TASK_PRICING';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'REPRESENTATIVE';

-- ============================================================================
-- STEP 11: Add inventory analytics columns + ConsumptionSnapshot table
-- (Migration: 20260211185849_add_inventory_analytics)
-- ============================================================================

ALTER TABLE "Item" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN "deactivationReason" TEXT;
ALTER TABLE "Item" ADD COLUMN "lastUsedAt" TIMESTAMP(3);

CREATE TABLE "ConsumptionSnapshot" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "totalConsumption" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "consumptionCount" INTEGER NOT NULL DEFAULT 0,
    "normalizedConsumption" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "workingDays" INTEGER NOT NULL DEFAULT 22,
    "seasonalFactor" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumptionSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsumptionSnapshot_itemId_idx" ON "ConsumptionSnapshot"("itemId");
CREATE INDEX "ConsumptionSnapshot_year_month_idx" ON "ConsumptionSnapshot"("year", "month");
CREATE UNIQUE INDEX "ConsumptionSnapshot_itemId_year_month_key" ON "ConsumptionSnapshot"("itemId", "year", "month");

CREATE INDEX "Item_lastUsedAt_idx" ON "Item"("lastUsedAt");
CREATE INDEX "Item_deactivatedAt_idx" ON "Item"("deactivatedAt");

-- ============================================================================
-- STEP 12: Create _TASK_BANK_SLIPS join table
-- (Migration: 20260213131750_add_task_bank_slips)
-- ============================================================================

CREATE TABLE "_TASK_BANK_SLIPS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TASK_BANK_SLIPS_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_TASK_BANK_SLIPS_B_index" ON "_TASK_BANK_SLIPS"("B");

ALTER TABLE "_TASK_BANK_SLIPS" ADD CONSTRAINT "_TASK_BANK_SLIPS_A_fkey"
    FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_TASK_BANK_SLIPS" ADD CONSTRAINT "_TASK_BANK_SLIPS_B_fkey"
    FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- STEP 13: Transform NotificationType enum (20 old values → 5 new values)
-- ============================================================================
-- Old values: SYSTEM, TASK, ORDER, SERVICE_ORDER, PPE, VACATION, WARNING,
--   STOCK, GENERAL, TASK_STATUS, TASK_DEADLINE, TASK_ASSIGNMENT,
--   TASK_FIELD_UPDATE, ORDER_CREATED, ORDER_STATUS, ORDER_OVERDUE,
--   STOCK_LOW, STOCK_OUT, STOCK_REORDER, CUT
-- New values: SYSTEM, PRODUCTION, STOCK, USER, GENERAL
--
-- Strategy: temp text columns → map values → drop old enum → create new → copy back

-- Add temp text columns
ALTER TABLE "Notification" ADD COLUMN "type_temp" TEXT;
ALTER TABLE "NotificationPreference" ADD COLUMN "notificationType_temp" TEXT;
ALTER TABLE "UserNotificationPreference" ADD COLUMN "notificationType_temp" TEXT;

-- Map old values to new values
UPDATE "Notification" SET "type_temp" = CASE
    WHEN type::text = 'SYSTEM' THEN 'SYSTEM'
    WHEN type::text IN ('TASK', 'TASK_STATUS', 'TASK_DEADLINE', 'TASK_ASSIGNMENT',
                         'TASK_FIELD_UPDATE', 'ORDER', 'ORDER_CREATED', 'ORDER_STATUS',
                         'ORDER_OVERDUE', 'SERVICE_ORDER', 'PPE', 'CUT') THEN 'PRODUCTION'
    WHEN type::text IN ('STOCK', 'STOCK_LOW', 'STOCK_OUT', 'STOCK_REORDER') THEN 'STOCK'
    WHEN type::text IN ('VACATION', 'WARNING') THEN 'USER'
    WHEN type::text = 'GENERAL' THEN 'GENERAL'
    ELSE 'GENERAL'
END;

UPDATE "NotificationPreference" SET "notificationType_temp" = CASE
    WHEN "notificationType"::text = 'SYSTEM' THEN 'SYSTEM'
    WHEN "notificationType"::text IN ('TASK', 'TASK_STATUS', 'TASK_DEADLINE', 'TASK_ASSIGNMENT',
                                       'TASK_FIELD_UPDATE', 'ORDER', 'ORDER_CREATED', 'ORDER_STATUS',
                                       'ORDER_OVERDUE', 'SERVICE_ORDER', 'PPE', 'CUT') THEN 'PRODUCTION'
    WHEN "notificationType"::text IN ('STOCK', 'STOCK_LOW', 'STOCK_OUT', 'STOCK_REORDER') THEN 'STOCK'
    WHEN "notificationType"::text IN ('VACATION', 'WARNING') THEN 'USER'
    WHEN "notificationType"::text = 'GENERAL' THEN 'GENERAL'
    ELSE 'GENERAL'
END;

UPDATE "UserNotificationPreference" SET "notificationType_temp" = CASE
    WHEN "notificationType"::text = 'SYSTEM' THEN 'SYSTEM'
    WHEN "notificationType"::text IN ('TASK', 'TASK_STATUS', 'TASK_DEADLINE', 'TASK_ASSIGNMENT',
                                       'TASK_FIELD_UPDATE', 'ORDER', 'ORDER_CREATED', 'ORDER_STATUS',
                                       'ORDER_OVERDUE', 'SERVICE_ORDER', 'PPE', 'CUT') THEN 'PRODUCTION'
    WHEN "notificationType"::text IN ('STOCK', 'STOCK_LOW', 'STOCK_OUT', 'STOCK_REORDER') THEN 'STOCK'
    WHEN "notificationType"::text IN ('VACATION', 'WARNING') THEN 'USER'
    WHEN "notificationType"::text = 'GENERAL' THEN 'GENERAL'
    ELSE 'GENERAL'
END;

-- Drop old type columns (which depend on the old enum)
ALTER TABLE "Notification" DROP COLUMN "type";
ALTER TABLE "NotificationPreference" DROP COLUMN "notificationType";
ALTER TABLE "UserNotificationPreference" DROP COLUMN "notificationType";

-- Drop and recreate the enum
DROP TYPE "NotificationType";
CREATE TYPE "NotificationType" AS ENUM ('SYSTEM', 'PRODUCTION', 'STOCK', 'USER', 'GENERAL');

-- Add new columns with the new enum type
ALTER TABLE "Notification" ADD COLUMN "type" "NotificationType";
ALTER TABLE "NotificationPreference" ADD COLUMN "notificationType" "NotificationType";
ALTER TABLE "UserNotificationPreference" ADD COLUMN "notificationType" "NotificationType";

-- Copy mapped values
UPDATE "Notification" SET "type" = "type_temp"::"NotificationType";
UPDATE "NotificationPreference" SET "notificationType" = "notificationType_temp"::"NotificationType";
UPDATE "UserNotificationPreference" SET "notificationType" = "notificationType_temp"::"NotificationType";

-- Drop temp columns
ALTER TABLE "Notification" DROP COLUMN "type_temp";
ALTER TABLE "NotificationPreference" DROP COLUMN "notificationType_temp";
ALTER TABLE "UserNotificationPreference" DROP COLUMN "notificationType_temp";

-- Set NOT NULL constraints
ALTER TABLE "Notification" ALTER COLUMN "type" SET NOT NULL;
ALTER TABLE "NotificationPreference" ALTER COLUMN "notificationType" SET NOT NULL;
ALTER TABLE "UserNotificationPreference" ALTER COLUMN "notificationType" SET NOT NULL;

-- ============================================================================
-- STEP 14: Truncate notification data (user confirmed OK to lose)
-- ============================================================================

TRUNCATE TABLE "SeenNotification" CASCADE;
TRUNCATE TABLE "NotificationDelivery" CASCADE;
TRUNCATE TABLE "Notification" CASCADE;
TRUNCATE TABLE "NotificationPreference" CASCADE;
-- Also truncate user preferences — the old types are meaningless in new system
TRUNCATE TABLE "UserNotificationPreference" CASCADE;

-- ============================================================================
-- STEP 15: Create notification configuration tables
-- ============================================================================

CREATE TABLE "NotificationConfiguration" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT,
    "notificationType" "NotificationType" NOT NULL,
    "eventType" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "importance" "NotificationImportance" NOT NULL DEFAULT 'NORMAL',
    "workHoursOnly" BOOLEAN NOT NULL DEFAULT false,
    "batchingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxFrequencyPerDay" INTEGER,
    "deduplicationWindow" INTEGER,
    "templates" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationConfiguration_key_key" ON "NotificationConfiguration"("key");
CREATE INDEX "NotificationConfiguration_notificationType_idx" ON "NotificationConfiguration"("notificationType");
CREATE INDEX "NotificationConfiguration_eventType_idx" ON "NotificationConfiguration"("eventType");
CREATE INDEX "NotificationConfiguration_enabled_idx" ON "NotificationConfiguration"("enabled");
CREATE INDEX "NotificationConfiguration_notificationType_eventType_idx" ON "NotificationConfiguration"("notificationType", "eventType");
CREATE INDEX "NotificationConfiguration_importance_idx" ON "NotificationConfiguration"("importance");

-- ---

CREATE TABLE "NotificationChannelConfig" (
    "id" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "defaultOn" BOOLEAN NOT NULL DEFAULT true,
    "minImportance" "NotificationImportance",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationChannelConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationChannelConfig_configurationId_channel_key"
    ON "NotificationChannelConfig"("configurationId", "channel");
CREATE INDEX "NotificationChannelConfig_configurationId_idx" ON "NotificationChannelConfig"("configurationId");
CREATE INDEX "NotificationChannelConfig_channel_idx" ON "NotificationChannelConfig"("channel");
CREATE INDEX "NotificationChannelConfig_enabled_idx" ON "NotificationChannelConfig"("enabled");

ALTER TABLE "NotificationChannelConfig" ADD CONSTRAINT "NotificationChannelConfig_configurationId_fkey"
    FOREIGN KEY ("configurationId") REFERENCES "NotificationConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---

CREATE TABLE "NotificationSectorOverride" (
    "id" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "sector" "SectorPrivileges" NOT NULL,
    "channelOverrides" JSONB,
    "importanceOverride" "NotificationImportance",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationSectorOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationSectorOverride_configurationId_sector_key"
    ON "NotificationSectorOverride"("configurationId", "sector");
CREATE INDEX "NotificationSectorOverride_configurationId_idx" ON "NotificationSectorOverride"("configurationId");
CREATE INDEX "NotificationSectorOverride_sector_idx" ON "NotificationSectorOverride"("sector");

ALTER TABLE "NotificationSectorOverride" ADD CONSTRAINT "NotificationSectorOverride_configurationId_fkey"
    FOREIGN KEY ("configurationId") REFERENCES "NotificationConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---

CREATE TABLE "NotificationTargetRule" (
    "id" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "allowedSectors" "SectorPrivileges"[],
    "excludeInactive" BOOLEAN NOT NULL DEFAULT true,
    "excludeOnVacation" BOOLEAN NOT NULL DEFAULT true,
    "customFilter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationTargetRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationTargetRule_configurationId_key" ON "NotificationTargetRule"("configurationId");
CREATE INDEX "NotificationTargetRule_configurationId_idx" ON "NotificationTargetRule"("configurationId");

ALTER TABLE "NotificationTargetRule" ADD CONSTRAINT "NotificationTargetRule_configurationId_fkey"
    FOREIGN KEY ("configurationId") REFERENCES "NotificationConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---

CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "ruleConfig" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationRule_configurationId_idx" ON "NotificationRule"("configurationId");
CREATE INDEX "NotificationRule_ruleType_idx" ON "NotificationRule"("ruleType");
CREATE INDEX "NotificationRule_priority_idx" ON "NotificationRule"("priority");
CREATE INDEX "NotificationRule_configurationId_priority_idx" ON "NotificationRule"("configurationId", "priority");

ALTER TABLE "NotificationRule" ADD CONSTRAINT "NotificationRule_configurationId_fkey"
    FOREIGN KEY ("configurationId") REFERENCES "NotificationConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- STEP 16: Add OrderSchedule.name and description columns (if missing)
-- ============================================================================

ALTER TABLE "OrderSchedule" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "OrderSchedule" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- ============================================================================
-- STEP 17: Remove dead PPE delivery fields
-- (Migration: 20260215120000_remove_dead_ppe_fields)
-- ============================================================================

DROP INDEX IF EXISTS "PpeDelivery_signatureBatchId_idx";
ALTER TABLE "PpeDelivery" DROP COLUMN IF EXISTS "signatureBatchId";
ALTER TABLE "PpeDelivery" DROP COLUMN IF EXISTS "clicksignRequestKey";

-- ============================================================================
-- STEP 18: Update _prisma_migrations table
-- ============================================================================
-- Remove old migration entries that no longer exist in the migrations folder.
-- The current codebase has a squashed 0_init that encompasses all old migrations,
-- plus 9 new migrations.

DELETE FROM "_prisma_migrations"
WHERE migration_name NOT IN ('0_init');

-- Insert records for the 9 new migrations
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
VALUES
    (gen_random_uuid()::varchar(36), 'consolidated_backup_migration', NOW(), '20260207230134_remove_negotiating_with', NULL, NOW(), 1),
    (gen_random_uuid()::varchar(36), 'consolidated_backup_migration', NOW(), '20260210121010_add_customer_state_registration', NULL, NOW(), 1),
    (gen_random_uuid()::varchar(36), 'consolidated_backup_migration', NOW(), '20260210224027_remove_representative_role_uniqueness', NULL, NOW(), 1),
    (gen_random_uuid()::varchar(36), 'consolidated_backup_migration', NOW(), '20260211000000_remove_task_invoice_to_add_pricing_fields', NULL, NOW(), 1),
    (gen_random_uuid()::varchar(36), 'consolidated_backup_migration', NOW(), '20260211150000_remove_admissional_field', NULL, NOW(), 1),
    (gen_random_uuid()::varchar(36), 'consolidated_backup_migration', NOW(), '20260211174227_add_task_pricing_changelog_entity_type', NULL, NOW(), 1),
    (gen_random_uuid()::varchar(36), 'consolidated_backup_migration', NOW(), '20260211185849_add_inventory_analytics', NULL, NOW(), 1),
    (gen_random_uuid()::varchar(36), 'consolidated_backup_migration', NOW(), '20260213131750_add_task_bank_slips', NULL, NOW(), 1),
    (gen_random_uuid()::varchar(36), 'consolidated_backup_migration', NOW(), '20260215120000_remove_dead_ppe_fields', NULL, NOW(), 1);

COMMIT;
