-- =============================================================================
-- Migration: Notification configuration cleanup and additions
-- Date: 2026-04-07
-- Description:
--   1. RENAME task_pricing.payment_due → task_quote.payment_due (code mismatch)
--   2. RENAME task.field.representatives → task.field.responsibles (code mismatch)
--   3. DELETE task.waiting_production (orphaned - code uses task.ready_for_production)
--   4. DELETE task.field.invoiceToId (not in TRACKED_FIELDS, never dispatched)
--   5. DELETE 7x service_order.*.financial (FINANCIAL not in SERVICE_ORDER_TYPE enum)
--   6. CREATE task.cancelled notification config (CANCELLED status needs dedicated config)
--   7. CREATE bank_slip.due notification config (new feature: due date reminders)
--   8. CREATE 3x service_order.waiting_approval.{production,commercial,logistic} (missing)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. RENAME: task_pricing.payment_due → task_quote.payment_due
--    Code dispatches 'task_quote.payment_due' (task-quote-payment.scheduler.ts:114)
--    but DB had the legacy name 'task_pricing.payment_due'. This was silently broken.
-- ---------------------------------------------------------------------------
UPDATE "NotificationConfiguration"
SET key = 'task_quote.payment_due',
    "eventType" = 'task_quote.payment_due',
    "updatedAt" = NOW()
WHERE key = 'task_pricing.payment_due';

-- ---------------------------------------------------------------------------
-- 2. RENAME: task.field.representatives → task.field.responsibles
--    TRACKED_FIELDS uses 'responsibles' (task-field-tracker.service.ts:56)
-- ---------------------------------------------------------------------------
UPDATE "NotificationConfiguration"
SET key = 'task.field.responsibles',
    "eventType" = 'task.field.responsibles',
    "updatedAt" = NOW()
WHERE key = 'task.field.representatives';

-- ---------------------------------------------------------------------------
-- 3. DELETE: task.waiting_production
--    Code uses task.ready_for_production via notifyProductionUsersTaskReady()
-- ---------------------------------------------------------------------------
DELETE FROM "NotificationChannelConfig"
WHERE "configurationId" IN (
  SELECT id FROM "NotificationConfiguration" WHERE key = 'task.waiting_production'
);
DELETE FROM "NotificationTargetRule"
WHERE "configurationId" IN (
  SELECT id FROM "NotificationConfiguration" WHERE key = 'task.waiting_production'
);
DELETE FROM "NotificationSectorOverride"
WHERE "configurationId" IN (
  SELECT id FROM "NotificationConfiguration" WHERE key = 'task.waiting_production'
);
DELETE FROM "NotificationConfiguration"
WHERE key = 'task.waiting_production';

-- ---------------------------------------------------------------------------
-- 4. DELETE: task.field.invoiceToId
--    Not in TRACKED_FIELDS, no event emitted for this field
-- ---------------------------------------------------------------------------
DELETE FROM "NotificationChannelConfig"
WHERE "configurationId" IN (
  SELECT id FROM "NotificationConfiguration" WHERE key = 'task.field.invoiceToId'
);
DELETE FROM "NotificationTargetRule"
WHERE "configurationId" IN (
  SELECT id FROM "NotificationConfiguration" WHERE key = 'task.field.invoiceToId'
);
DELETE FROM "NotificationSectorOverride"
WHERE "configurationId" IN (
  SELECT id FROM "NotificationConfiguration" WHERE key = 'task.field.invoiceToId'
);
DELETE FROM "NotificationConfiguration"
WHERE key = 'task.field.invoiceToId';

-- ---------------------------------------------------------------------------
-- 5. DELETE: 7x service_order.*.financial
--    SERVICE_ORDER_TYPE enum has no FINANCIAL value
-- ---------------------------------------------------------------------------
DELETE FROM "NotificationChannelConfig"
WHERE "configurationId" IN (
  SELECT id FROM "NotificationConfiguration" WHERE key LIKE 'service_order.%.financial'
);
DELETE FROM "NotificationTargetRule"
WHERE "configurationId" IN (
  SELECT id FROM "NotificationConfiguration" WHERE key LIKE 'service_order.%.financial'
);
DELETE FROM "NotificationSectorOverride"
WHERE "configurationId" IN (
  SELECT id FROM "NotificationConfiguration" WHERE key LIKE 'service_order.%.financial'
);
DELETE FROM "NotificationConfiguration"
WHERE key LIKE 'service_order.%.financial';

