-- =============================================================================
-- PHASE A16 — Abrasivos tree correction (owner, 2026-06-10, revising A14):
--   "Lixas" goes BACK under Abrasivos e Polimento as a level-2 leaf (not a
--   standalone top), and Palha de Aço + Scotch Brite leave Lixas into a new
--   sibling leaf "Fibras Abrasivas".
--
-- Final shape:
--   Abrasivos e Polimento
--   ├─ Lixas                      (sandpaper only)
--   ├─ Fibras Abrasivas           (palha de aço, scotch brite)
--   ├─ Bases e Adaptadores        (A14)
--   ├─ Discos de Corte e Desbaste
--   └─ Polimento e Refino
--
-- AFTER: run the ITEM_DERIVED mirror sync.
-- Idempotent; logged to correction_log_20260609 (phase 'A16').
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a16-abrasivos-tree.sql
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
-- A50. Demote "Lixas" to a leaf under Abrasivos e Polimento.
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A16','A50-demote-leaf','ItemCategory', c.id,
       jsonb_build_object('name', c.name, 'parentId', c."parentId", 'categoryLevel', c."categoryLevel"),
       jsonb_build_object('parent', 'Abrasivos e Polimento', 'categoryLevel', 2)
FROM "ItemCategory" c, "ItemCategory" p
WHERE c.name = 'Lixas' AND p.name = 'Abrasivos e Polimento'
  AND (c."parentId" IS DISTINCT FROM p.id OR c."categoryLevel" IS DISTINCT FROM 2);

UPDATE "ItemCategory" c
SET "parentId" = p.id, "categoryLevel" = 2, "updatedAt" = now()
FROM "ItemCategory" p
WHERE c.name = 'Lixas' AND p.name = 'Abrasivos e Polimento'
  AND (c."parentId" IS DISTINCT FROM p.id OR c."categoryLevel" IS DISTINCT FROM 2);

-- ---------------------------------------------------------------------------
-- A51. New leaf "Fibras Abrasivas" + move palha de aço / scotch brite.
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A16','A51-create-leaf','ItemCategory', 'Fibras Abrasivas', NULL,
       jsonb_build_object('parent', 'Abrasivos e Polimento', 'accountingType', 'PRODUTIVO', 'type', 'REGULAR')
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" WHERE name = 'Fibras Abrasivas');

INSERT INTO "ItemCategory" (id, name, type, "categoryLevel", "parentId", "accountingType", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Fibras Abrasivas', 'REGULAR', 2, p.id, 'PRODUTIVO', now(), now()
FROM "ItemCategory" p
WHERE p.name = 'Abrasivos e Polimento'
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" WHERE name = 'Fibras Abrasivas');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A16','A51-move-item','Item', i.id,
       jsonb_build_object('name', i.name, 'category', src.name),
       jsonb_build_object('category', 'Fibras Abrasivas')
FROM "Item" i
JOIN "ItemCategory" src ON src.id = i."categoryId"
JOIN "ItemCategory" dest ON dest.name = 'Fibras Abrasivas'
WHERE i.name IN ('Palha de Aço', 'Scotch Brite') AND src.id <> dest.id;

UPDATE "Item" i
SET "categoryId" = dest.id, "updatedAt" = now()
FROM "ItemCategory" dest
WHERE dest.name = 'Fibras Abrasivas'
  AND i.name IN ('Palha de Aço', 'Scotch Brite')
  AND i."categoryId" <> dest.id;

-- Summary
SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A16' GROUP BY step ORDER BY step;

SELECT c.name AS leaf, count(i.id) FILTER (WHERE i."isActive") AS active, count(i.id) AS total
FROM "ItemCategory" p
JOIN "ItemCategory" c ON c."parentId" = p.id
LEFT JOIN "Item" i ON i."categoryId" = c.id
WHERE p.name = 'Abrasivos e Polimento'
GROUP BY c.id, c.name ORDER BY c.name;

COMMIT;
