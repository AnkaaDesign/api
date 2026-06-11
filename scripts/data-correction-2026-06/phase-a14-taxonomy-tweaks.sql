-- =============================================================================
-- PHASE A14 — Taxonomy tweaks (owner decisions 2026-06-10, after v2 review):
--   1. "Lixas" becomes its own LEVEL-1 category (the sanding media: lixas,
--      palha de aço, scotch brite). The old leaf "Lixas, Fibras e Suportes"
--      row is renamed + promoted (items follow automatically).
--   2. New leaf "Bases e Adaptadores" under Abrasivos e Polimento: Base
--      Hookit, Hookit, Disco de Interface (cushion adapter) and Adaptador
--      Boina (from Polimento) — the pad/backing hardware, not media.
--      Item typo fixed: "Adapitador Boina Polimento" → "Adaptador ...".
--   3. Papel Kraft → Plotagem e Adesivação › Máscaras de Transferência
--      (application/transfer paper — owner: kraft belongs to plotting).
--   4. Macacões de Segurança (Vicsa, M/XG/XXG) are PPE, not uniform →
--      EPI › Proteção Visual, Auditiva e Corporal; the now-empty
--      "Uniforme — Corpo Inteiro" leaf is deleted.
--
-- AFTER: run the ITEM_DERIVED mirror sync.
-- Idempotent; logged to correction_log_20260609 (phase 'A14').
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a14-taxonomy-tweaks.sql
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
-- A45. New leaf "Bases e Adaptadores" under Abrasivos e Polimento.
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A14','A45-create-leaf','ItemCategory', 'Bases e Adaptadores', NULL,
       jsonb_build_object('parent', 'Abrasivos e Polimento', 'accountingType', 'PRODUTIVO', 'type', 'REGULAR')
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" WHERE name = 'Bases e Adaptadores');

INSERT INTO "ItemCategory" (id, name, type, "categoryLevel", "parentId", "accountingType", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Bases e Adaptadores', 'REGULAR', 2, p.id, 'PRODUTIVO', now(), now()
FROM "ItemCategory" p
WHERE p.name = 'Abrasivos e Polimento'
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" WHERE name = 'Bases e Adaptadores');

-- ---------------------------------------------------------------------------
-- A46. Item typo fix + moves.
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A14','A46-rename','Item', i.id,
       jsonb_build_object('name', i.name), jsonb_build_object('name', 'Adaptador Boina Polimento')
FROM "Item" i WHERE i.name = 'Adapitador Boina Polimento';

UPDATE "Item" SET name = 'Adaptador Boina Polimento', "updatedAt" = now()
WHERE name = 'Adapitador Boina Polimento';

CREATE TEMP TABLE _moves (iname text, dest text);
INSERT INTO _moves VALUES
  ('Base Hookit',                'Bases e Adaptadores'),
  ('Hookit',                     'Bases e Adaptadores'),
  ('Disco de Interface',         'Bases e Adaptadores'),
  ('Adaptador Boina Polimento',  'Bases e Adaptadores'),
  ('Papel Kraft',                'Máscaras de Transferência'),
  ('Macacão de Segurança - M',   'Proteção Visual, Auditiva e Corporal'),
  ('Macacão de Segurança - XG',  'Proteção Visual, Auditiva e Corporal'),
  ('Macacão de Segurança - XXG', 'Proteção Visual, Auditiva e Corporal');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A14','A46-move-item','Item', i.id,
       jsonb_build_object('name', i.name, 'category', src.name),
       jsonb_build_object('category', mv.dest)
FROM "Item" i
JOIN "ItemCategory" src ON src.id = i."categoryId"
JOIN _moves mv ON mv.iname = i.name
JOIN "ItemCategory" dest ON dest.name = mv.dest
WHERE src.id <> dest.id;

UPDATE "Item" i
SET "categoryId" = dest.id, "updatedAt" = now()
FROM _moves mv, "ItemCategory" dest
WHERE mv.iname = i.name AND dest.name = mv.dest AND i."categoryId" <> dest.id;

-- ---------------------------------------------------------------------------
-- A47. "Lixas, Fibras e Suportes" → "Lixas", promoted to level-1 top.
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A14','A47-promote-top','ItemCategory', c.id,
       jsonb_build_object('name', c.name, 'parentId', c."parentId", 'categoryLevel', c."categoryLevel"),
       jsonb_build_object('name', 'Lixas', 'parentId', NULL, 'categoryLevel', 1)
FROM "ItemCategory" c
WHERE c.name = 'Lixas, Fibras e Suportes'
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" x WHERE x.name = 'Lixas');

UPDATE "ItemCategory"
SET name = 'Lixas', "parentId" = NULL, "categoryLevel" = 1, "updatedAt" = now()
WHERE name = 'Lixas, Fibras e Suportes'
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" x WHERE x.name = 'Lixas');

-- ---------------------------------------------------------------------------
-- A48. Delete the empty "Uniforme — Corpo Inteiro" leaf.
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A14','A48-delete-empty-leaf','ItemCategory', c.id,
       jsonb_build_object('name', c.name), NULL
FROM "ItemCategory" c
WHERE c.name = 'Uniforme — Corpo Inteiro'
  AND NOT EXISTS (SELECT 1 FROM "Item" i WHERE i."categoryId" = c.id)
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" k WHERE k."parentId" = c.id);

DELETE FROM "ItemCategory" c
WHERE c.name = 'Uniforme — Corpo Inteiro'
  AND NOT EXISTS (SELECT 1 FROM "Item" i WHERE i."categoryId" = c.id)
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" k WHERE k."parentId" = c.id);

-- Summary
SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A14' GROUP BY step ORDER BY step;

SELECT p.name AS top, c.name AS leaf,
       (SELECT count(*) FROM "Item" i WHERE i."categoryId" = c.id AND i."isActive") AS active
FROM "ItemCategory" p LEFT JOIN "ItemCategory" c ON c."parentId" = p.id
WHERE p.name IN ('Abrasivos e Polimento', 'Lixas', 'Uniforme', 'EPI', 'Plotagem e Adesivação')
ORDER BY p.name, c.name;

COMMIT;
