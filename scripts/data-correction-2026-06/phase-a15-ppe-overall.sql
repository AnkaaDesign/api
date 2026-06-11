-- =============================================================================
-- PHASE A15 — Set ppeType = OVERALL on the Macacões de Segurança (Vicsa).
-- REQUIRES prisma migration 20260610234500_ppe_type_overall (adds the enum
-- value) — run it BEFORE this phase. They carried ppeType SHIRT from their
-- Uniformes days; OVERALL drives correct size validation (P..XG letters) and
-- the PPE cadence engine (production-floor headcount 22, 6-month interval).
--
-- Idempotent; logged to correction_log_20260609 (phase 'A15').
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a15-ppe-overall.sql
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE IF NOT EXISTS correction_log_20260609 (
  id bigserial PRIMARY KEY,
  phase text NOT NULL,
  step text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A15','A49-ppetype-overall','Item', i.id,
       jsonb_build_object('name', i.name, 'ppeType', i."ppeType"),
       jsonb_build_object('ppeType', 'OVERALL')
FROM "Item" i
WHERE i.name LIKE 'Macacão de Segurança%' AND i."ppeType"::text IS DISTINCT FROM 'OVERALL';

UPDATE "Item"
SET "ppeType" = 'OVERALL', "updatedAt" = now()
WHERE name LIKE 'Macacão de Segurança%' AND "ppeType"::text IS DISTINCT FROM 'OVERALL';

SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A15' GROUP BY step;
SELECT name, "ppeType" FROM "Item" WHERE name LIKE 'Macacão%' ORDER BY name;

COMMIT;
