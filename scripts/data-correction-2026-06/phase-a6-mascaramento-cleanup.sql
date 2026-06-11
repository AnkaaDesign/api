-- =============================================================================
-- PHASE A6 — Máscaras de Transferência leaf + Mascaramento e Cobertura cleanup.
-- Data correction 2026-06-10. Idempotent: guarded WHERE clauses; re-running is
-- a no-op. All changes logged to correction_log_20260609. Run AFTER phase-a5.
--
-- The two items named just "Máscara" (uniCodes 321/328 — the rolls cut in half,
-- the same items behind the B4 half-count correction) are PLOTTING TRANSFER
-- MASKS, not masking consumables: renamed and moved to the merged-taxonomy leaf
-- "Máscaras de Transferência" (created under Plotagem). The remaining
-- out-of-place rows in Mascaramento e Cobertura (sealants, wires, screws,
-- applicators, packaging — all already inactive) are re-homed to their proper
-- categories. Legit masking stock (fitas crepe, Bobina TKV, Líq. de
-- Mascaramento, Rolo de Lona Plástica) stays.
--
-- AFTER THIS PHASE re-run the ITEM_DERIVED mirror sync (new subcategory).
--
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a6-mascaramento-cleanup.sql
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
-- A20. Create the "Máscaras de Transferência" subcategory under Plotagem.
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A6','A20-create-subcategory','ItemCategory', 'Máscaras de Transferência', NULL,
       jsonb_build_object('parent', 'Plotagem', 'categoryLevel', 2, 'accountingType', 'PRODUTIVO')
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = 'Máscaras de Transferência');

INSERT INTO "ItemCategory" (id, name, type, "categoryLevel", "parentId", "accountingType", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Máscaras de Transferência', 'REGULAR'::"ItemCategoryType", 2,
       (SELECT id FROM "ItemCategory" WHERE name = 'Plotagem'),
       'PRODUTIVO'::"AccountingType", now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = 'Máscaras de Transferência')
  AND EXISTS (SELECT 1 FROM "ItemCategory" p WHERE p.name = 'Plotagem');

-- ---------------------------------------------------------------------------
-- A21. Rename the two "Máscara" rolls (by id, guarded by current name).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _mask_renames (item_id text, new_name text);
INSERT INTO _mask_renames VALUES
  ('33ed541a-343c-4232-bf6d-921dfdf198a6', 'Máscara de Transferência 321'),
  ('5334cf95-0e83-404e-a8c0-cd84c888b6c7', 'Máscara de Transferência 328');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A6','A21-rename-mask','Item', i.id,
       jsonb_build_object('name', i.name), jsonb_build_object('name', r.new_name)
FROM "Item" i JOIN _mask_renames r ON i.id::text = r.item_id
WHERE i.name = 'Máscara';

UPDATE "Item" i SET name = r.new_name, "updatedAt" = now()
FROM _mask_renames r
WHERE i.id::text = r.item_id AND i.name = 'Máscara';

-- ---------------------------------------------------------------------------
-- A22. Re-home items currently sitting in Mascaramento e Cobertura.
--      Matched by exact name while still in the source category; already-moved
--      rows are no-ops; unknown names logged as skipped once.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _mc_moves (item_name text, target text);
INSERT INTO _mc_moves VALUES
  -- plotting transfer masks (renamed in A21)
  ('Máscara de Transferência 321',         'Máscaras de Transferência'),
  ('Máscara de Transferência 328',         'Máscaras de Transferência'),
  -- body sealants -> Funilaria/Reparo
  ('Adesivo Selante Cinza',                'Reparo e Preparação'),
  ('Adesivo Selante Preto',                'Reparo e Preparação'),
  -- wires & screws -> Fixadores
  ('Arame Galvanizado',                    'Fixadores'),
  ('Arame Recozido N°14',                  'Fixadores'),
  ('Arame Recozido N°18',                  'Fixadores'),
  ('Parafuso Philips Brocante flangeado',  'Fixadores'),
  ('Parafuso philips Brocante Flangeado',  'Fixadores'),
  -- applicators / production consumables -> Produção
  ('Pincel Médio',                         'Produção'),
  ('Bisnaga Plastica',                     'Produção'),
  ('Bisnaga Plastico',                     'Produção'),
  ('Rolo Fibra Sintética',                 'Produção'),
  ('Refil de Gás',                         'Produção'),
  -- packaging -> Embalagem e Expedição
  ('Sacola Plástica',                      'Embalagem e Expedição');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A6','A22-skipped-unknown-item','Item', m.item_name, NULL,
       jsonb_build_object('target', m.target)
FROM _mc_moves m
WHERE NOT EXISTS (
        SELECT 1 FROM "Item" i
        JOIN "ItemCategory" c ON c.id = i."categoryId"
        WHERE i.name = m.item_name
          AND c.name IN ('Mascaramento e Cobertura', m.target))
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'A22-skipped-unknown-item' AND l.entity_id = m.item_name);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A6','A22-move','Item', i.id,
       jsonb_build_object('categoryId', i."categoryId"),
       jsonb_build_object('categoryName', m.target)
FROM "Item" i
JOIN "ItemCategory" c  ON c.id = i."categoryId" AND c.name = 'Mascaramento e Cobertura'
JOIN _mc_moves m       ON m.item_name = i.name
JOIN "ItemCategory" tc ON tc.name = m.target;

UPDATE "Item" i
SET "categoryId" = tc.id, "updatedAt" = now()
FROM "ItemCategory" c, _mc_moves m, "ItemCategory" tc
WHERE c.id = i."categoryId" AND c.name = 'Mascaramento e Cobertura'
  AND m.item_name = i.name AND tc.name = m.target;

-- summary
SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A6' GROUP BY step ORDER BY step;

COMMIT;
