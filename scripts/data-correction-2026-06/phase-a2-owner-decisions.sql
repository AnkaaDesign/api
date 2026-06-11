-- =============================================================================
-- PHASE A2 — Owner decisions on the pending AMBIGUITIES (printer inks, soprador
-- térmico typo, pote redondo verification, capability-backfill verification).
-- Data correction 2026-06-09. Idempotent: guarded WHERE clauses; re-running is a no-op.
-- All changes are logged to correction_log_20260609 (old values preserved for rollback).
-- MUST run AFTER phase-a (the CMY ink items are created there; ids differ per env,
-- so this phase resolves them by name).
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a2-owner-decisions.sql
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
-- A9. Printer ink quantities — owner-confirmed physical count:
--     Ciano = 1, Magenta = 1, Amarela = 1, Preta = 2 (total 5).
--     NOTE: the system previously recorded 4 units total (all on Preta); the
--     owner's physical truth is 5 — a +1 delta, accepted as an inventory count.
--     Convention: like phase-a A8, no Activity row is written for these
--     correction-time balance sets; the change is recorded in the log only.
--     Resolved BY NAME (the CMY items are A7 creations with per-env uuids).
-- ---------------------------------------------------------------------------
-- expected_old_qty = the stale pre-correction state this overwrite was designed
-- to fix (2026-06-09 physical count): Preta carried all 4 units; the CMY items
-- are A7 creations born with 0. The overwrite only fires when the quantity
-- still equals that stale value — if prod has since moved (real consumption or
-- a fresh count), the 06-09 number is outdated and we must NOT clobber it.
CREATE TEMP TABLE _ink_targets (item_name text, expected_old_qty double precision, target_qty double precision);
INSERT INTO _ink_targets VALUES
  ('Tinta para Impressora Ciano',   0, 1),
  ('Tinta para Impressora Magenta', 0, 1),
  ('Tinta para Impressora Amarela', 0, 1),
  ('Tinta para Impressora Preta',   4, 2);

-- unknown names are logged as skipped instead of failing (once)
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A2','A9-skipped-unknown-item','Item', t.item_name, NULL,
       jsonb_build_object('targetQuantity', t.target_qty)
FROM _ink_targets t
WHERE NOT EXISTS (SELECT 1 FROM "Item" i WHERE i.name = t.item_name)
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'A9-skipped-unknown-item' AND l.entity_id = t.item_name);

-- drift guard: quantity is neither the target (already correct / phase-a A8
-- applied it) nor the stale pre-correction value -> prod moved since 06-09;
-- SKIP the overwrite and log once for the operator to re-count instead.
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A2','A2-ink-skip-drifted','Item', i.id,
       jsonb_build_object('quantity', i.quantity),
       jsonb_build_object('expectedOldQuantity', t.expected_old_qty,
                          'intendedQuantity', t.target_qty,
                          'note', 'quantity drifted since the 2026-06-09 count; NOT overwritten — re-count physically')
FROM "Item" i JOIN _ink_targets t ON t.item_name = i.name
WHERE i.quantity IS DISTINCT FROM t.target_qty
  AND i.quantity IS DISTINCT FROM t.expected_old_qty
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'A2-ink-skip-drifted' AND l.entity_id = i.id);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A2','A9-ink-owner-final','Item', i.id,
       jsonb_build_object('quantity', i.quantity),
       jsonb_build_object('quantity', t.target_qty)
FROM "Item" i JOIN _ink_targets t ON t.item_name = i.name
WHERE i.quantity IS DISTINCT FROM t.target_qty
  AND i.quantity IS NOT DISTINCT FROM t.expected_old_qty;

UPDATE "Item" i SET quantity = t.target_qty, "updatedAt" = now()
FROM _ink_targets t
WHERE i.name = t.item_name
  AND i.quantity IS DISTINCT FROM t.target_qty
  AND i.quantity IS NOT DISTINCT FROM t.expected_old_qty;

-- ---------------------------------------------------------------------------
-- A10. Soprador Térmico typo ("Spordico/Sporadico Termico" → "Soprador Térmico
--      Bateria"). On the 2026-06-09 backup NO typo row exists: the item is
--      already named 'Soprador Térmico Bateria' (id 3218b7cb…, deactivated by
--      A6 at owner request) and a separate active 'Soprador Térmico' (qty 8)
--      also exists — per owner, these are NOT merged. The rename below is a
--      defensive pattern guard for the production run; it is a no-op when no
--      typo row exists, and it refuses to create a duplicate name.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _soprador_typos AS
SELECT i.id, i.name
FROM "Item" i
WHERE i.name ~* 'spo?r' AND i.name ~* 't[eé]rmic'
  AND i.name !~* '^\s*soprador'                              -- already-correct rows
  AND i.name IS DISTINCT FROM 'Soprador Térmico Bateria';

-- refuse-and-log instead of creating a duplicate name
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A2','A10-skipped-duplicate-name','Item', t.id,
       jsonb_build_object('name', t.name),
       jsonb_build_object('reason', 'an item named Soprador Térmico Bateria already exists; manual review')
FROM _soprador_typos t
WHERE EXISTS (SELECT 1 FROM "Item" e WHERE e.name = 'Soprador Térmico Bateria' AND e.id <> t.id)
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'A10-skipped-duplicate-name' AND l.entity_id = t.id);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A2','A10-soprador-rename','Item', t.id,
       jsonb_build_object('name', t.name),
       jsonb_build_object('name', 'Soprador Térmico Bateria')
