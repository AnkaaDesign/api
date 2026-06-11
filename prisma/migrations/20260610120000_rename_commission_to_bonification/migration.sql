-- Rename the legacy "commission" concept to "bonification" everywhere:
-- enum type + values, ChangeLogEntityType value, Task columns + index,
-- and all stored data (audit logs, notifications, configs, preferences).

-- ============================================================
-- 1. Schema renames (types, values, columns, index)
-- ============================================================

ALTER TYPE "CommissionStatus" RENAME TO "BonificationStatus";

ALTER TYPE "BonificationStatus" RENAME VALUE 'FULL_COMMISSION' TO 'FULL_BONIFICATION';
ALTER TYPE "BonificationStatus" RENAME VALUE 'PARTIAL_COMMISSION' TO 'PARTIAL_BONIFICATION';
ALTER TYPE "BonificationStatus" RENAME VALUE 'NO_COMMISSION' TO 'NO_BONIFICATION';
ALTER TYPE "BonificationStatus" RENAME VALUE 'SUSPENDED_COMMISSION' TO 'SUSPENDED_BONIFICATION';

ALTER TYPE "ChangeLogEntityType" RENAME VALUE 'COMMISSION' TO 'BONIFICATION';

ALTER TABLE "Task" RENAME COLUMN "commission" TO "bonification";
ALTER TABLE "Task" RENAME COLUMN "commissionOrder" TO "bonificationOrder";

ALTER INDEX "Task_commissionOrder_idx" RENAME TO "Task_bonificationOrder_idx";

-- ============================================================
-- 2. Stored-data migration
-- ============================================================
-- Helper that applies the canonical commission -> bonification map to text
-- (EN identifier tokens, enum values, and PT wording with/without accents).
CREATE OR REPLACE FUNCTION _mig_commission_to_bonification(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
SELECT replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    t,
    'isCommissioned', 'isBonified'),        -- mobile task-table widget tri-state filter key (code uses isBonified)
    'COMMISSION', 'BONIFICATION'),          -- FULL_/PARTIAL_/NO_/SUSPENDED_COMMISSION + bare COMMISSION
    'Commission', 'Bonification'),          -- e.g. formatCommissionStatus -> formatBonificationStatus
    'commission', 'bonification'),          -- commission, commissions, commissionOrder
    'COMISSÕES',  'BONIFICAÇÕES'),
    'Comissões',  'Bonificações'),
    'comissões',  'bonificações'),
    'COMISSÃO',   'BONIFICAÇÃO'),
    'Comissão',   'Bonificação'),
    'comissão',   'bonificação'),
    'COMISSOES',  'BONIFICACOES'),          -- accentless variants (slugs, old notification texts)
    'Comissoes',  'Bonificacoes'),
    'comissoes',  'bonificacoes'),
    'COMISSAO',   'BONIFICACAO'),
    'Comissao',   'Bonificacao'),
    'comissao',   'bonificacao');
$$;

-- ---- ChangeLog (audit trail): field, reason, oldValue/newValue/metadata JSON ----
UPDATE "ChangeLog"
SET "field" = _mig_commission_to_bonification("field")
WHERE "field" ~* 'commiss|comiss';

UPDATE "ChangeLog"
SET "reason" = _mig_commission_to_bonification("reason")
WHERE "reason" ~* 'commiss|comiss';

UPDATE "ChangeLog"
SET "oldValue" = _mig_commission_to_bonification("oldValue"::text)::jsonb
WHERE "oldValue"::text ~* 'commiss|comiss';

UPDATE "ChangeLog"
SET "newValue" = _mig_commission_to_bonification("newValue"::text)::jsonb
WHERE "newValue"::text ~* 'commiss|comiss';

UPDATE "ChangeLog"
SET "metadata" = _mig_commission_to_bonification("metadata"::text)::jsonb
WHERE "metadata"::text ~* 'commiss|comiss';

