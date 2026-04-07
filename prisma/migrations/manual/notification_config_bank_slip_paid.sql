-- =============================================================================
-- Migration: Add bank_slip.paid notification configuration
-- Date: 2026-04-07
-- Description:
--   1. Creates the bank_slip.paid NotificationConfiguration for Sicredi webhook
--      boleto payment notifications.
--   2. Creates NotificationTargetRule targeting FINANCIAL, ADMIN, COMMERCIAL sectors.
--   3. Creates NotificationChannelConfig for IN_APP (mandatory), PUSH (mandatory),
--      EMAIL (optional), WHATSAPP (disabled).
--   4. Backfills missing NotificationTargetRule and NotificationChannelConfig for
--      task.field.bankSlips which was inserted without them.
--   5. No configs removed: no unused NFSe/receipt/file-upload notification configs
--      were found in the database.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Insert bank_slip.paid NotificationConfiguration
-- ---------------------------------------------------------------------------
INSERT INTO "NotificationConfiguration" (
  id,
  key,
  name,
  "notificationType",
  "eventType",
  description,
  enabled,
  importance,
  "workHoursOnly",
  "batchingEnabled",
  templates,
  "createdAt",
  "updatedAt"
) VALUES (
  gen_random_uuid(),
  'bank_slip.paid',
  'Boleto Pago',
  'SYSTEM',
  'bank_slip.paid',
  'Notificacao enviada quando um boleto e pago via webhook Sicredi',
  true,
  'HIGH',
  false,
  false,
  '{
    "push": {
      "title": "Boleto Pago",
      "body": "{{customerName}} - {{paidAmount}} (NS {{nossoNumero}})"
    },
    "inApp": {
      "title": "Boleto Pago",
      "body": "O boleto da tarefa \"{{taskName}}\" {{serialNumber}} do cliente {{customerName}} foi pago. Valor: {{paidAmount}} (Nosso Numero: {{nossoNumero}})."
    },
    "email": {
      "subject": "Boleto Pago - {{customerName}}",
      "body": "Um boleto foi pago via banco.\n\nCliente: {{customerName}}\nTarefa: {{taskName}}\nIdentificador: {{serialNumber}}\nValor Pago: {{paidAmount}}\nNosso Numero: {{nossoNumero}}"
    },
    "whatsapp": {
      "body": "Boleto pago: {{customerName}} - {{paidAmount}} (NS {{nossoNumero}}). Tarefa: {{taskName}} {{serialNumber}}."
    }
  }'::jsonb,
  NOW(),
  NOW()
);

-- ---------------------------------------------------------------------------
-- 2. Insert NotificationTargetRule for bank_slip.paid
--    Targets: FINANCIAL, ADMIN, COMMERCIAL
-- ---------------------------------------------------------------------------
INSERT INTO "NotificationTargetRule" (
  id,
  "configurationId",
  "allowedSectors",
  "excludeInactive",
  "excludeOnVacation",
  "createdAt",
  "updatedAt"
) VALUES (
  gen_random_uuid(),
  (SELECT id FROM "NotificationConfiguration" WHERE key = 'bank_slip.paid'),
  ARRAY['FINANCIAL', 'ADMIN', 'COMMERCIAL']::"SectorPrivileges"[],
  true,
  true,
  NOW(),
  NOW()
);

-- ---------------------------------------------------------------------------
-- 3. Insert NotificationChannelConfig for bank_slip.paid
--    IN_APP: mandatory, default on
--    PUSH: mandatory, default on
--    EMAIL: optional, default off
--    WHATSAPP: disabled
-- ---------------------------------------------------------------------------
INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'IN_APP', true, true, true, NOW(), NOW()
FROM "NotificationConfiguration" nc WHERE nc.key = 'bank_slip.paid';

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'PUSH', true, true, true, NOW(), NOW()
FROM "NotificationConfiguration" nc WHERE nc.key = 'bank_slip.paid';

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'EMAIL', true, false, false, NOW(), NOW()
FROM "NotificationConfiguration" nc WHERE nc.key = 'bank_slip.paid';

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'WHATSAPP', false, false, false, NOW(), NOW()
FROM "NotificationConfiguration" nc WHERE nc.key = 'bank_slip.paid';

-- ---------------------------------------------------------------------------
-- 4. Backfill task.field.bankSlips: add missing NotificationTargetRule
--    This config was inserted (2026-02-23) without a target rule or channels.
--    Target: ADMIN, FINANCIAL, COMMERCIAL (same as task.field.receipts)
-- ---------------------------------------------------------------------------
INSERT INTO "NotificationTargetRule" (
  id,
  "configurationId",
  "allowedSectors",
  "excludeInactive",
  "excludeOnVacation",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  nc.id,
  ARRAY['ADMIN', 'FINANCIAL', 'COMMERCIAL']::"SectorPrivileges"[],
  true,
  true,
  NOW(),
  NOW()
FROM "NotificationConfiguration" nc
WHERE nc.key = 'task.field.bankSlips'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationTargetRule" ntr WHERE ntr."configurationId" = nc.id
  );

-- ---------------------------------------------------------------------------
-- 5. Backfill task.field.bankSlips: add missing NotificationChannelConfig
--    Matches the pattern used by task.field.receipts (IN_APP mandatory, PUSH/EMAIL opt)
-- ---------------------------------------------------------------------------
INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'IN_APP', true, true, true, NOW(), NOW()
FROM "NotificationConfiguration" nc
WHERE nc.key = 'task.field.bankSlips'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationChannelConfig" ncc
    WHERE ncc."configurationId" = nc.id AND ncc.channel = 'IN_APP'
  );

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'PUSH', true, false, false, NOW(), NOW()
FROM "NotificationConfiguration" nc
WHERE nc.key = 'task.field.bankSlips'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationChannelConfig" ncc
    WHERE ncc."configurationId" = nc.id AND ncc.channel = 'PUSH'
  );

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'EMAIL', true, false, false, NOW(), NOW()
FROM "NotificationConfiguration" nc
WHERE nc.key = 'task.field.bankSlips'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationChannelConfig" ncc
    WHERE ncc."configurationId" = nc.id AND ncc.channel = 'EMAIL'
  );

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'WHATSAPP', false, false, false, NOW(), NOW()
FROM "NotificationConfiguration" nc
WHERE nc.key = 'task.field.bankSlips'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationChannelConfig" ncc
    WHERE ncc."configurationId" = nc.id AND ncc.channel = 'WHATSAPP'
  );

-- ---------------------------------------------------------------------------
-- NOTE: No notification configs were deleted.
--
-- Checked for NFSe/receipt/file-upload notification configs that might be
-- obsolete since the NFSe integration was disabled. No such configs exist
-- in the database:
--   - No keys matching 'nfse.*' or 'nota_fiscal.*' were found
--   - task.field.invoices, task.field.receipts, task.field.bankSlips are all
--     actively used via the task.field.changed event system
--   - task_pricing.payment_due is actively used for payment reminders
--   - order.payment.assigned and order.payment.fulfilled are actively used
--     in the order listener
-- ---------------------------------------------------------------------------

COMMIT;