FROM _soprador_typos t
WHERE NOT EXISTS (SELECT 1 FROM "Item" e WHERE e.name = 'Soprador Térmico Bateria' AND e.id <> t.id);

UPDATE "Item" i SET name = 'Soprador Térmico Bateria', "updatedAt" = now()
FROM _soprador_typos t
WHERE i.id = t.id
  AND NOT EXISTS (SELECT 1 FROM "Item" e WHERE e.name = 'Soprador Térmico Bateria' AND e.id <> t.id);

-- battery power tool = borrowable fixed-target tool: fix capability fields if
-- the item still carries CONSUMPTION defaults while sitting in a TOOL category
-- (the 20260609180000 backfill normally covers this; guard makes it a no-op)
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A2','A10-soprador-capability','Item', i.id,
       jsonb_build_object('isBorrowable', i."isBorrowable", 'stockModel', i."stockModel",
                          'fixedTargetQuantity', i."fixedTargetQuantity"),
       jsonb_build_object('isBorrowable', true, 'stockModel', 'FIXED_TARGET', 'fixedTargetQuantity', 1)
FROM "Item" i JOIN "ItemCategory" c ON c.id = i."categoryId"
WHERE i.name = 'Soprador Térmico Bateria'
  AND c.type = 'TOOL' AND i."stockModel" = 'CONSUMPTION';

UPDATE "Item" i
SET "isBorrowable" = true, "stockModel" = 'FIXED_TARGET',
    "fixedTargetQuantity" = 1, "updatedAt" = now()
FROM "ItemCategory" c
WHERE c.id = i."categoryId" AND i.name = 'Soprador Térmico Bateria'
  AND c.type = 'TOOL' AND i."stockModel" = 'CONSUMPTION';

-- ---------------------------------------------------------------------------
-- A11. Pote Redondo — READ-ONLY. Rename was confirmed correct; the pots-per-box
--      conversion factor is still pending from the owner, so NO stock
--      conversion is performed. Current state printed for the re-ask.
-- ---------------------------------------------------------------------------
SELECT 'A11-pote-redondo' AS check, i.id, i.name, c.name AS category, i.quantity,
       (SELECT string_agg(m.value || ' ' || m.unit, ', ')
        FROM "Measure" m WHERE m."itemId" = i.id) AS measures
FROM "Item" i LEFT JOIN "ItemCategory" c ON c.id = i."categoryId"
WHERE i.name = 'Pote Redondo';

-- ---------------------------------------------------------------------------
-- A12. Capability-fields backfill verification (migration
--      20260609180000_item_capability_fields) — READ-ONLY.
-- ---------------------------------------------------------------------------
SELECT 'A12-stock-model-counts' AS check, "stockModel"::text AS bucket, count(*),
       count(*) FILTER (WHERE "isActive") AS active
FROM "Item" GROUP BY 2
UNION ALL
SELECT 'A12-borrowable-counts', 'isBorrowable=' || "isBorrowable"::text, count(*),
       count(*) FILTER (WHERE "isActive")
FROM "Item" GROUP BY 2
ORDER BY 1, 2;

SELECT 'A12-active-tool-not-fixed (expect 0)' AS check, count(*)
FROM "Item" i JOIN "ItemCategory" c ON c.id = i."categoryId"
WHERE i."isActive" AND c.type = 'TOOL' AND i."stockModel" <> 'FIXED_TARGET'
UNION ALL
SELECT 'A12-consumption-with-target (expect 0)', count(*)
FROM "Item" WHERE "stockModel" = 'CONSUMPTION' AND "fixedTargetQuantity" IS NOT NULL
UNION ALL
SELECT 'A12-ppetype-outside-ppe-category (expect 0)', count(*)
FROM "Item" i JOIN "ItemCategory" c ON c.id = i."categoryId"
WHERE i."isActive" AND i."ppeType" IS NOT NULL AND c.type <> 'PPE'
UNION ALL
SELECT 'A12-ppe-category-missing-ppetype (expect 0)', count(*)
FROM "Item" i JOIN "ItemCategory" c ON c.id = i."categoryId"
WHERE i."isActive" AND c.type = 'PPE' AND i."ppeType" IS NULL;

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
SELECT step, count(*) FROM correction_log_20260609 WHERE phase='A2' GROUP BY 1 ORDER BY 1;

COMMIT;