-- ---------------------------------------------------------------------------
-- 6. CREATE: task.cancelled notification config
--    CANCELLED status was falling through to generic task.field.status with raw enum
-- ---------------------------------------------------------------------------
INSERT INTO "NotificationConfiguration" (
  id, key, name, "notificationType", "eventType", description,
  enabled, importance, "workHoursOnly", "batchingEnabled", templates,
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'task.cancelled',
  'Tarefa Cancelada',
  'SYSTEM',
  'task.cancelled',
  'Notificacao enviada quando uma tarefa e cancelada',
  true,
  'HIGH',
  false,
  false,
  '{
    "push": {
      "title": "Tarefa Cancelada",
      "body": "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} foi cancelada por {{changedBy}}"
    },
    "inApp": {
      "title": "Tarefa Cancelada",
      "body": "A tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} foi cancelada por {{changedBy}}."
    },
    "email": {
      "subject": "Tarefa Cancelada - {{taskName}}",
      "body": "A tarefa foi cancelada.\n\nTarefa: {{taskName}}\n{{#if serialNumber}}Numero de Serie: {{serialNumber}}\n{{/if}}Cancelada por: {{changedBy}}"
    }
  }'::jsonb,
  NOW(),
  NOW()
);

-- Target rule for task.cancelled: notify the task's sector
INSERT INTO "NotificationTargetRule" (
  id, "configurationId", "allowedSectors",
  "excludeInactive", "excludeOnVacation", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  (SELECT id FROM "NotificationConfiguration" WHERE key = 'task.cancelled'),
  ARRAY['ADMIN', 'COMMERCIAL', 'FINANCIAL', 'PRODUCTION', 'DESIGNER', 'LOGISTIC']::"SectorPrivileges"[],
  true,
  true,
  NOW(),
  NOW()
);

-- Channel configs for task.cancelled
INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'IN_APP', true, true, true, NOW(), NOW()
FROM "NotificationConfiguration" nc WHERE nc.key = 'task.cancelled';

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'PUSH', true, true, true, NOW(), NOW()
FROM "NotificationConfiguration" nc WHERE nc.key = 'task.cancelled';

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'EMAIL', true, false, false, NOW(), NOW()
FROM "NotificationConfiguration" nc WHERE nc.key = 'task.cancelled';

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'WHATSAPP', false, false, false, NOW(), NOW()
FROM "NotificationConfiguration" nc WHERE nc.key = 'task.cancelled';

-- ---------------------------------------------------------------------------
-- 7. CREATE: bank_slip.due notification config
--    Targets: FINANCIAL, ADMIN, COMMERCIAL (same as bank_slip.paid)
-- ---------------------------------------------------------------------------
INSERT INTO "NotificationConfiguration" (
  id, key, name, "notificationType", "eventType", description,
  enabled, importance, "workHoursOnly", "batchingEnabled", templates,
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'bank_slip.due',
  'Boleto Proximo do Vencimento',
  'SYSTEM',
  'bank_slip.due',
  'Notificacao enviada quando um boleto esta proximo da data de vencimento (ate 3 dias)',
  true,
  'HIGH',
  false,
  false,
  '{
    "push": {
      "title": "Boleto Vencendo",
      "body": "{{customerName}} - {{amount}} vence {{daysRemaining}} (NS {{nossoNumero}})"
    },
    "inApp": {
      "title": "Boleto Proximo do Vencimento",
      "body": "O boleto da tarefa \"{{taskName}}\"{{#if serialNumber}} #{{serialNumber}}{{/if}} do cliente {{customerName}} vence {{daysRemaining}}. Valor: {{amount}} (Nosso Numero: {{nossoNumero}}). Vencimento: {{dueDate}}."
    },
    "email": {
      "subject": "Boleto Vencendo - {{customerName}}",
      "body": "Um boleto esta proximo do vencimento.\n\nCliente: {{customerName}}\nTarefa: {{taskName}}\n{{#if serialNumber}}Identificador: {{serialNumber}}\n{{/if}}Valor: {{amount}}\nNosso Numero: {{nossoNumero}}\nVencimento: {{dueDate}}\nPrazo: {{daysRemaining}}"
    },
    "whatsapp": {
      "body": "Boleto vencendo {{daysRemaining}}: {{customerName}} - {{amount}} (NS {{nossoNumero}}). Tarefa: {{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}}. Vencimento: {{dueDate}}."
    }
  }'::jsonb,
  NOW(),
  NOW()
);

