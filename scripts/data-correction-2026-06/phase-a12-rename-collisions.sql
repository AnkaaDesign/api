-- =============================================================================
-- PHASE A12 — Rename active name-collision items (owner approval 2026-06-10).
--
-- SCOPE: every collision EXCEPT the 11 pigment UC/AC pairs (owner: keep as-is).
-- RENAMES ONLY — no merges, no deactivations. Verified distinct beforehand:
--   - Endurecedor Pu 573.009 vs 573.950 — owner-confirmed two real products
--   - Primer Spectra 2k P30 Branco vs Cinza — two colors (uniCode)
--   - Escadas are THREE distinct ladders: 7 / 16 / 30 degraus (uniCode)
--   - Macacão third unit is XXG (uniCode; M/XG carry Measure SIZE rows)
--   - Garrafas Quadradas are 300ml / 500ml / 1L (Measure VOLUME; the 1L row
--     had unit LITER with value 1000 — unit typo fixed to MILLILITER here)
--   - Parafuso/Rebite uncoded twins: only the coded one is renamed (collision
--     resolved); uncoded specs unknown → flagged for the physical recount
-- NOTE: renaming actives "Calça" → "Calça - NN" matches the legacy convention;
-- the 7 INACTIVE "Calça - NN" twins then share names with the actives (same
-- real product, previous generation rows — accepted pattern in this DB).
--
-- Matching is environment-portable: (name, uniCode) pairs, or (name, Measure
-- SIZE) for clothing. Idempotent: after a rename the match no longer applies.
-- Logged to correction_log_20260609 (phase 'A12').
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a12-rename-collisions.sql
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
-- A39a. uniCode-keyed renames.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _ren_code (old_name text, unicode text, new_name text);
INSERT INTO _ren_code VALUES
  ('Endurecedor Pu',             '573.009',     'Endurecedor Pu 573.009'),
  ('Endurecedor Pu',             '573.950',     'Endurecedor Pu 573.950'),
  ('Wash Primer',                '045',         'Wash Primer 045'),
  ('Wash Primer',                '517.600',     'Wash Primer 517.600'),
  ('Primer Spectra 2k',          'P30 Branco',  'Primer Spectra 2k P30 Branco'),
  ('Primer Spectra 2k',          'P30 Cinza',   'Primer Spectra 2k P30 Cinza'),
  ('Esmerilhadeira',             'GA5010',      'Esmerilhadeira GA5010'),
  ('Esmerilhadeira',             'GWS-9',       'Esmerilhadeira GWS-9'),
  ('Parafusadeira',              'GSB -50',     'Parafusadeira GSB-50'),
  ('Parafusadeira',              'DHP482',      'Parafusadeira DHP482'),
  ('Pistola de Pintura',         'PRO-534',     'Pistola de Pintura PRO-534'),
  ('Pistola de Pintura',         'PR .7m',      'Pistola de Pintura PR 0.7m'),
  ('Escada de Aluminio',         '16/degraus',  'Escada de Alumínio 16 Degraus'),
  ('Escada de Aluminio',         '30/degraus',  'Escada de Alumínio 30 Degraus'),
  ('Escada de Alumínio',         '7 degraus',   'Escada de Alumínio 7 Degraus'),
  ('Garrafa Quadrada',           '001',         'Garrafa Quadrada 300ml'),
  ('Garrafa Quadrada',           '002',         'Garrafa Quadrada 500ml'),
  ('Garrafa Quadrada',           '004',         'Garrafa Quadrada 1L'),
  ('Abraçadeira Nylon Preta',    '200x2,5mm',   'Abraçadeira Nylon Preta 200x2,5mm'),
  ('Abraçadeira Nylon Preta',    '200x4,6mm',   'Abraçadeira Nylon Preta 200x4,6mm'),
  ('Abraçadeira Nylon Preta',    '300x7,2mm',   'Abraçadeira Nylon Preta 300x7,2mm'),
  ('Parafuso Sextavado Zincado', 'UNC 3/',      'Parafuso Sextavado Zincado UNC'),
  ('Rebite Rosca Lisa',          'M10',         'Rebite Rosca Lisa M10'),
  ('Macacão de Segurança',       'M',           'Macacão de Segurança - M'),
  ('Macacão de Segurança',       'XG',          'Macacão de Segurança - XG'),
  ('Macacão de Segurança',       'XXG',         'Macacão de Segurança - XXG');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A12','A39-rename','Item', i.id,
       jsonb_build_object('name', i.name, 'uniCode', i."uniCode"),
       jsonb_build_object('name', r.new_name)
