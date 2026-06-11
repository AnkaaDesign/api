-- =============================================================================
-- PHASE A3 — Disambiguate the two identical-name Faixa Refletiva pairs.
-- Data correction 2026-06-10. Idempotent: guarded WHERE clauses; re-running is a no-op.
-- All changes are logged to correction_log_20260609 (old values preserved).
--
-- Findings (backup 2026-06-09):
--   * Two items both named 'Faixa Refletiva' (created 1 min apart 2026-03-03),
--     each with its own OrderItem of 100 on order "Faixas Refletivas Avery" and
--     its own 100-unit inbound — internally consistent, NOT duplicates. The
--     company's naming pattern for reflective strips is a Direita/Esquerda pair
--     (cf. Faixa Refletiva Lateral Direita/Esquerda), so these are renamed as a
--     side pair. SIDE ASSIGNMENT IS PROVISIONAL (earliest-created = Direita,
--     matching the Lateral pair ordering) — verify at the scheduled recount and
--     swap the two names if reality disagrees.
--   * Two items both named 'Faixa Refletiva 3M' (created 6 min apart 2026-04-02,
--     qty 20/40, identical 5x30cm measures, no activity) — same treatment.
-- Quantities, orders and activities are NOT touched.
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a3-faixa-dedup.sql
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

CREATE TEMP TABLE _faixa_renames (item_id text, expected_name text, new_name text);
INSERT INTO _faixa_renames VALUES
  ('a886532b-ce81-42ad-b51e-174743be96a7', 'Faixa Refletiva',    'Faixa Refletiva Direita'),
  ('20676d7b-34f2-42b9-adf4-970aef27df68', 'Faixa Refletiva',    'Faixa Refletiva Esquerda'),
  ('9673ce33-d136-4439-91d0-40b9c22d42e2', 'Faixa Refletiva 3M', 'Faixa Refletiva 3M Direita'),
  ('85e03ba8-baba-4cf1-a0c6-0c2a5562a159', 'Faixa Refletiva 3M', 'Faixa Refletiva 3M Esquerda');

-- unknown id, already-renamed, or unexpectedly-renamed-by-someone-else rows are
-- logged as skipped (once) instead of failing
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A3','A13-skipped','Item', r.item_id,
       (SELECT jsonb_build_object('name', i.name) FROM "Item" i WHERE i.id::text = r.item_id),
       jsonb_build_object('expectedName', r.expected_name, 'intendedName', r.new_name)
FROM _faixa_renames r
WHERE NOT EXISTS (SELECT 1 FROM "Item" i
                  WHERE i.id::text = r.item_id AND i.name = r.expected_name)
  AND NOT EXISTS (SELECT 1 FROM "Item" i2
                  WHERE i2.id::text = r.item_id AND i2.name = r.new_name)  -- already done = silent no-op
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'A13-skipped' AND l.entity_id = r.item_id);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A3','A13-faixa-dedup-rename','Item', i.id,
       jsonb_build_object('name', i.name),
       jsonb_build_object('name', r.new_name)
FROM "Item" i JOIN _faixa_renames r ON i.id::text = r.item_id
WHERE i.name = r.expected_name;

UPDATE "Item" i SET name = r.new_name, "updatedAt" = now()
FROM _faixa_renames r
WHERE i.id::text = r.item_id AND i.name = r.expected_name;

-- summary
SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A3' GROUP BY step;

COMMIT;