-- Target rule for bank_slip.due: FINANCIAL, ADMIN, COMMERCIAL
INSERT INTO "NotificationTargetRule" (
  id, "configurationId", "allowedSectors",
  "excludeInactive", "excludeOnVacation", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  (SELECT id FROM "NotificationConfiguration" WHERE key = 'bank_slip.due'),
  ARRAY['FINANCIAL', 'ADMIN', 'COMMERCIAL']::"SectorPrivileges"[],
  true,
  true,
  NOW(),
  NOW()
);

-- Channel configs for bank_slip.due
INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'IN_APP', true, true, true, NOW(), NOW()
FROM "NotificationConfiguration" nc WHERE nc.key = 'bank_slip.due';

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'PUSH', true, true, true, NOW(), NOW()
FROM "NotificationConfiguration" nc WHERE nc.key = 'bank_slip.due';

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'EMAIL', true, false, false, NOW(), NOW()
FROM "NotificationConfiguration" nc WHERE nc.key = 'bank_slip.due';

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, 'WHATSAPP', false, false, false, NOW(), NOW()
FROM "NotificationConfiguration" nc WHERE nc.key = 'bank_slip.due';

-- ---------------------------------------------------------------------------
-- 8. CREATE: Missing service_order.waiting_approval configs
--    Only artwork existed; production, commercial, logistic were missing.
--    Copy structure from the artwork config.
-- ---------------------------------------------------------------------------

-- 8a. service_order.waiting_approval.production
INSERT INTO "NotificationConfiguration" (
  id, key, name, "notificationType", "eventType", description,
  enabled, importance, "workHoursOnly", "batchingEnabled", templates,
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  'service_order.waiting_approval.production',
  'OS Producao - Aguardando Aprovacao',
  'PRODUCTION',
  'service_order.waiting_approval.production',
  'Notificacao quando uma OS de producao entra em aguardando aprovacao',
  true, 'HIGH', false, false,
  replace(replace(templates::text, 'Arte', 'Producao'), 'arte', 'producao')::jsonb,
  NOW(), NOW()
FROM "NotificationConfiguration"
WHERE key = 'service_order.waiting_approval.artwork'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationConfiguration"
    WHERE key = 'service_order.waiting_approval.production'
  );

INSERT INTO "NotificationTargetRule" (
  id, "configurationId", "allowedSectors",
  "excludeInactive", "excludeOnVacation", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  nc.id,
  ARRAY['ADMIN', 'PRODUCTION']::"SectorPrivileges"[],
  true, true, NOW(), NOW()
FROM "NotificationConfiguration" nc
WHERE nc.key = 'service_order.waiting_approval.production'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationTargetRule" ntr WHERE ntr."configurationId" = nc.id
  );

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, unnest(ARRAY['IN_APP', 'PUSH', 'EMAIL', 'WHATSAPP']::"NotificationChannel"[]),
  unnest(ARRAY[true, true, true, false]),
  unnest(ARRAY[true, true, false, false]),
  unnest(ARRAY[true, true, false, false]),
  NOW(), NOW()
FROM "NotificationConfiguration" nc
WHERE nc.key = 'service_order.waiting_approval.production'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationChannelConfig" ncc WHERE ncc."configurationId" = nc.id
  );

