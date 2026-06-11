-- =============================================================================
-- PHASE A5 — Plotagem subcategories + Adesivo roll disambiguation.
-- Data correction 2026-06-10. Idempotent: guarded WHERE clauses; re-running is
-- a no-op. All changes logged to correction_log_20260609. Run AFTER phase-a4.
--
-- Plotagem was a standalone level-1 category holding 15 items directly. The
-- merged-taxonomy design gives it leaves; the live items split cleanly in two:
--   - Vinil e Adesivos: rolls, colored vinyls, tapes, transfer/kraft paper
--   - Ferramentas de Plotagem: espátulas, estilete (application tools)
-- ("Máscaras de transferência" from the design has no live items — not created.)
-- The three rolls all named just "Adesivo" are distinguished only by width
-- (1.52 m / 127 cm / 106 cm, uniCodes 152m/127m/106m) — renamed accordingly.
--
-- AFTER THIS PHASE re-run the ITEM_DERIVED mirror sync (same as phase-a4).
--
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a5-plotagem-tree.sql
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
-- A17. Create the two Plotagem subcategories (level 2, parent = Plotagem).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _plot_children (name text);
INSERT INTO _plot_children VALUES ('Vinil e Adesivos'), ('Ferramentas de Plotagem');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A5','A17-create-subcategory','ItemCategory', pc.name, NULL,
       jsonb_build_object('parent', 'Plotagem', 'categoryLevel', 2, 'accountingType', 'PRODUTIVO')
FROM _plot_children pc
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = pc.name);

INSERT INTO "ItemCategory" (id, name, type, "categoryLevel", "parentId", "accountingType", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, pc.name, 'REGULAR'::"ItemCategoryType", 2,
       (SELECT id FROM "ItemCategory" WHERE name = 'Plotagem'),
       'PRODUTIVO'::"AccountingType", now(), now()
FROM _plot_children pc
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = pc.name)
  AND EXISTS (SELECT 1 FROM "ItemCategory" p WHERE p.name = 'Plotagem');

-- ---------------------------------------------------------------------------
-- A18. Disambiguate the three "Adesivo" rolls by width (guarded by id + name).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _adesivo_renames (item_id text, new_name text);
INSERT INTO _adesivo_renames VALUES
  ('2016e20f-7792-43ac-8648-8f08ea7fe93e', 'Adesivo Vinil 1,52m'),
  ('44079426-f9ed-4d7b-b0d2-4c8d7e611da3', 'Adesivo Vinil 1,27m'),
  ('d3c7d5ed-f824-4089-b195-8baa58a3195b', 'Adesivo Vinil 1,06m');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A5','A18-skipped','Item', r.item_id,
       (SELECT jsonb_build_object('name', i.name) FROM "Item" i WHERE i.id::text = r.item_id),
       jsonb_build_object('intendedName', r.new_name)
FROM _adesivo_renames r
WHERE NOT EXISTS (SELECT 1 FROM "Item" i WHERE i.id::text = r.item_id AND i.name = 'Adesivo')
  AND NOT EXISTS (SELECT 1 FROM "Item" i2 WHERE i2.id::text = r.item_id AND i2.name = r.new_name)
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'A18-skipped' AND l.entity_id = r.item_id);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A5','A18-rename-adesivo','Item', i.id,
       jsonb_build_object('name', i.name), jsonb_build_object('name', r.new_name)
FROM "Item" i JOIN _adesivo_renames r ON i.id::text = r.item_id
WHERE i.name = 'Adesivo';

UPDATE "Item" i SET name = r.new_name, "updatedAt" = now()
FROM _adesivo_renames r
WHERE i.id::text = r.item_id AND i.name = 'Adesivo';

-- ---------------------------------------------------------------------------
-- A19. Move the Plotagem items into their subcategory (matched by name while
--      still sitting in Plotagem; already-moved rows are no-ops; unknown names
--      logged as skipped once).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _plot_moves (item_name text, target text);
INSERT INTO _plot_moves VALUES
  ('Adesivo Vinil 1,52m',     'Vinil e Adesivos'),
  ('Adesivo Vinil 1,27m',     'Vinil e Adesivos'),
  ('Adesivo Vinil 1,06m',     'Vinil e Adesivos'),
  ('Adesivo Preto Jateado',   'Vinil e Adesivos'),
  ('Adesivo Vinil Black',     'Vinil e Adesivos'),
  ('Adesivo Vinil King Blue', 'Vinil e Adesivos'),
  ('Adesivo Vinil Light Red', 'Vinil e Adesivos'),
  ('Adesivo Vinil White',     'Vinil e Adesivos'),
  ('Adesivo Vinil Yellow',    'Vinil e Adesivos'),
  ('Fita Dupla Face',         'Vinil e Adesivos'),
  ('Fita Filete Pvc',         'Vinil e Adesivos'),
  ('Papel Kraft',             'Vinil e Adesivos'),
  ('Espatula Feltro',         'Ferramentas de Plotagem'),
  ('Espatula Rigida Adesivo', 'Ferramentas de Plotagem'),
  ('Estilete Snap Off',       'Ferramentas de Plotagem');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A5','A19-skipped-unknown-item','Item', m.item_name, NULL,
       jsonb_build_object('target', m.target)
FROM _plot_moves m
WHERE NOT EXISTS (
        SELECT 1 FROM "Item" i
        JOIN "ItemCategory" c ON c.id = i."categoryId"
        WHERE i.name = m.item_name
          AND c.name IN ('Plotagem', m.target))
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'A19-skipped-unknown-item' AND l.entity_id = m.item_name);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A5','A19-move','Item', i.id,
       jsonb_build_object('categoryId', i."categoryId"),
       jsonb_build_object('categoryName', m.target)
FROM "Item" i
JOIN "ItemCategory" c  ON c.id = i."categoryId" AND c.name = 'Plotagem'
JOIN _plot_moves m     ON m.item_name = i.name
JOIN "ItemCategory" tc ON tc.name = m.target;

UPDATE "Item" i
SET "categoryId" = tc.id, "updatedAt" = now()
FROM "ItemCategory" c, _plot_moves m, "ItemCategory" tc
WHERE c.id = i."categoryId" AND c.name = 'Plotagem'
  AND m.item_name = i.name AND tc.name = m.target;

-- summary
SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A5' GROUP BY step ORDER BY step;

COMMIT;
