-- =============================================================================
-- PHASE A8 — Workflow-based chemical placement + Aditivos leaf + parent rename.
-- Data correction 2026-06-10. Idempotent: guarded WHERE clauses; re-running is
-- a no-op. All changes logged to correction_log_20260609. Run AFTER phase-a7.
--
-- Owner rule: chemicals are categorized by USAGE STAGE, not material family.
-- Removedor and Desengraxante are surface-prep products -> Reparo e Preparação
-- (the merged-taxonomy routed "removers" with solvents; owner overrides).
-- Paint ADDITIVES (flexibilizantes, anticratera, acelerador) get the design's
-- missing "Auxiliares" leaf, created as "Aditivos e Auxiliares" under the
-- Tintas group. The structural parent "Produção e Preparação" is renamed
-- "Funilaria e Produção" — it collided confusingly with its own child
-- "Reparo e Preparação".
--
-- AFTER THIS PHASE re-run the ITEM_DERIVED mirror sync (new leaf + rename).
--
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a8-prep-chemicals.sql
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

-- ---------------------------------------------------------------------------
-- A26. Create the "Aditivos e Auxiliares" leaf under the Tintas group.
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A8','A26-create-subcategory','ItemCategory', 'Aditivos e Auxiliares', NULL,
       jsonb_build_object('parent', 'Tintas, Vernizes e Auxiliares Químicos',
                          'categoryLevel', 2, 'accountingType', 'MATERIA_PRIMA')
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = 'Aditivos e Auxiliares');

INSERT INTO "ItemCategory" (id, name, type, "categoryLevel", "parentId", "accountingType", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Aditivos e Auxiliares', 'REGULAR'::"ItemCategoryType", 2,
       (SELECT id FROM "ItemCategory" WHERE name = 'Tintas, Vernizes e Auxiliares Químicos'),
       'MATERIA_PRIMA'::"AccountingType", now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = 'Aditivos e Auxiliares')
  AND EXISTS (SELECT 1 FROM "ItemCategory" p WHERE p.name = 'Tintas, Vernizes e Auxiliares Químicos');

-- ---------------------------------------------------------------------------
-- A27. Workflow moves (matched by name while still in the source category;
--      already-moved rows are no-ops; unknown names logged as skipped once).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _a27_moves (item_name text, source text, target text);
INSERT INTO _a27_moves VALUES
  -- surface-prep chemicals -> Reparo e Preparação (owner rule)
  ('Removedor',              'Diluente',    'Reparo e Preparação'),
  ('Desengraxante',          'Diluente',    'Reparo e Preparação'),
  -- paint additives -> Aditivos e Auxiliares (covers both Flexibilizante rows)
  ('Flexibilizante',         'Tinta',       'Aditivos e Auxiliares'),
  ('Aditivo Anticratera',    'Tinta',       'Aditivos e Auxiliares'),
  ('Solução Flexibilizante', 'Diluente',    'Aditivos e Auxiliares'),
  ('Acelerador de Secagem',  'Endurecedor', 'Aditivos e Auxiliares');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A8','A27-skipped-unknown-item','Item', m.item_name, NULL,
       jsonb_build_object('source', m.source, 'target', m.target)
FROM _a27_moves m
WHERE NOT EXISTS (
        SELECT 1 FROM "Item" i
        JOIN "ItemCategory" c ON c.id = i."categoryId"
        WHERE i.name = m.item_name
          AND c.name IN (m.source, m.target))
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'A27-skipped-unknown-item' AND l.entity_id = m.item_name);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A8','A27-move','Item', i.id,
       jsonb_build_object('categoryId', i."categoryId", 'categoryName', c.name),
       jsonb_build_object('categoryName', m.target)
FROM "Item" i
JOIN "ItemCategory" c  ON c.id = i."categoryId"
JOIN _a27_moves m      ON m.item_name = i.name AND m.source = c.name
JOIN "ItemCategory" tc ON tc.name = m.target;

UPDATE "Item" i
SET "categoryId" = tc.id, "updatedAt" = now()
FROM "ItemCategory" c, _a27_moves m, "ItemCategory" tc
WHERE c.id = i."categoryId" AND c.name = m.source
  AND m.item_name = i.name AND tc.name = m.target;

-- ---------------------------------------------------------------------------
-- A28. Rename the structural parent (guarded; refuses on name collision).
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A8','A28-rename-parent','ItemCategory', c.id,
       jsonb_build_object('name', c.name), jsonb_build_object('name', 'Funilaria e Produção')
FROM "ItemCategory" c
WHERE c.name = 'Produção e Preparação'
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" x WHERE x.name = 'Funilaria e Produção');

UPDATE "ItemCategory" c
SET name = 'Funilaria e Produção', "updatedAt" = now()
WHERE c.name = 'Produção e Preparação'
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" x WHERE x.name = 'Funilaria e Produção');

-- summary
SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A8' GROUP BY step ORDER BY step;

COMMIT;