-- 8b. service_order.waiting_approval.commercial
INSERT INTO "NotificationConfiguration" (
  id, key, name, "notificationType", "eventType", description,
  enabled, importance, "workHoursOnly", "batchingEnabled", templates,
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  'service_order.waiting_approval.commercial',
  'OS Comercial - Aguardando Aprovacao',
  'PRODUCTION',
  'service_order.waiting_approval.commercial',
  'Notificacao quando uma OS comercial entra em aguardando aprovacao',
  true, 'HIGH', false, false,
  replace(replace(templates::text, 'Arte', 'Comercial'), 'arte', 'comercial')::jsonb,
  NOW(), NOW()
FROM "NotificationConfiguration"
WHERE key = 'service_order.waiting_approval.artwork'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationConfiguration"
    WHERE key = 'service_order.waiting_approval.commercial'
  );

INSERT INTO "NotificationTargetRule" (
  id, "configurationId", "allowedSectors",
  "excludeInactive", "excludeOnVacation", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  nc.id,
  ARRAY['ADMIN', 'COMMERCIAL']::"SectorPrivileges"[],
  true, true, NOW(), NOW()
FROM "NotificationConfiguration" nc
WHERE nc.key = 'service_order.waiting_approval.commercial'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationTargetRule" ntr WHERE ntr."configurationId" = nc.id
  );

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, unnest(ARRAY['IN_APP', 'PUSH', 'EMAIL', 'WHATSAPP']::"NotificationChannel"[]),
  unnest(ARRAY[true, true, true, false]),
  unnest(ARRAY[true, true, false, false]),
  unnest(ARRAY[true, true, false, false]),
  NOW(), NOW()
FROM "NotificationConfiguration" nc
WHERE nc.key = 'service_order.waiting_approval.commercial'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationChannelConfig" ncc WHERE ncc."configurationId" = nc.id
  );

-- 8c. service_order.waiting_approval.logistic
INSERT INTO "NotificationConfiguration" (
  id, key, name, "notificationType", "eventType", description,
  enabled, importance, "workHoursOnly", "batchingEnabled", templates,
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  'service_order.waiting_approval.logistic',
  'OS Logistica - Aguardando Aprovacao',
  'PRODUCTION',
  'service_order.waiting_approval.logistic',
  'Notificacao quando uma OS logistica entra em aguardando aprovacao',
  true, 'HIGH', false, false,
  replace(replace(templates::text, 'Arte', 'Logistica'), 'arte', 'logistica')::jsonb,
  NOW(), NOW()
FROM "NotificationConfiguration"
WHERE key = 'service_order.waiting_approval.artwork'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationConfiguration"
    WHERE key = 'service_order.waiting_approval.logistic'
  );

INSERT INTO "NotificationTargetRule" (
  id, "configurationId", "allowedSectors",
  "excludeInactive", "excludeOnVacation", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  nc.id,
  ARRAY['ADMIN', 'LOGISTIC']::"SectorPrivileges"[],
  true, true, NOW(), NOW()
FROM "NotificationConfiguration" nc
WHERE nc.key = 'service_order.waiting_approval.logistic'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationTargetRule" ntr WHERE ntr."configurationId" = nc.id
  );

INSERT INTO "NotificationChannelConfig" (id, "configurationId", channel, enabled, mandatory, "defaultOn", "createdAt", "updatedAt")
SELECT gen_random_uuid(), nc.id, unnest(ARRAY['IN_APP', 'PUSH', 'EMAIL', 'WHATSAPP']::"NotificationChannel"[]),
  unnest(ARRAY[true, true, true, false]),
  unnest(ARRAY[true, true, false, false]),
  unnest(ARRAY[true, true, false, false]),
  NOW(), NOW()
FROM "NotificationConfiguration" nc
WHERE nc.key = 'service_order.waiting_approval.logistic'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationChannelConfig" ncc WHERE ncc."configurationId" = nc.id
  );

COMMIT;
