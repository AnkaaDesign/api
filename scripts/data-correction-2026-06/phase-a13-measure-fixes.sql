-- =============================================================================
-- PHASE A13 — Measure table cleanup. Data correction 2026-06-10.
--
-- ROOT CAUSES FOUND:
--  1. Fraction parse bug: specs like "1/2" were stored as TWO LENGTH rows —
--     (1, INCH_1_2) + (2, INCHES). The divisor row is garbage; the numerator
--     row really means ⌀1/2" → converted to (DIAMETER, 0.5, INCHES).
--     Same for cm-encoded parses: "3/8" → (3,CM)+(8,CM); "3/4" → (3,CM)+(4,CM).
--  2. Sockets carry a third junk row: size+drive concatenated as INCHES
--     (Soquete 18 + 1/2 drive → 18.5 INCHES). Deleted.
--  3. Bolt names "DxL" split into two LENGTH rows: smaller is the DIAMETER
--     (Allen 10x25, Rebites 416/516); M06x0,40's 0.4 is the thread PITCH.
--  4. Tapes/rolls/sheets: second LENGTH is really WIDTH (the owner's example:
--     "2 comprimentos" → comprimento × largura).
--  5. Unit typos: WEIGHT in KILOGRAM that is really GRAM (982 kg hardener can);
--     Sacola 40x50 in MM that is CM; Faixa Lateral Esq with 9300 KILOGRAM +
--     9300 LITER junk (twins all carry LENGTH 30cm × WIDTH 5cm).
--  6. Exact duplicate rows (8) and impossible THREAD rows (25/35 mm "pitch" —
--     they are lengths duplicated into THREAD) deleted.
--
-- WEB-VERIFIED SPECS ADDED (sources in ANALYSIS-2026-06-10.md):
--   Makita GA5010 esmerilhadeira: disco 125 mm, 1050 W (220 V already present)
--   Bosch GWS 9-125 esmerilhadeira: disco 125 mm, 900 W
--   Makita DHP482 parafusadeira: 18 V, mandril 1/2" (13 mm)
--   Bosch GSB 18V-50 parafusadeira: mandril 13 mm (18 V already present)
--   PDR PRO-534 pistola: bico 1.7 mm, copo 600 ml
--   Pistola "PR": its own rows decode to bico 1.7 mm + copo 550 ml → renamed
--   "Pistola de Pintura PR 0.7m" → "Pistola de Pintura PR 1.7mm" (the uniCode
--   "PR .7m" was a truncation of 1.7mm — confirmed by the 1.7 row).
--   "Parafuso Sextavado Zincado UNC" → "... UNC 3/8" (uniCode "UNC 3/" was
--   truncated 3/8; THREAD 16 TPI = standard 3/8"-16 UNC coarse pitch).
--
-- LEFT AS-IS (flagged for shelf check, ambiguous): Bisnaga Pisseta (500+1000ml
-- mixed), Extensão Elétrica (2x2,5mm bitola — no mm² unit exists), Parafuso
-- Sextavado Inox/Zincado mixed-bin lengths, Cavalete (inactive, 3 dims),
-- Lixadeira Orbital 3cm row, Kit de Rodas 320kg / Banqueta 150kg (load
-- CAPACITY stored as WEIGHT — meaningful, type misuse only).
--
-- Idempotent: deletes/updates match the pre-fix state only; inserts guarded by
-- NOT EXISTS. Logged to correction_log_20260609 (phase 'A13').
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a13-measure-fixes.sql
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
-- A40. Generic exact-duplicate dedupe (same item, type, value, unit → keep 1).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _dups AS
SELECT m.id
FROM "Measure" m
WHERE m.id NOT IN (
  SELECT min(id) FROM "Measure"
  GROUP BY "itemId", "measureType", value, unit
);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A13','A40-dedupe-exact','Measure', m.id,
       jsonb_build_object('itemId', m."itemId", 'type', m."measureType", 'value', m.value, 'unit', m.unit),
       NULL
FROM "Measure" m JOIN _dups d ON d.id = m.id;

DELETE FROM "Measure" WHERE id IN (SELECT id FROM _dups);

-- ---------------------------------------------------------------------------
-- A41. Targeted junk deletes (parse divisors, concatenated socket junk,
--      impossible THREAD pitches, absurd unit rows).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _del (iname text, mtype text, val numeric, unit text);
INSERT INTO _del VALUES
  -- socket size+drive concatenation junk
  ('Soquete Hexagonal 4','LENGTH',4.5,'INCHES'),
  ('Soquete Hexagonal 5','LENGTH',5.5,'INCHES'),
  ('Soquete Hexagonal 6','LENGTH',6.5,'INCHES'),
  ('Soquete Hexagonal 7','LENGTH',7.5,'INCHES'),
  ('Soquete Sextavado 18','LENGTH',18.5,'INCHES'),
  ('Soquete Sextavado 19','LENGTH',19.5,'INCHES'),
  ('Soquete Sextavado 32','LENGTH',32.5,'INCHES'),
  ('Soquete Sextavado 6','LENGTH',6.25,'INCHES'),
  ('Soquete Sextavado 7','LENGTH',7.25,'INCHES'),
  ('Soquete Sextavado 8','LENGTH',8.25,'INCHES'),
  ('Soquete Sextavado 9','LENGTH',9.25,'INCHES'),
  -- fraction-parse divisor rows (the "/D" half)
  ('Soquete Hexagonal 4','LENGTH',2,'INCHES'),
  ('Soquete Hexagonal 5','LENGTH',2,'INCHES'),
  ('Soquete Hexagonal 6','LENGTH',2,'INCHES'),
  ('Soquete Hexagonal 7','LENGTH',2,'INCHES'),
  ('Soquete Sextavado 18','LENGTH',2,'INCHES'),
  ('Soquete Sextavado 19','LENGTH',2,'INCHES'),
  ('Soquete Sextavado 32','LENGTH',2,'INCHES'),
  ('Soquete Torx T-40 Longo','LENGTH',2,'INCHES'),
  ('Chave Catraca Grande','LENGTH',2,'INCHES'),
  ('Mangueira de Água','LENGTH',2,'INCHES'),
  ('Regulador de Pressão','LENGTH',2,'INCHES'),
  ('Luva Redução','LENGTH',2,'INCHES'),
  ('Niple Duplo Galv','LENGTH',2,'INCHES'),
  ('Soquete Sextavado 6','LENGTH',4,'INCHES'),
  ('Soquete Sextavado 7','LENGTH',4,'INCHES'),
  ('Soquete Sextavado 8','LENGTH',4,'INCHES'),
  ('Soquete Sextavado 9','LENGTH',4,'INCHES'),
  ('Soquete Sextavado 8 Longo','LENGTH',4,'INCHES'),
  ('Soquete Sextavado 9 Longo','LENGTH',4,'INCHES'),
  ('Chave Catraca Pequena','LENGTH',4,'INCHES'),
  ('Mangueira de Ar','LENGTH',4,'INCHES'),
  ('Luva Redução','LENGTH',4,'INCHES'),
  ('Chave Catraca Media','LENGTH',8,'INCHES'),
  ('Luva Redução','LENGTH',8,'INCHES'),
  -- cm-encoded parse rows replaced by DIAMETER inserts in A43
  ('Valvula Esferica Latão 1/2','LENGTH',1,'CENTIMETER'),
  ('Valvula Esferica Latão 1/2','LENGTH',2,'CENTIMETER'),
  ('Valvula Esferica Latão 3/4','LENGTH',3,'CENTIMETER'),
  ('Valvula Esferica Latão 3/4','LENGTH',4,'CENTIMETER'),
  ('Conexão Te Galv','LENGTH',1,'CENTIMETER'),
  ('Conexão Te Galv','LENGTH',2,'CENTIMETER'),
  ('Macho 3/8','LENGTH',3,'CENTIMETER'),
  ('Macho 3/8','LENGTH',8,'CENTIMETER'),
  ('Mangueira Irrigação','LENGTH',3,'CENTIMETER'),
  ('Mangueira Irrigação','LENGTH',8,'CENTIMETER'),
  ('Mandril P/ Martelet','LENGTH',1,'CENTIMETER'),
  ('Mandril P/ Martelet','LENGTH',2,'CENTIMETER'),
  ('Niple Duplo Galv','LENGTH',3,'CENTIMETER'),
  ('Niple Duplo Galv','LENGTH',4,'CENTIMETER'),
  -- Parafuso UNC 3/8 garbage (replaced by DIAMETER + THREAD inserts)
  ('Parafuso Sextavado Zincado UNC','LENGTH',1,'MILLIMETER'),
  ('Parafuso Sextavado Zincado UNC','LENGTH',3,'CENTIMETER'),
  ('Parafuso Sextavado Zincado UNC','LENGTH',8,'CENTIMETER'),
  ('Parafuso Sextavado Zincado UNC','LENGTH',8,'MILLIMETER'),
  -- Parafuso 5/16 x 7/8 garbage (replaced by inserts)
  ('Parafuso Sextavado Inox 5/16 X 7/8','LENGTH',5,'CENTIMETER'),
  ('Parafuso Sextavado Inox 5/16 X 7/8','LENGTH',7,'CENTIMETER'),
  ('Parafuso Sextavado Inox 5/16 X 7/8','LENGTH',7,'MILLIMETER'),
  ('Parafuso Sextavado Inox 5/16 X 7/8','LENGTH',8,'CENTIMETER'),
  ('Parafuso Sextavado Inox 5/16 X 7/8','LENGTH',16,'MILLIMETER'),
  ('Parafuso Sextavado Inox 5/16 X 7/8','LENGTH',16,'CENTIMETER'),
  -- Parafuso 5/16x1 garbage (replaced by inserts)
  ('Parafuso Sextavado Inox 5/16x1','LENGTH',1,'MILLIMETER'),
  ('Parafuso Sextavado Inox 5/16x1','LENGTH',5,'CENTIMETER'),
  ('Parafuso Sextavado Inox 5/16x1','LENGTH',16,'CENTIMETER'),
  ('Parafuso Sextavado Inox 5/16x1','LENGTH',16,'MILLIMETER'),
  -- impossible THREAD "pitches" (lengths duplicated into THREAD)
  ('Parafuso Sextavado Inox','THREAD',25,'THREAD_MM'),
  ('Parafuso Sextavado Inox','THREAD',35,'THREAD_MM'),
  ('Parafuso Sextavado Zincado','THREAD',25,'THREAD_MM'),
  -- redundant SIZE rows duplicating the drill-bit diameters
  ('Broca P/ Martelet','SIZE',8,'UNIT'),
  ('Broca P/ Martelet','SIZE',10,'UNIT'),
  ('Broca P/ Martelet','SIZE',12,'UNIT'),
  ('Broca P/ Martelet','SIZE',14,'UNIT'),
  -- wrong-unit duplicate of the 260mm SDS length
  ('Broca Sds P/ Concreto','LENGTH',260,'CENTIMETER'),
  -- same length twice in two units (12" == 30cm) — keep the metric row
  ('Nivel de Mão','LENGTH',12,'INCHES'),
  -- paint gun junk row
  ('Pistola de Pintura PR 0.7m','LENGTH',1,'CENTIMETER'),
  -- faixa lateral absurd rows (twins carry 30x5cm — inserted in A43)
  ('Faixa Refletiva Lateral Esquerda','WEIGHT',9300,'KILOGRAM'),
  ('Faixa Refletiva Lateral Esquerda','VOLUME',9300,'LITER');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A13','A41-delete-junk','Measure', m.id,
       jsonb_build_object('item', i.name, 'type', m."measureType", 'value', m.value, 'unit', m.unit),
       NULL
FROM "Measure" m JOIN "Item" i ON i.id = m."itemId"
JOIN _del d ON d.iname = i.name AND d.mtype = m."measureType"::text
           AND d.val = m.value::numeric AND d.unit = m.unit::text;

DELETE FROM "Measure" m
USING "Item" i, _del d
WHERE i.id = m."itemId" AND d.iname = i.name AND d.mtype = m."measureType"::text
  AND d.val = m.value::numeric AND d.unit = m.unit::text;

-- ---------------------------------------------------------------------------
-- A42. In-place conversions (type and/or value/unit corrections).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _upd (iname text, mtype text, val numeric, unit text,
                        n_type text, n_val numeric, n_unit text);
INSERT INTO _upd VALUES
  -- fraction numerators → DIAMETER in decimal inches
  ('Soquete Hexagonal 4','LENGTH',1,'INCH_1_2','DIAMETER',0.5,'INCHES'),
  ('Soquete Hexagonal 5','LENGTH',1,'INCH_1_2','DIAMETER',0.5,'INCHES'),
  ('Soquete Hexagonal 6','LENGTH',1,'INCH_1_2','DIAMETER',0.5,'INCHES'),
  ('Soquete Hexagonal 7','LENGTH',1,'INCH_1_2','DIAMETER',0.5,'INCHES'),
  ('Soquete Sextavado 18','LENGTH',1,'INCH_1_2','DIAMETER',0.5,'INCHES'),
  ('Soquete Sextavado 19','LENGTH',1,'INCH_1_2','DIAMETER',0.5,'INCHES'),
  ('Soquete Sextavado 32','LENGTH',1,'INCH_1_2','DIAMETER',0.5,'INCHES'),
  ('Soquete Torx T-40 Longo','LENGTH',1,'INCH_1_2','DIAMETER',0.5,'INCHES'),
  ('Chave Catraca Grande','LENGTH',1,'INCH_1_2','DIAMETER',0.5,'INCHES'),
  ('Mangueira de Água','LENGTH',1,'INCH_1_2','DIAMETER',0.5,'INCHES'),
  ('Regulador de Pressão','LENGTH',1,'INCH_1_2','DIAMETER',0.5,'INCHES'),
  ('Luva Redução','LENGTH',1,'INCH_1_2','DIAMETER',0.5,'INCHES'),
  ('Niple Duplo Galv','LENGTH',1,'INCH_1_2','DIAMETER',0.5,'INCHES'),
  ('Soquete Sextavado 6','LENGTH',1,'INCH_1_4','DIAMETER',0.25,'INCHES'),
  ('Soquete Sextavado 7','LENGTH',1,'INCH_1_4','DIAMETER',0.25,'INCHES'),
  ('Soquete Sextavado 8','LENGTH',1,'INCH_1_4','DIAMETER',0.25,'INCHES'),
  ('Soquete Sextavado 9','LENGTH',1,'INCH_1_4','DIAMETER',0.25,'INCHES'),
  ('Soquete Sextavado 8 Longo','LENGTH',1,'INCH_1_4','DIAMETER',0.25,'INCHES'),
  ('Soquete Sextavado 9 Longo','LENGTH',1,'INCH_1_4','DIAMETER',0.25,'INCHES'),
  ('Chave Catraca Pequena','LENGTH',1,'INCH_1_4','DIAMETER',0.25,'INCHES'),
  ('Mangueira de Ar','LENGTH',1,'INCH_1_4','DIAMETER',0.25,'INCHES'),
  ('Chave Catraca Media','LENGTH',1,'INCH_3_8','DIAMETER',0.375,'INCHES'),
  ('Luva Redução','LENGTH',1,'INCH_3_8','DIAMETER',0.375,'INCHES'),
  ('Luva Redução','LENGTH',1,'INCH_3_4','DIAMETER',0.75,'INCHES'),
  -- bolt/rivet diameter × length splits (smaller dim → DIAMETER)
  ('Rebite de Repuxo 516','LENGTH',5,'MILLIMETER','DIAMETER',5,'MILLIMETER'),
  ('Rebite de Repuxo 416','LENGTH',4,'MILLIMETER','DIAMETER',4,'MILLIMETER'),
  ('Parafuso Allen Inox 10x25','LENGTH',10,'MILLIMETER','DIAMETER',10,'MILLIMETER'),
  ('Parafuso Allen M06 X 0,40','LENGTH',6,'MILLIMETER','DIAMETER',6,'MILLIMETER'),
  ('Parafuso Allen M06 X 0,40','LENGTH',0.4,'MILLIMETER','THREAD',0.4,'THREAD_MM'),
  ('Parafuso Sextavado Inox','LENGTH',8,'MILLIMETER','DIAMETER',8,'MILLIMETER'),
  -- drill bits: the "lengths" are the bit diameters (8-14mm set)
  ('Broca P/ Martelet','LENGTH',8,'MILLIMETER','DIAMETER',8,'MILLIMETER'),
  ('Broca P/ Martelet','LENGTH',10,'MILLIMETER','DIAMETER',10,'MILLIMETER'),
  ('Broca P/ Martelet','LENGTH',12,'MILLIMETER','DIAMETER',12,'MILLIMETER'),
  ('Broca P/ Martelet','LENGTH',14,'MILLIMETER','DIAMETER',14,'MILLIMETER'),
  ('Broca Sds P/ Concreto','LENGTH',13,'CENTIMETER','DIAMETER',13,'MILLIMETER'),
  -- tapes/rolls/sheets: second "comprimento" is really LARGURA (owner example)
  ('Fita Dupla Face','LENGTH',12,'MILLIMETER','WIDTH',12,'MILLIMETER'),
  ('Fita Filete Pvc','LENGTH',3,'MILLIMETER','WIDTH',3,'MILLIMETER'),
  ('Fita Filete Pvc','LENGTH',6,'MILLIMETER','WIDTH',6,'MILLIMETER'),
  ('Rolo Etiqueta','LENGTH',50,'MILLIMETER','WIDTH',50,'MILLIMETER'),
  ('Espaguete Termoretratil','LENGTH',35,'MILLIMETER','WIDTH',35,'MILLIMETER'),
  ('Escova Aço Motoesmeril','LENGTH',15,'CENTIMETER','DIAMETER',15,'CENTIMETER'),
  ('Escova Aço Motoesmeril','LENGTH',5,'CENTIMETER','WIDTH',5,'CENTIMETER'),
  ('Lixadeira Orbital','LENGTH',16,'CENTIMETER','DIAMETER',16,'CENTIMETER'),
  -- sacola 40x50 is cm, not mm
  ('Sacola Plástica','LENGTH',40,'MILLIMETER','WIDTH',40,'CENTIMETER'),
  ('Sacola Plástica','LENGTH',50,'MILLIMETER','LENGTH',50,'CENTIMETER'),
  -- condulete "2x4" box is inches
  ('Condulete Pvc Preto','LENGTH',2,'MILLIMETER','WIDTH',2,'INCHES'),
  ('Condulete Pvc Preto','LENGTH',4,'MILLIMETER','LENGTH',4,'INCHES'),
  -- WEIGHT unit typos: KILOGRAM that is really GRAM
  ('Endurecedor Pu 573.009','WEIGHT',983,'KILOGRAM','WEIGHT',983,'GRAM'),
  ('Endurecedor Pu 573.950','WEIGHT',982,'KILOGRAM','WEIGHT',982,'GRAM'),
  ('Desengraxante','WEIGHT',695,'KILOGRAM','WEIGHT',695,'GRAM'),
  ('Marreta Pequena','WEIGHT',500,'KILOGRAM','WEIGHT',500,'GRAM'),
  -- pistola PR: rows decode to bico 1.7mm + copo 550ml
  ('Pistola de Pintura PR 0.7m','LENGTH',1.7,'METER','DIAMETER',1.7,'MILLIMETER'),
  ('Pistola de Pintura PR 0.7m','LENGTH',550,'CENTIMETER','VOLUME',550,'MILLILITER');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A13','A42-convert','Measure', m.id,
       jsonb_build_object('item', i.name, 'type', m."measureType", 'value', m.value, 'unit', m.unit),
       jsonb_build_object('type', u.n_type, 'value', u.n_val, 'unit', u.n_unit)
FROM "Measure" m JOIN "Item" i ON i.id = m."itemId"
JOIN _upd u ON u.iname = i.name AND u.mtype = m."measureType"::text
           AND u.val = m.value::numeric AND u.unit = m.unit::text;

UPDATE "Measure" m
SET "measureType" = u.n_type::"MeasureType",
    value = u.n_val,
    unit = u.n_unit::"MeasureUnit",
    "updatedAt" = now()
FROM "Item" i, _upd u
WHERE i.id = m."itemId" AND u.iname = i.name AND u.mtype = m."measureType"::text
  AND u.val = m.value::numeric AND u.unit = m.unit::text;

-- ---------------------------------------------------------------------------
-- A43. Inserts: replacements for deleted parse-garbage + web-verified specs.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _ins (iname text, mtype text, val numeric, unit text);
INSERT INTO _ins VALUES
  -- replacements for cm-parse deletions
  ('Valvula Esferica Latão 1/2','DIAMETER',0.5,'INCHES'),
  ('Valvula Esferica Latão 3/4','DIAMETER',0.75,'INCHES'),
  ('Conexão Te Galv','DIAMETER',0.5,'INCHES'),
  ('Macho 3/8','DIAMETER',0.375,'INCHES'),
  ('Mangueira Irrigação','DIAMETER',0.375,'INCHES'),
  ('Mandril P/ Martelet','DIAMETER',0.5,'INCHES'),
  ('Niple Duplo Galv','DIAMETER',0.75,'INCHES'),
  -- parafusos rebuilt from their true specs
  ('Parafuso Sextavado Zincado UNC','DIAMETER',0.375,'INCHES'),
  ('Parafuso Sextavado Zincado UNC','THREAD',16,'THREAD_TPI'),
  ('Parafuso Sextavado Inox 5/16 X 7/8','DIAMETER',0.3125,'INCHES'),
  ('Parafuso Sextavado Inox 5/16 X 7/8','LENGTH',0.875,'INCHES'),
  ('Parafuso Sextavado Inox 5/16x1','DIAMETER',0.3125,'INCHES'),
  ('Parafuso Sextavado Inox 5/16x1','LENGTH',1,'INCHES'),
  -- faixas laterais mirror their four 30x5cm siblings
  ('Faixa Refletiva Lateral Esquerda','LENGTH',30,'CENTIMETER'),
  ('Faixa Refletiva Lateral Esquerda','WIDTH',5,'CENTIMETER'),
  ('Faixa Refletiva Lateral Direita','LENGTH',30,'CENTIMETER'),
  ('Faixa Refletiva Lateral Direita','WIDTH',5,'CENTIMETER'),
  -- web-verified tool specs
  ('Esmerilhadeira GA5010','DIAMETER',125,'MILLIMETER'),
  ('Esmerilhadeira GA5010','ELECTRICAL',1050,'WATT'),
  ('Esmerilhadeira GWS-9','DIAMETER',125,'MILLIMETER'),
  ('Esmerilhadeira GWS-9','ELECTRICAL',900,'WATT'),
  ('Parafusadeira DHP482','ELECTRICAL',18,'VOLT'),
  ('Parafusadeira DHP482','DIAMETER',13,'MILLIMETER'),
  ('Parafusadeira GSB-50','DIAMETER',13,'MILLIMETER'),
  ('Pistola de Pintura PRO-534','DIAMETER',1.7,'MILLIMETER'),
  ('Pistola de Pintura PRO-534','VOLUME',600,'MILLILITER');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A13','A43-insert','Measure', i.name || '/' || s.mtype, NULL,
       jsonb_build_object('item', i.name, 'type', s.mtype, 'value', s.val, 'unit', s.unit)
FROM _ins s JOIN "Item" i ON i.name = s.iname
WHERE NOT EXISTS (
  SELECT 1 FROM "Measure" m
  WHERE m."itemId" = i.id AND m."measureType"::text = s.mtype
    AND m.value::numeric = s.val AND m.unit::text = s.unit);

INSERT INTO "Measure" (id, value, unit, "measureType", "itemId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s.val, s.unit::"MeasureUnit", s.mtype::"MeasureType", i.id, now(), now()
FROM _ins s JOIN "Item" i ON i.name = s.iname
WHERE NOT EXISTS (
  SELECT 1 FROM "Measure" m
  WHERE m."itemId" = i.id AND m."measureType"::text = s.mtype
    AND m.value::numeric = s.val AND m.unit::text = s.unit);

-- ---------------------------------------------------------------------------
-- A44. Renames driven by the decoded specs.
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A13','A44-rename','Item', i.id,
       jsonb_build_object('name', i.name),
       jsonb_build_object('name', CASE i.name
         WHEN 'Pistola de Pintura PR 0.7m' THEN 'Pistola de Pintura PR 1.7mm'
         WHEN 'Parafuso Sextavado Zincado UNC' THEN 'Parafuso Sextavado Zincado UNC 3/8'
       END)
FROM "Item" i
WHERE i.name IN ('Pistola de Pintura PR 0.7m','Parafuso Sextavado Zincado UNC');

UPDATE "Item" SET name = 'Pistola de Pintura PR 1.7mm', "updatedAt" = now()
WHERE name = 'Pistola de Pintura PR 0.7m';
UPDATE "Item" SET name = 'Parafuso Sextavado Zincado UNC 3/8', "updatedAt" = now()
WHERE name = 'Parafuso Sextavado Zincado UNC';

-- ---------------------------------------------------------------------------
-- Summary + verification: remaining same-type duplicates (expect only the
-- legitimate ones: ELECTRICAL volt+watt pairs, mixed-bin parafusos, drill-bit
-- diameter sets, Bisnaga volumes, Cavalete dims, dual-width filete).
-- ---------------------------------------------------------------------------
SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A13' GROUP BY step ORDER BY step;

SELECT i.name, m."measureType", count(*), string_agg(m.value::text || ' ' || m.unit::text, ' | ' ORDER BY m.value)
FROM "Measure" m JOIN "Item" i ON i.id = m."itemId"
GROUP BY i.name, m."itemId", m."measureType"
HAVING count(*) > 1
ORDER BY i.name;

COMMIT;