-- ---- TaskFieldChangeLog: field + enum-value old/new JSON ----
UPDATE "TaskFieldChangeLog"
SET "field" = _mig_commission_to_bonification("field")
WHERE "field" ~* 'commiss|comiss';

UPDATE "TaskFieldChangeLog"
SET "oldValue" = _mig_commission_to_bonification("oldValue"::text)::jsonb
WHERE "oldValue"::text ~* 'commiss|comiss';

UPDATE "TaskFieldChangeLog"
SET "newValue" = _mig_commission_to_bonification("newValue"::text)::jsonb
WHERE "newValue"::text ~* 'commiss|comiss';

-- ---- Notification rows: system-generated PT titles/bodies + metadata keys/values ----
UPDATE "Notification"
SET "title" = _mig_commission_to_bonification("title")
WHERE "title" ~* 'commiss|comiss';

UPDATE "Notification"
SET "body" = _mig_commission_to_bonification("body")
WHERE "body" ~* 'commiss|comiss';

UPDATE "Notification"
SET "metadata" = _mig_commission_to_bonification("metadata"::text)::jsonb
WHERE "metadata"::text ~* 'commiss|comiss';

-- ---- NotificationConfiguration: key/eventType + PT texts + templates/metadata JSON ----
UPDATE "NotificationConfiguration"
SET "key"         = _mig_commission_to_bonification("key"),
    "eventType"   = _mig_commission_to_bonification("eventType"),
    "name"        = _mig_commission_to_bonification("name"),
    "description" = _mig_commission_to_bonification("description"),
    "templates"   = _mig_commission_to_bonification("templates"::text)::jsonb,
    "metadata"    = _mig_commission_to_bonification("metadata"::text)::jsonb
WHERE "key" ~* 'commiss|comiss'
   OR "eventType" ~* 'commiss|comiss'
   OR "name" ~* 'commiss|comiss'
   OR "description" ~* 'commiss|comiss'
   OR "templates"::text ~* 'commiss|comiss'
   OR "metadata"::text ~* 'commiss|comiss';

-- ---- UserNotificationPreference: event keys (e.g. task_commission) ----
UPDATE "UserNotificationPreference"
SET "eventType" = _mig_commission_to_bonification("eventType")
WHERE "eventType" ~* 'commiss|comiss';

-- ---- Preferences: dashboard/widget layout JSON (task filter keys like "commissions", "isCommissioned") ----
UPDATE "Preferences"
SET "dashboardLayoutWeb" = _mig_commission_to_bonification("dashboardLayoutWeb"::text)::jsonb
WHERE "dashboardLayoutWeb"::text ~* 'commiss|comiss';

UPDATE "Preferences"
SET "dashboardLayoutMobile" = _mig_commission_to_bonification("dashboardLayoutMobile"::text)::jsonb
WHERE "dashboardLayoutMobile"::text ~* 'commiss|comiss';

-- ---- Preferences.favorites: DELETE dead favorite entries pointing at removed pages
--      ("/administracao/comissoes", "/pessoal/minhas-comissoes" and any other comissao path/key) ----
UPDATE "Preferences"
SET "favorites" = COALESCE(
  (SELECT array_agg(f) FROM unnest("favorites") AS f WHERE f !~* 'commiss|comiss'),
  '{}'
)
WHERE "favorites"::text ~* 'commiss|comiss';

-- ---- Message: system update-notes JSON mentioning "comissões" ----
UPDATE "Message"
SET "content" = _mig_commission_to_bonification("content"::text)::jsonb
WHERE "content"::text ~* 'commiss|comiss';

DROP FUNCTION _mig_commission_to_bonification(text);

-- Intentionally NOT migrated (user/external free text, audited 2026-06-10):
--   Observation.description: one row of user-written prose ("COMISSÃO RETIRADA POR TER FEITO...")
--   FiscalDocumentItem.description: one row of external fiscal (NF) item text ("COMISSOES")