FROM "Item" i JOIN _ren_code r ON r.old_name = i.name AND r.unicode = i."uniCode"
WHERE i."isActive";

UPDATE "Item" i
SET name = r.new_name, "updatedAt" = now()
FROM _ren_code r
WHERE r.old_name = i.name AND r.unicode = i."uniCode" AND i."isActive";

-- ---------------------------------------------------------------------------
-- A39b. Calça — size lives in Measure (SIZE, numeric value 36..48).
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A12','A39-rename','Item', i.id,
       jsonb_build_object('name', i.name, 'size', m.value),
       jsonb_build_object('name', 'Calça - ' || m.value::int)
FROM "Item" i JOIN "Measure" m ON m."itemId" = i.id AND m."measureType" = 'SIZE'
WHERE i."isActive" AND i.name = 'Calça' AND m.value IS NOT NULL;

UPDATE "Item" i
SET name = 'Calça - ' || m.value::int, "updatedAt" = now()
FROM "Measure" m
WHERE m."itemId" = i.id AND m."measureType" = 'SIZE' AND m.value IS NOT NULL
  AND i."isActive" AND i.name = 'Calça';

-- ---------------------------------------------------------------------------
-- A39c. Camiseta — size lives in Measure (SIZE, unit P/M/G/GG/XG).
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A12','A39-rename','Item', i.id,
       jsonb_build_object('name', i.name, 'size', m.unit),
       jsonb_build_object('name', 'Camiseta - ' || m.unit)
FROM "Item" i JOIN "Measure" m ON m."itemId" = i.id AND m."measureType" = 'SIZE'
WHERE i."isActive" AND i.name = 'Camiseta' AND m.unit IS NOT NULL;

UPDATE "Item" i
SET name = 'Camiseta - ' || m.unit, "updatedAt" = now()
FROM "Measure" m
WHERE m."itemId" = i.id AND m."measureType" = 'SIZE' AND m.unit IS NOT NULL
  AND i."isActive" AND i.name = 'Camiseta';

-- ---------------------------------------------------------------------------
-- A39d. Garrafa 1L measure unit typo: value 1000 unit LITER → MILLILITER.
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A12','A39-fix-measure-unit','Measure', m.id,
       jsonb_build_object('value', m.value, 'unit', m.unit),
       jsonb_build_object('value', m.value, 'unit', 'MILLILITER')
FROM "Measure" m JOIN "Item" i ON i.id = m."itemId"
WHERE i.name = 'Garrafa Quadrada 1L' AND m."measureType" = 'VOLUME'
  AND m.value = 1000 AND m.unit = 'LITER';

UPDATE "Measure" m
SET unit = 'MILLILITER', "updatedAt" = now()
FROM "Item" i
WHERE i.id = m."itemId" AND i.name = 'Garrafa Quadrada 1L'
  AND m."measureType" = 'VOLUME' AND m.value = 1000 AND m.unit = 'LITER';

-- ---------------------------------------------------------------------------
-- Summary + remaining active name collisions (expect ONLY the pigment pairs
-- and the uncoded Parafuso/Rebite twins now made unique by the coded rename).
-- ---------------------------------------------------------------------------
SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A12' GROUP BY step;

SELECT lower(trim(name)) AS colliding_name, count(*),
       string_agg(coalesce("uniCode",'-'), ', ')
FROM "Item" WHERE "isActive"
GROUP BY 1 HAVING count(*) > 1 ORDER BY 1;

COMMIT;
