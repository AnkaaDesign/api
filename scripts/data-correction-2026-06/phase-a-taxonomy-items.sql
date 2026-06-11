-- =============================================================================
-- PHASE A — Taxonomy redesign + item fixes (merges, moves, renames, deactivations)
-- Data correction 2026-06-09. Idempotent: guarded WHERE clauses; re-running is a no-op.
-- All changes are logged to correction_log_20260609 (old values preserved for rollback).
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 -f - < phase-a-taxonomy-items.sql
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
-- A1. Category renames (reuse existing rows so stayer items keep their FK)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _cat_renames (old_name text, new_name text);
INSERT INTO _cat_renames VALUES
  ('Abrasivos',            'Lixas'),
  ('Consumível',           'Produção'),
  ('Cozinha',              'Cozinha e Limpeza'),
  ('Elétrico',             'Elétrica e Iluminação'),
  ('Epi',                  'EPI'),
  ('Ferramenta',           'Ferramentas Manuais'),
  ('Ferramenta Eletronica','Ferramentas Elétricas'),
  ('Material',             'Mascaramento e Cobertura'),
  ('Peça',                 'Peças de Reposição (Caminhões)');

-- guard: ItemCategory.name is UNIQUE (ItemCategory_name_key). If a rename target
-- already exists as a DIFFERENT category while the old name is still present,
-- the UPDATE would die mid-transaction with a raw constraint error — fail loudly
-- and early instead so the operator sees exactly which pair collided.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s -> %s', r.old_name, r.new_name), '; ') INTO bad
  FROM _cat_renames r
  WHERE EXISTS (SELECT 1 FROM "ItemCategory" o WHERE o.name = r.old_name)
    AND EXISTS (SELECT 1 FROM "ItemCategory" n WHERE n.name = r.new_name);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'A1 category-rename collision (target name already taken by another category): %. Resolve manually, then re-run.', bad;
  END IF;
END $$;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A','A1-rename-category','ItemCategory', c.id,
       jsonb_build_object('name', c.name), jsonb_build_object('name', r.new_name)
FROM "ItemCategory" c JOIN _cat_renames r ON r.old_name = c.name;

UPDATE "ItemCategory" c SET name = r.new_name, "updatedAt" = now()
FROM _cat_renames r WHERE c.name = r.old_name;

-- ---------------------------------------------------------------------------
-- A2. Create new categories (NOTE: Ferramentas Pneumáticas is TOOL = borrowable)
-- ---------------------------------------------------------------------------
INSERT INTO "ItemCategory" (id, name, type, "typeOrder", "categoryLevel", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v.name, v.type::"ItemCategoryType", v.torder, 1, now(), now()
FROM (VALUES
  ('Fundos e Primers',                  'REGULAR', 1),
  ('Discos de Corte e Desbaste',        'REGULAR', 1),
  ('Polimento',                         'REGULAR', 1),
  ('Reparo e Preparação',               'REGULAR', 1),
  ('Plotagem',                          'REGULAR', 1),
  ('Embalagem e Expedição',             'REGULAR', 1),
  ('Fixadores',                         'REGULAR', 1),
  ('Ar Comprimido e Conexões',          'REGULAR', 1),
  ('Informática e Eletrônicos',         'REGULAR', 1),
  ('Materiais de Manutenção/Longo Prazo','REGULAR', 1),
  ('Ferramentas Pneumáticas',           'TOOL',    3)
) AS v(name, type, torder)
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = v.name);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, new_value)
SELECT 'A','A2-create-category','ItemCategory', c.id, jsonb_build_object('name', c.name, 'type', c.type)
FROM "ItemCategory" c
WHERE c.name IN ('Fundos e Primers','Discos de Corte e Desbaste','Polimento','Reparo e Preparação',
                 'Plotagem','Embalagem e Expedição','Fixadores','Ar Comprimido e Conexões',
                 'Informática e Eletrônicos','Materiais de Manutenção/Longo Prazo','Ferramentas Pneumáticas')
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step='A2-create-category' AND l.entity_id = c.id);

-- ---------------------------------------------------------------------------
-- A3. Item merges (loser -> survivor). Repoints Activity/Borrow/OrderItem/
--     ExternalWithdrawalItem; transfers quantity; deactivates loser.
--     Measure/MonetaryValue/brand rows stay on the loser (they describe it).
-- ---------------------------------------------------------------------------
-- expected names captured from the 2026-06-10 prod backup. survivor_name_post is
-- the name the A4 renames below produce, accepted so an idempotent re-run passes.
CREATE TEMP TABLE _merges (loser text, survivor text, why text,
                           loser_name text, survivor_name_pre text, survivor_name_post text);
INSERT INTO _merges VALUES
  ('61fb86ca-bb7f-4477-8be7-4ee6bcc84683','58d7af65-e670-4490-90c9-1fb1b5654232','Máscara 7501 duplicada',
   'Máscara Semi Facial Pequena','Máscara Semi Facial Pequena','Máscara Semi Facial Pequena'),
  ('40c4bf81-df10-46da-8ae5-7da9254f6e96','67132f63-8215-4002-bd18-e7700e465edf','Luva Nitrílica M -> Luva Látex M',
   'Caixa Luva Nitrílica M','Caixa Luva Látex-M','Luva Látex M'),
  ('91571283-6965-4125-b717-ce0949f9d433','67132f63-8215-4002-bd18-e7700e465edf','Luva Nitrílica P -> Luva Látex M (P vira M)',
   'Caixa Luva Nitrílica P','Caixa Luva Látex-M','Luva Látex M'),
  ('db02e98b-eb3a-4f70-9ce4-3cd5a1d786f9','67132f63-8215-4002-bd18-e7700e465edf','Luva Química -> Luva Látex M',
   'Luva Química','Caixa Luva Látex-M','Luva Látex M'),
  ('7b4f258c-80fd-46aa-8055-665fd2a1c4a3','12b81549-95a0-482b-bc4a-ed30ff7e0341','Luva Nitrílica G -> Luva Látex G',
   'Caixa Luva Nitrílica G','Caixa Luva Látex-G','Luva Látex G'),
  ('ab0e102e-f859-4a0e-8a24-b4277ee6b2ff','08c4d8a0-6001-4498-be6c-90e4930ddf2f','Luva de Vaqueta -> Luva Anticorte',
   'Luva de Vaqueta','Luva de Proteção Anticorte','Luva de Proteção Anticorte'),
  ('1f6b6ed1-f61e-4a8a-b2bf-d883cd0b79dc','5131671a-ad6b-4c6a-9f80-9f1ea718d045','Bobina Papel Tkv duplicada',
   'Bobina Papel Tkv','Bobina Papel Tk','Bobina Papel TKV'),
  ('d59a3919-ed4a-43cd-8f9b-2fa5d5a2562f','c87c806a-18cc-4e85-a58f-1db6703c5dc1','Bobina Papel Ondulado duplicada',
   'Bobina Papel Ondulado','Papel Corrugado (ondulado)','Papel Corrugado (ondulado)'),
  ('2eb51ba2-3ce1-40fc-a37f-f4848a711a0a','44a3eba4-6494-4881-8cd7-3391392baef3','Pistola K3 unificada',
   'Pistola Pintura K3','Pistola Pintura K3','Pistola de Pintura K3'),
  ('e6cc2d12-4ba7-4f2f-a7b9-eb5a49f111de','5eceb603-c08d-4574-82b6-5dd46a41d87e','Lixadeira Orbital 3M duplicada',
   'Lixadeira Orbital','Lixadeira Orbital','Lixadeira Orbital'),
  ('07c98533-24cf-44b9-99ae-4bafc694c640','7095790b-5d66-432c-b5a5-afbd2e81e74b','Kit Bateria 4.0ah -> Bateria 4.0ah',
   'Kit Bateria 4,0ah','Bateria 4.0ah','Bateria 4.0ah'),
  ('27f14a82-4af7-41a8-9f44-6bea662ae037','96835114-45df-4032-bc45-d9cba12ac336','Bateria 2.0ah duplicada',
   'Bateria 2.0ah','Bateria 2.0ah','Bateria 2.0ah'),
  ('ab763024-0bbb-4f2c-9263-354bd7401a0d','1f44b50c-5241-40d7-878f-1020b308e404','Lanterna Side Marker -> Lanterna Led Âmbar',
   'Lanterna Side Marker Led Âmbar','Lanterna Led Âmbar','Lanterna Led Âmbar');

-- guard: every id must exist AND still carry the name captured from the backup
-- (losers are never renamed by this suite; survivors accept their pre- or
-- post-A4-rename name). A mismatch means prod drifted since the backup or a
-- UUID points at the wrong row — ABORT the whole transaction (skipping is not
-- safe for merges: repointing FKs into the wrong survivor is irreversible).
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(
           format('loser %s=%s (expected %s) / survivor %s=%s (expected %s|%s)',
                  m.loser, COALESCE(l.name,'<MISSING>'), m.loser_name,
                  m.survivor, COALESCE(s.name,'<MISSING>'),
                  m.survivor_name_pre, m.survivor_name_post),
           E'\n') INTO bad
  FROM _merges m
  LEFT JOIN "Item" l ON l.id = m.loser
  LEFT JOIN "Item" s ON s.id = m.survivor
  WHERE l.id IS NULL OR s.id IS NULL
     OR l.name <> m.loser_name
     OR s.name NOT IN (m.survivor_name_pre, m.survivor_name_post);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION E'A3 merge guard failed — id/name drift vs the 2026-06-10 backup, aborting:\n%', bad;
  END IF;
END $$;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A','A3-merge','Item', m.loser,
       jsonb_build_object('quantity', i.quantity, 'isActive', i."isActive",
                          'activities', (SELECT count(*) FROM "Activity" a WHERE a."itemId" = m.loser)),
       jsonb_build_object('survivor', m.survivor, 'why', m.why)
FROM _merges m JOIN "Item" i ON i.id = m.loser
WHERE i."deactivationReason" IS DISTINCT FROM ('Unificado: ' || m.why);

-- record how many transactional rows each merge repoints, BEFORE repointing,
-- so the operation is reconstructible from the log (re-run logs nothing: the
-- loser holds no refs anymore)
CREATE TEMP TABLE _merge_refs AS
SELECT m.loser, m.survivor,
       (SELECT count(*) FROM "Activity"  a WHERE a."itemId" = m.loser) AS activities,
       (SELECT count(*) FROM "Borrow"    b WHERE b."itemId" = m.loser) AS borrows,
       (SELECT count(*) FROM "OrderItem" o WHERE o."itemId" = m.loser) AS order_items,
       0::bigint AS external_op_items
FROM _merges m;

DO $$
DECLARE tbl text;
BEGIN
  tbl := CASE
    WHEN to_regclass('"ExternalWithdrawalItem"') IS NOT NULL THEN 'ExternalWithdrawalItem'
    WHEN to_regclass('"ExternalOperationItem"')  IS NOT NULL THEN 'ExternalOperationItem'
  END;
  IF tbl IS NOT NULL THEN
    EXECUTE format(
      'UPDATE _merge_refs r SET external_op_items = (SELECT count(*) FROM %I e WHERE e."itemId" = r.loser)', tbl);
  END IF;
END $$;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A','A3-merge-fk-repoint','Item', r.loser,
       jsonb_build_object('activities', r.activities, 'borrows', r.borrows,
                          'orderItems', r.order_items, 'externalOperationItems', r.external_op_items),
       jsonb_build_object('survivor', r.survivor)
FROM _merge_refs r
WHERE r.activities + r.borrows + r.order_items + r.external_op_items > 0;

UPDATE "Activity"               a SET "itemId" = m.survivor FROM _merges m WHERE a."itemId" = m.loser;
UPDATE "Borrow"                 b SET "itemId" = m.survivor FROM _merges m WHERE b."itemId" = m.loser;
UPDATE "OrderItem"              o SET "itemId" = m.survivor FROM _merges m WHERE o."itemId" = m.loser;
-- The external-withdrawal table was renamed by migration 20260610090000
-- (ExternalWithdrawalItem -> ExternalOperationItem); update whichever exists.
DO $$
DECLARE tbl text;
BEGIN
  tbl := CASE
    WHEN to_regclass('"ExternalWithdrawalItem"') IS NOT NULL THEN 'ExternalWithdrawalItem'
    WHEN to_regclass('"ExternalOperationItem"')  IS NOT NULL THEN 'ExternalOperationItem'
  END;
  IF tbl IS NOT NULL THEN
    EXECUTE format(
      'UPDATE %I e SET "itemId" = m.survivor FROM _merges m WHERE e."itemId" = m.loser', tbl);
  END IF;
END $$;

UPDATE "Item" s
SET quantity = s.quantity + l.quantity, "updatedAt" = now()
FROM _merges m JOIN "Item" l ON l.id = m.loser
WHERE s.id = m.survivor AND l.quantity <> 0;

UPDATE "Item" l
SET quantity = 0, "isActive" = false,
    "deactivatedAt" = COALESCE(l."deactivatedAt", now()),
    "deactivationReason" = 'Unificado: ' || m.why,
    "updatedAt" = now()
FROM _merges m
WHERE l.id = m.loser
  AND (l.quantity <> 0 OR l."isActive" OR l."deactivationReason" IS DISTINCT FROM ('Unificado: ' || m.why));

-- ---------------------------------------------------------------------------
-- A4. Renames / field fixes
-- ---------------------------------------------------------------------------
-- expected_old_name = name captured from the 2026-06-10 prod backup
CREATE TEMP TABLE _renames (item_id text, expected_old_name text, new_name text);
INSERT INTO _renames VALUES
  ('67132f63-8215-4002-bd18-e7700e465edf','Caixa Luva Látex-M',    'Luva Látex M'),
  ('12b81549-95a0-482b-bc4a-ed30ff7e0341','Caixa Luva Látex-G',    'Luva Látex G'),
  ('5131671a-ad6b-4c6a-9f80-9f1ea718d045','Bobina Papel Tk',       'Bobina Papel TKV'),
  ('44a3eba4-6494-4881-8cd7-3391392baef3','Pistola Pintura K3',    'Pistola de Pintura K3'),
  ('2a8e33b7-7ce3-47bc-98e9-71011d47303c','Rolo Anti Respingo',    'Rolo Anti Respingo 23cm'),
  ('cf036ba0-7271-493a-b2dc-e09c46b9b4f2','Rolo Antirespingo',     'Rolo Anti Respingo 15cm'),
  ('a3f13e41-8577-46db-9568-bd7482ad3e8a','Rolo anti respingo',    'Rolo Anti Respingo 9cm'),
  ('1a35f151-c7d1-4995-9f9b-50b6b0e78d8e','Caixa Pote Redondo',    'Pote Redondo'),
  ('5da4c74f-22d4-459b-861f-e81865bb6c67','Tinta para impressora', 'Tinta para Impressora Preta');

-- guard: each id must exist and be named either the backup name (first run) or
-- the target name (idempotent re-run). Anything else = drift -> ABORT.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s=%s (expected %s|%s)', r.item_id,
                           COALESCE(i.name,'<MISSING>'), r.expected_old_name, r.new_name),
                    E'\n') INTO bad
  FROM _renames r LEFT JOIN "Item" i ON i.id = r.item_id
  WHERE i.id IS NULL OR i.name NOT IN (r.expected_old_name, r.new_name);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION E'A4 rename guard failed — id/name drift vs the 2026-06-10 backup, aborting:\n%', bad;
  END IF;
END $$;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A','A4-rename','Item', i.id, jsonb_build_object('name', i.name), jsonb_build_object('name', r.new_name)
FROM "Item" i JOIN _renames r ON r.item_id = i.id WHERE i.name <> r.new_name;

UPDATE "Item" i SET name = r.new_name, "updatedAt" = now()
FROM _renames r WHERE i.id = r.item_id AND i.name <> r.new_name;

-- uniCode fixes on merge survivors (name-guarded: abort on UUID/name drift)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Item" WHERE id = '44a3eba4-6494-4881-8cd7-3391392baef3'
                   AND name IN ('Pistola Pintura K3','Pistola de Pintura K3')) THEN
    RAISE EXCEPTION 'A4 uniCode guard failed: 44a3eba4 is not Pistola (de) Pintura K3 — drift vs the 2026-06-10 backup, aborting';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Item" WHERE id = '5eceb603-c08d-4574-82b6-5dd46a41d87e'
                   AND name = 'Lixadeira Orbital') THEN
    RAISE EXCEPTION 'A4 uniCode guard failed: 5eceb603 is not Lixadeira Orbital — drift vs the 2026-06-10 backup, aborting';
  END IF;
END $$;
UPDATE "Item" SET "uniCode" = 'PR503',      "updatedAt" = now() WHERE id = '44a3eba4-6494-4881-8cd7-3391392baef3' AND "uniCode" IS DISTINCT FROM 'PR503';
UPDATE "Item" SET "uniCode" = '6in 3/16in', "updatedAt" = now() WHERE id = '5eceb603-c08d-4574-82b6-5dd46a41d87e' AND "uniCode" IS DISTINCT FROM '6in 3/16in';

-- whitespace / trailing-junk hygiene (e.g. 'Faixa Refletiva 3M .', 'Adesivo ', ' Acrilico Preto Cadillac')
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A','A4-trim','Item', id, jsonb_build_object('name', name),
       jsonb_build_object('name', btrim(regexp_replace(name, '\s+\.$', '')))
FROM "Item" WHERE name <> btrim(regexp_replace(name, '\s+\.$', ''));

UPDATE "Item" SET name = btrim(regexp_replace(name, '\s+\.$', '')), "updatedAt" = now()
WHERE name <> btrim(regexp_replace(name, '\s+\.$', ''));

-- PPE coherence: items in PPE category must have ppeType (blocks delivery otherwise)
-- (name-guarded: abort on UUID/name drift vs the 2026-06-10 backup)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Item" WHERE id = '7022c166-d811-43dd-b617-12ba94c261b4'
                   AND name = 'Óculos de Sobrepor Escuro') THEN
    RAISE EXCEPTION 'A4 ppeType guard failed: 7022c166 is not Óculos de Sobrepor Escuro — aborting';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Item" WHERE id = 'b7276d96-d177-46a1-9fd7-5eb7784a0cfe'
                   AND name = 'Máscara Solda/autom') THEN
    RAISE EXCEPTION 'A4 ppeType guard failed: b7276d96 is not Máscara Solda/autom — aborting';
  END IF;
END $$;
UPDATE "Item" SET "ppeType" = 'OTHERS', "updatedAt" = now()
WHERE id = '7022c166-d811-43dd-b617-12ba94c261b4' AND "ppeType" IS NULL;  -- Óculos de Sobrepor Escuro
UPDATE "Item" SET "ppeType" = 'OTHERS', "updatedAt" = now()
WHERE id = 'b7276d96-d177-46a1-9fd7-5eb7784a0cfe' AND "ppeType" IS NULL;  -- Máscara Solda/autom (moves to EPI below)

-- ---------------------------------------------------------------------------
-- A5. Category moves (explicit movers; stayers ride the A1 renames)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _moves (item_id text, cat_name text);
INSERT INTO _moves VALUES
-- Discos de Corte e Desbaste
  ('e8c7b269-d49e-40d4-a3cc-f637fd7c7421','Discos de Corte e Desbaste'), -- Disco Corte Super
  ('de951104-cd26-446b-99f9-f7dcf9b0d2c7','Discos de Corte e Desbaste'), -- Disco Desbaste
  ('144ad293-795d-4b27-8453-0370c351d333','Discos de Corte e Desbaste'), -- Disco Flap Tyrolit
  ('f032acf7-abf6-4573-a25b-24e195abf195','Discos de Corte e Desbaste'), -- Disco de Corte
  ('1f24e751-c062-480a-98ab-193a03e09fbc','Discos de Corte e Desbaste'), -- Escova Aço Motoesmeril
-- Polimento
  ('3489e867-f38f-4776-888e-c53f7727c112','Polimento'), -- Adapitador Boina Polimento
  ('48cb016e-3280-4bdc-a767-80cf8fee07d6','Polimento'), -- Boina Dupla Face
  ('8602aa44-ebd7-4f6c-8565-474fabac71a6','Polimento'), -- Disco Pluma P1500
  ('72f36111-0421-4b49-95d8-0c98e2fbf657','Polimento'), -- Disco Pluma P2000
  ('5ed14552-e460-425a-8c51-21a33359d030','Polimento'), -- Disco Trizact P1000
  ('84c54366-73f7-49b9-81be-53df338a1915','Polimento'), -- Disco Trizact P3000
  ('df78080a-423d-4ad3-a780-c3e1fc8d1d23','Polimento'), -- Massa de Polir
-- Fundos e Primers
  ('65a32b16-bc14-4170-a845-ad101bcc42d1','Fundos e Primers'), -- Primer Pu Preto Rodo
  ('e31a22fd-7621-4e92-9357-5345a780c367','Fundos e Primers'), -- Intercap
  ('549a5919-fc09-4f66-86b7-136b87177c79','Fundos e Primers'), -- Prime PU P/plas
  ('ce1a5983-1f06-44c8-b467-1f9e53af6859','Fundos e Primers'), -- Primer Pu Preto 5x1
  ('02e72ff8-8ef6-4517-85ed-3b143e100b30','Fundos e Primers'), -- Primer Multfill
  ('eec23bf8-b58c-4db2-b67e-64cd9542b2bb','Fundos e Primers'), -- Primer Pu 3000
  ('8fb75c5d-6e81-4f69-95da-10c40db8ffe1','Fundos e Primers'), -- Primer Pu Fast Dry
  ('18afd277-69ce-45ad-9dfd-67c264ce8d85','Fundos e Primers'), -- Primer Spectra P30 Branco
  ('88b35b96-be03-44a4-ac7a-e640f499375e','Fundos e Primers'), -- Primer Spectra P30 Cinza
  ('96e2f769-5f4a-479e-8eb7-278be2d15e23','Fundos e Primers'), -- Wash Primer 517.600
  ('317c256f-66ab-4310-840f-3396d68b61fb','Fundos e Primers'), -- Wash Primer 045
  ('5ac3642e-7329-4f01-88ed-54b6c5fc4c92','Fundos e Primers'), -- Seladora Poliuretano
-- Reparo e Preparação
  ('72b713f7-24a4-47d4-a0aa-61e53aaad172','Reparo e Preparação'), -- Adesivo Selante Cinza U-400
  ('3085ff18-b7a5-42fc-bd6e-13f96d7544a5','Reparo e Preparação'), -- Adesivo Selante Preto U-400
  ('767bfaf1-6551-40ee-bfd8-e3db239fc1f9','Reparo e Preparação'), -- Manta de Fibra de Vidro
  ('be5fd1d4-073c-410f-8fac-b381e5430b9d','Reparo e Preparação'), -- Resina Laminação 4478
  ('4faa7e91-f768-49f0-b332-e5e0f031f882','Reparo e Preparação'), -- Desengripante
  ('3442c9db-ec00-4cad-99d2-17840562b9fc','Reparo e Preparação'), -- Massa Poliester M3500
  ('ebf9d92a-174b-4d82-b139-ad18c9624300','Reparo e Preparação'), -- Super Bonder
  ('e05bb744-89bb-4457-b57d-96c9ba454733','Reparo e Preparação'), -- Trava Rosca 271
  ('b4823d6c-77df-4e38-af5b-4319c4c13ea3','Reparo e Preparação'), -- Espatula Celuloide
  ('7fb5ece1-08cb-42c1-a96b-e907d039459a','Reparo e Preparação'), -- Espatula de Aço
  ('27278f33-b534-4e4a-8450-71a300787ab0','Reparo e Preparação'), -- Espatula Inox (also deactivated below)
  ('14dcc46a-fc06-4b68-a86c-2f79806149fc','Reparo e Preparação'), -- Massa Poliester Fibras 508.800
  ('5ab0c45b-985b-4301-a6d4-7b966b699a88','Reparo e Preparação'), -- Escova de Aço Latonado
  ('5dfee977-4585-4372-be22-485dfd84527a','Reparo e Preparação'), -- Estopa de Pano
  ('91d5a0a1-7419-42b3-af5d-b9e14315c614','Reparo e Preparação'), -- Estopa Algodão
  ('2f8adc79-6a6b-40f1-b99b-df139425377f','Reparo e Preparação'), -- Estopa Fiapo (orphan, inactive)
  ('20676d7b-34f2-42b9-adf4-970aef27df68','Reparo e Preparação'), -- Faixa Refletiva Direita
  ('a886532b-ce81-42ad-b51e-174743be96a7','Reparo e Preparação'), -- Faixa Refletiva Esquerda
  ('9673ce33-d136-4439-91d0-40b9c22d42e2','Reparo e Preparação'), -- Faixa Refletiva 3M Esquerdo
  ('85e03ba8-baba-4cf1-a0c6-0c2a5562a159','Reparo e Preparação'), -- Faixa Refletiva 3M Direita
  ('8d7be8eb-50ae-4638-983e-2613e33c992c','Reparo e Preparação'), -- Faixa Refletiva Lateral Direita
  ('9e8da875-3516-4411-86d4-29ba50c32983','Reparo e Preparação'), -- Faixa Refletiva Lateral Esquerda
  ('27bd8ae8-ccb6-4bba-a913-39330af56e5f','Reparo e Preparação'), -- Faixa Refletiva Para Choque
-- Plotagem
  ('2016e20f-7792-43ac-8648-8f08ea7fe93e','Plotagem'), -- Adesivo 152m
  ('44079426-f9ed-4d7b-b0d2-4c8d7e611da3','Plotagem'), -- Adesivo 127m
  ('d3c7d5ed-f824-4089-b195-8baa58a3195b','Plotagem'), -- Adesivo 106m
  ('78e60411-730c-499f-b7f0-4f55a2b49791','Plotagem'), -- Adesivo Preto Jateado
  ('f9370160-dacf-41c1-accf-c908453a5260','Plotagem'), -- Adesivo Vinil Black
  ('5306ebbd-a8f6-484a-a6e7-bc5e542f12c1','Plotagem'), -- Adesivo Vinil King Blue
  ('d2743d13-d65b-482f-9913-11906378b622','Plotagem'), -- Adesivo Vinil Light Red
  ('6477addd-ba05-4aec-a70a-a6b2bace4460','Plotagem'), -- Adesivo Vinil White
  ('4c1a11a4-6b8f-4f70-bd9c-05c964a34c9e','Plotagem'), -- Adesivo Vinil Yellow
  ('fac8ecb6-d78f-40cb-b1ea-20830c71e004','Plotagem'), -- Espatula Feltro
  ('1993cbdb-4420-49a0-8508-3e1ff72fc58d','Plotagem'), -- Espatula Rigida Adesivo
  ('eb42810b-1eae-463b-b0f4-c55f49faa08e','Plotagem'), -- Estilete Snap Off
  ('d35e0465-4ec8-461b-9361-704ad54c8a4e','Plotagem'), -- Fita Filete Pvc
  ('96769ffd-5bc6-4b30-a7c6-c68302dc6ed6','Plotagem'), -- Fita Dupla Face
  ('2383ca6e-ddd5-4611-8dfc-bae0a268587c','Plotagem'), -- Papel Kraft (pedido do dono)
-- Produção
  ('a155dd9e-71b2-4068-8751-679d37788d3e','Produção'), -- Lamina Norma
  ('9dc26cf3-c1ef-4200-9f2d-223c6dccb9ae','Produção'), -- Copo Pistola de Pintura
  ('59471e86-275a-4c90-9d5a-9aef39ef2c15','Produção'), -- Funil Reto
  ('e156160b-0fde-4c1e-a60d-446e36722d78','Produção'), -- Suporte Garfo Rolo de Pintura
  ('ae030956-8184-4c4d-9f52-a3d40d596012','Produção'), -- Bisnaga Pisseta
  ('1a35f151-c7d1-4995-9f9b-50b6b0e78d8e','Produção'), -- Pote Redondo
  ('4c6a8318-9410-4d39-803f-25d5815edd0c','Produção'), -- Copo Cristal 145ml
  ('5617eccd-6fac-4087-b013-6444fb158245','Produção'), -- Copo Cristal 770ml
  ('5452105b-6a8a-4f94-805f-62c01803959d','Produção'), -- Garrafa Quadrada 002
  ('d0ae6e57-8567-4b72-a00d-b49766299fb9','Produção'), -- Garrafa Quadrada 001
  ('92083b00-ddcd-49b8-be37-db2e70aa8e2b','Produção'), -- Garrafa Quadrada 004
  ('b4d313c5-6bc7-455a-9582-a824bce79aec','Produção'), -- Pincel
  ('63609fc9-aab8-41e0-9e8d-9bbb526f4584','Produção'), -- Refil de Maçarico
  ('2a8e33b7-7ce3-47bc-98e9-71011d47303c','Produção'), -- Rolo Anti Respingo 23cm
  ('cf036ba0-7271-493a-b2dc-e09c46b9b4f2','Produção'), -- Rolo Anti Respingo 15cm
  ('a3f13e41-8577-46db-9568-bd7482ad3e8a','Produção'), -- Rolo Anti Respingo 9cm (inativo)
  ('12058269-919e-4900-afb1-8e74704ac73c','Produção'), -- Suporte para Pistola a-36
  ('ee6990fa-18ed-4db9-8376-204d8c541c07','Produção'), -- Tampa Para Bisnaga
  ('7b3c8ed9-bb68-4e03-a8c8-58eb48a4d383','Produção'), -- Carvão Em Pó
  ('35370500-b14a-47d8-8753-f01e1231339a','Produção'), -- Lapis 6b
-- Embalagem e Expedição
  ('c87c806a-18cc-4e85-a58f-1db6703c5dc1','Embalagem e Expedição'), -- Papel Corrugado (ondulado)
  ('2a326e73-f5c1-4443-bfa0-6969a9f07202','Embalagem e Expedição'), -- Bobina Plástico Bolha
  ('578f9d08-f450-47ac-bb76-dd2641d41123','Embalagem e Expedição'), -- Fitilho Reciclado
  ('25b34320-f513-4792-a45d-be02e6f9519e','Embalagem e Expedição'), -- Rolo Etiqueta
  ('20c6b85a-78d2-4118-b8d4-c4fcd1996f03','Embalagem e Expedição'), -- Rolo de Fita Para Arquear
  ('25881152-1e74-45db-8ed1-850ec4e96af0','Embalagem e Expedição'), -- Selo Metalico Para Arquear
-- Ferramentas Pneumáticas
  ('11fa7e9b-47c0-4ae1-a298-e2539f3439e0','Ferramentas Pneumáticas'), -- Aerógrafo AJ008
  ('0e0b0c84-70dd-4ef2-9ab0-4edf176da22b','Ferramentas Pneumáticas'), -- Aplicador Calafetador Pneumático
  ('bf0a96db-f467-41f8-95f3-a3bbacb191ea','Ferramentas Pneumáticas'), -- Bico de Ar DG-10
  ('5eceb603-c08d-4574-82b6-5dd46a41d87e','Ferramentas Pneumáticas'), -- Lixadeira Orbital 3M (survivor)
  ('44a3eba4-6494-4881-8cd7-3391392baef3','Ferramentas Pneumáticas'), -- Pistola de Pintura K3
  ('882caa20-9b48-42c7-8b61-5baafb1e910e','Ferramentas Pneumáticas'), -- Pistola de Pintura PRO-534
  ('19107c18-b1bf-4216-9cc3-fd5b402fea83','Ferramentas Pneumáticas'), -- Pistola de Pintura PR .7m
  ('7292888c-1e61-4a7d-b9c5-b57b7d2c00d1','Ferramentas Pneumáticas'), -- Rebitadeira Pneumatica PRO-316
  ('c4847cca-9f93-4b15-8d6d-c8cb823160c0','Ferramentas Pneumáticas'), -- Rebitadeira de Rosca Pneumatica
  ('63a068bb-b4a1-4587-92f2-a5074fe851dd','Ferramentas Pneumáticas'), -- Hookit
  ('5f659e67-37d9-4b78-960e-e89e34649262','Ferramentas Pneumáticas'), -- Base Hookit DR6-006
-- Ferramentas Manuais (consumíveis que são bits/soquetes)
  -- Bits/soquetes are CONSUMABLES (owner decision 2026-06-09): they live in
  -- Produção so consumption-based replenishment applies; placing them in a
  -- TOOL category would make the capability-fields migration backfill them
  -- as FIXED_TARGET and silently kill their replenishment.
  ('b3a8c4c2-4851-4e8e-9c2e-0f97e29fb38a','Produção'), -- Bit T-27
  ('3544bae3-046d-44ea-a756-5db254c948af','Produção'), -- Bit T-30
  ('32025e86-656d-4581-ab78-830f55894908','Produção'), -- Bit T-45
  ('8c11b732-147d-4d33-b19c-f06455386dcd','Produção'), -- Soquete Torx T-45
-- Cozinha e Limpeza
  ('b3beeb4f-4c2c-4130-9a3b-072d473e4a78','Cozinha e Limpeza'), -- Creme Desengraxante
  ('cb0c60bc-9a2c-4dd7-88f2-7cc3dc0321ee','Cozinha e Limpeza'), -- Vassoura de Palha
  ('886a5ef8-1122-4911-aad4-907774ee2476','Cozinha e Limpeza'), -- Pacote Saco de Lixo 200 lts
-- Elétrica e Iluminação
  ('272612b2-f6ac-4868-be3a-5f8c5de7f996','Elétrica e Iluminação'), -- Fita Isolante
  ('d21bc0a9-04e6-4174-a60b-a81cfdab7d00','Elétrica e Iluminação'), -- Refletor Led
  ('1fefca59-3bf6-4b50-b68d-58fd82b105b6','Elétrica e Iluminação'), -- Refletor Led 50w
  ('2dbc786c-314f-47a2-9047-7057a49c0ba2','Elétrica e Iluminação'), -- Plugue Fêmea
  ('ce75f3c4-b1d0-4190-83a5-54ef22825cbb','Elétrica e Iluminação'), -- Plugue Macho
-- Ar Comprimido e Conexões
  ('45e7700f-853c-461d-a258-6bd53d8c6e00','Ar Comprimido e Conexões'), -- Fita Veda Rosca
  ('f7200639-3f95-4e2d-bf49-3cdb80f037fe','Ar Comprimido e Conexões'), -- Suporte de Mangueira
  ('4caec459-c79c-4074-8de2-3b625c1119f3','Ar Comprimido e Conexões'), -- Mangueira de Ar
  ('65618b97-6168-4453-af4e-6ea49b4d0578','Ar Comprimido e Conexões'), -- Bucha de Redução
  ('3d817d04-9b7a-4353-9ce4-26fc92703bd4','Ar Comprimido e Conexões'), -- Engate Rapido Fêmea SP-40
  ('48c0957c-d297-40ee-8b6e-f618626e7bd9','Ar Comprimido e Conexões'), -- Engate Rapido Macho PP-40
  ('bcd5e2be-d505-4a32-8b8b-0742dd18e63c','Ar Comprimido e Conexões'), -- Engate Rapido Macho PM-20
  ('a16f8637-b4e3-4e75-a674-2491fb60b6b3','Ar Comprimido e Conexões'), -- Engate Rapido Macho PF-20
  ('209a5ceb-d7f1-4905-b8e8-6c3fce1b3ab4','Ar Comprimido e Conexões'), -- Engate Rápido Macho SM-40
  ('98c615cd-0cb5-4659-8451-1bbd799add3b','Ar Comprimido e Conexões'), -- Filtro Compressor
  ('7b8fb73f-5816-4680-9ca0-13848f26f10f','Ar Comprimido e Conexões'), -- Manômetro REB40-04M
  ('403754b8-cc49-4340-97b9-52368949c851','Ar Comprimido e Conexões'), -- Niple Duplo Galv
  ('03b98975-98ac-490b-b2a7-4fdf05e6422c','Ar Comprimido e Conexões'), -- Regulador de Pressão RE40-04
  ('1fb88b25-b4fa-4572-ad6c-0f107171bd07','Ar Comprimido e Conexões'), -- Valvula Esferica Latão 1/2
  ('b24a723b-35cb-4f07-a477-8e2b969174e9','Ar Comprimido e Conexões'), -- Valvula Esferica Latão 3/4
-- Fixadores
  ('56c9ac4d-bd00-4d71-a343-a776a70aa2f7','Fixadores'), -- Abraçadeira Nylon Preta 200x2,5
  ('3778bce6-8b3e-4f51-9131-c05f0974c467','Fixadores'), -- Abraçadeira Nylon Preta 200x4,6
  ('a339e958-2eeb-4ff9-a13c-cf01c57cb4a9','Fixadores'), -- Abraçadeira Nylon Preta 300x7,2
  ('80c5e82f-a7d1-46f2-a93d-9b68e8e54e2f','Fixadores'), -- Arruela Lisa Zincada 1/4
  ('7744f313-4c43-41ef-bc13-daccb1ba383b','Fixadores'), -- Arruela Lisa Zincada 3/16
  ('9fa1c485-5e5d-4f29-b00d-4985f4587e55','Fixadores'), -- Arruela Lisa Zincada 5/16
  ('92642a1c-7d77-4e79-9162-183eb19a8c00','Fixadores'), -- Arruela Pressão Média 5/16
  ('e589681b-9206-41d2-8096-b70d3f5b4e1e','Fixadores'), -- Arruela zincada 10mm
  ('3d5077ae-2e06-4424-89b9-d2bf27cba6db','Fixadores'), -- Parafuso Sextavado Inox 6x20
  ('1015a6bb-3143-49cf-8bdf-9d8aedb8fdbd','Fixadores'), -- Parafuso Allen Inox 10x25
  ('0a5497ba-8d43-4ec5-8791-b7299dda1b8a','Fixadores'), -- Parafuso Allen M06
  ('83b17ddd-97e1-43b0-9be4-ead4c1fcf0a9','Fixadores'), -- Parafuso Sextavado Inox
  ('69f177f5-8613-43c2-93e0-1dae19a75c8c','Fixadores'), -- Parafuso Sextavado Inox 5/16x7/8
  ('11523546-ea3d-4639-bd38-be41341891cd','Fixadores'), -- Parafuso Sextavado Inox 5/16x1
  ('1221d6ad-ac04-4b34-b885-bec6883aa9bc','Fixadores'), -- Parafuso Sextavado Zincado UNC
  ('84c6676b-b8a5-4f7a-bbf1-b25f8b5bc596','Fixadores'), -- Parafuso Sextavado Zincado
  ('44e07b61-f7b8-413d-9420-1c547382424d','Fixadores'), -- Parafuso Torx Inox
  ('1b3bcb5d-e14c-4f19-b884-e7a6e73789e3','Fixadores'), -- Rebite Rosca Lisa M10
  ('98be5acf-c998-418a-9533-abdf49fb70b7','Fixadores'), -- Rebite Rosca Lisa
  ('172bf5f8-0e36-476c-bd29-1887c33a5f3f','Fixadores'), -- Rebite Rosca Sextavado 630
  ('26a543fd-f577-4211-a082-89edbe06f0b5','Fixadores'), -- Rebite de Repuxo 516
  ('7f327dee-cd14-47a1-9c8a-70b3ab8adb1f','Fixadores'), -- Rebite de Repuxo 525
  ('d3e3b74f-4ea0-413d-ba9e-c20a7f20b165','Fixadores'), -- Rebite de Repuxo 619
  ('067eae2e-2294-4b49-b0a5-07a4e099f02b','Fixadores'), -- Rebite de Repuxo 640
-- Informática e Eletrônicos
  ('cbb5aace-d1e9-4e0a-8333-cf777a3add45','Informática e Eletrônicos'), -- Power Bank
  ('5da4c74f-22d4-459b-861f-e81865bb6c67','Informática e Eletrônicos'), -- Tinta para Impressora Preta
  ('8eebd2c8-6bb5-4bd7-b82b-5782540694e3','Informática e Eletrônicos'), -- Pilha AAA
-- Materiais de Manutenção/Longo Prazo
  ('cc6c17ef-5f16-4f40-a083-899b6b659278','Materiais de Manutenção/Longo Prazo'), -- Mangueira Irrigação
  ('7aac9e04-69be-4193-8387-acc887c67b66','Materiais de Manutenção/Longo Prazo'), -- Mangueira de Água
  ('3d0e526f-a586-4e74-b957-2a67da8903e4','Materiais de Manutenção/Longo Prazo'), -- Chapa Compensado Fenólico
-- Mascaramento e Cobertura
  ('a80f70d7-ce9c-4eed-b399-c30101e23508','Mascaramento e Cobertura'), -- Rolo de Lona Plastica
  ('7f6f3c51-c00b-43a3-8865-e0e3e7b141ac','Mascaramento e Cobertura'), -- Líq. de Mascaramento 506.000
-- EPI / Tinta
  ('b7276d96-d177-46a1-9fd7-5eb7784a0cfe','EPI'),  -- Máscara Solda
  ('e293cfbc-6ad8-4bd3-b34c-4ca4951ae8b6','Tinta');-- Preto Fosco Chassi

-- Abraçadeira Nylon Natural: resolve by name (its reported id was unreliable)
INSERT INTO _moves
SELECT i.id, 'Fixadores' FROM "Item" i
WHERE i.name ILIKE 'Abraçadeira Nylon Natural%'
  AND NOT EXISTS (SELECT 1 FROM _moves m WHERE m.item_id = i.id);

-- pre-flight guard for the 160 hardcoded move ids: verify each id still exists
-- and still carries the name captured from the 2026-06-10 prod backup
-- (backup_name) OR the name this correction suite itself produces on a re-run
-- (current_name — A4/A13/A18/A21/A39/A44/A46 renames). Comparison is
-- whitespace/trailing-dot normalized because the A4-trim above runs in this
-- same file. A few mismatches are tolerated (users may legitimately rename an
-- item in the app; the UUID still identifies it) but bulk drift aborts.
CREATE TEMP TABLE _move_expect (item_id text, backup_name text, current_name text);
INSERT INTO _move_expect VALUES
  ('02e72ff8-8ef6-4517-85ed-3b143e100b30','Primer Multfill','Primer Multfill'),
  ('03b98975-98ac-490b-b2a7-4fdf05e6422c','Regulador de Pressão','Regulador de Pressão'),
  ('067eae2e-2294-4b49-b0a5-07a4e099f02b','Rebite de Repuxo 640','Rebite de Repuxo 640'),
  ('0a5497ba-8d43-4ec5-8791-b7299dda1b8a','Parafuso Allen M06 X 0,40','Parafuso Allen M06 X 0,40'),
  ('0e0b0c84-70dd-4ef2-9ab0-4edf176da22b','Aplicador Calafetador Pneumático','Aplicador Calafetador Pneumático'),
  ('1015a6bb-3143-49cf-8bdf-9d8aedb8fdbd','Parafuso Allen Inox 10x25','Parafuso Allen Inox 10x25'),
  ('11523546-ea3d-4639-bd38-be41341891cd','Parafuso Sextavado Inox 5/16x1','Parafuso Sextavado Inox 5/16x1'),
  ('11fa7e9b-47c0-4ae1-a298-e2539f3439e0','Aerógrafo','Aerógrafo'),
  ('12058269-919e-4900-afb1-8e74704ac73c','Suporte para Pistola','Suporte para Pistola'),
  ('1221d6ad-ac04-4b34-b885-bec6883aa9bc','Parafuso Sextavado Zincado','Parafuso Sextavado Zincado UNC 3/8'),
  ('144ad293-795d-4b27-8453-0370c351d333','Disco Flap Tyrolit','Disco Flap Tyrolit'),
  ('14dcc46a-fc06-4b68-a86c-2f79806149fc','Massa Poliester Fibras','Massa Poliester Fibras'),
  ('172bf5f8-0e36-476c-bd29-1887c33a5f3f','Rebite Rosca Sextavado 630','Rebite Rosca Sextavado 630'),
  ('18afd277-69ce-45ad-9dfd-67c264ce8d85','Primer Spectra 2k','Primer Spectra 2k P30 Branco'),
  ('19107c18-b1bf-4216-9cc3-fd5b402fea83','Pistola de Pintura','Pistola de Pintura PR 1.7mm'),
  ('1993cbdb-4420-49a0-8508-3e1ff72fc58d','Espatula Rigida Adesivo','Espatula Rigida Adesivo'),
  ('1a35f151-c7d1-4995-9f9b-50b6b0e78d8e','Caixa Pote Redondo','Pote Redondo'),
  ('1b3bcb5d-e14c-4f19-b884-e7a6e73789e3','Rebite Rosca Lisa','Rebite Rosca Lisa M10'),
  ('1f24e751-c062-480a-98ab-193a03e09fbc','Escova Aço Motoesmeril','Escova Aço Motoesmeril'),
  ('1fb88b25-b4fa-4572-ad6c-0f107171bd07','Valvula Esferica Latão 1/2','Valvula Esferica Latão 1/2'),
  ('1fefca59-3bf6-4b50-b68d-58fd82b105b6','Refletor Led 50w-6500k','Refletor Led 50w-6500k'),
  ('2016e20f-7792-43ac-8648-8f08ea7fe93e','Adesivo','Adesivo Vinil 1,52m'),
  ('20676d7b-34f2-42b9-adf4-970aef27df68','Faixa Refletiva','Faixa Refletiva Esquerda'),
  ('209a5ceb-d7f1-4905-b8e8-6c3fce1b3ab4','Engate Rápido Macho','Engate Rápido Macho'),
  ('20c6b85a-78d2-4118-b8d4-c4fcd1996f03','Rolo de Fita Para Arquear','Rolo de Fita Para Arquear'),
  ('2383ca6e-ddd5-4611-8dfc-bae0a268587c','Papel Kraft','Papel Kraft'),
  ('25881152-1e74-45db-8ed1-850ec4e96af0','Selo Metalico Para Arquear','Selo Metalico Para Arquear'),
  ('25b34320-f513-4792-a45d-be02e6f9519e','Rolo Etiqueta','Rolo Etiqueta'),
  ('26a543fd-f577-4211-a082-89edbe06f0b5','Rebite de Repuxo 516','Rebite de Repuxo 516'),
  ('272612b2-f6ac-4868-be3a-5f8c5de7f996','Fita Isolante','Fita Isolante'),
  ('27278f33-b534-4e4a-8450-71a300787ab0','Espatula Inox/12cm Cab Pvc','Espatula Inox/12cm Cab Pvc'),
  ('27bd8ae8-ccb6-4bba-a913-39330af56e5f','Faixa Refletiva Para Choque','Faixa Refletiva Para Choque'),
  ('2a326e73-f5c1-4443-bfa0-6969a9f07202','Bobina Plástico Bolha','Bobina Plástico Bolha'),
  ('2a8e33b7-7ce3-47bc-98e9-71011d47303c','Rolo Anti Respingo','Rolo Anti Respingo 23cm'),
  ('2dbc786c-314f-47a2-9047-7057a49c0ba2','Plugue Fêmea','Plugue Fêmea'),
  ('2f8adc79-6a6b-40f1-b99b-df139425377f','Estopa Fiapo','Estopa Fiapo'),
  ('3085ff18-b7a5-42fc-bd6e-13f96d7544a5','Adesivo Selante Preto','Adesivo Selante Preto'),
  ('317c256f-66ab-4310-840f-3396d68b61fb','Wash Primer','Wash Primer 045'),
  ('32025e86-656d-4581-ab78-830f55894908','Bit T-45','Bit T-45'),
  ('3442c9db-ec00-4cad-99d2-17840562b9fc','Massa Poliester','Massa Poliester'),
  ('3489e867-f38f-4776-888e-c53f7727c112','Adapitador Boina Polimento','Adaptador Boina Polimento'),
  ('35370500-b14a-47d8-8753-f01e1231339a','Lapis 6b','Lapis 6b'),
  ('3544bae3-046d-44ea-a756-5db254c948af','Bit T-30','Bit T-30'),
  ('3778bce6-8b3e-4f51-9131-c05f0974c467','Abraçadeira Nylon Preta','Abraçadeira Nylon Preta 200x4,6mm'),
  ('3d0e526f-a586-4e74-b957-2a67da8903e4','Chapa Compensado Fenólico','Chapa Compensado Fenólico'),
  ('3d5077ae-2e06-4424-89b9-d2bf27cba6db','Parafuso Sextavado Inox 6x20 8.8','Parafuso Sextavado Inox 6x20 8.8'),
  ('3d817d04-9b7a-4353-9ce4-26fc92703bd4','Engate Rapido Fêmea','Engate Rapido Fêmea'),
  ('403754b8-cc49-4340-97b9-52368949c851','Niple Duplo Galv','Niple Duplo Galv'),
  ('44079426-f9ed-4d7b-b0d2-4c8d7e611da3','Adesivo','Adesivo Vinil 1,27m'),
  ('44a3eba4-6494-4881-8cd7-3391392baef3','Pistola Pintura K3','Pistola de Pintura K3'),
  ('44e07b61-f7b8-413d-9420-1c547382424d','Parafuso Torx Inox','Parafuso Torx Inox'),
  ('45e7700f-853c-461d-a258-6bd53d8c6e00','Fita Veda Rosca','Fita Veda Rosca'),
  ('48c0957c-d297-40ee-8b6e-f618626e7bd9','Engate Rapido Macho','Engate Rapido Macho'),
  ('48cb016e-3280-4bdc-a767-80cf8fee07d6','Boina Dupla Face p/ Polimento','Boina Dupla Face p/ Polimento'),
  ('4c1a11a4-6b8f-4f70-bd9c-05c964a34c9e','Adesivo Vinil Yellow','Adesivo Vinil Yellow'),
  ('4c6a8318-9410-4d39-803f-25d5815edd0c','Copo Cristal 145ml','Copo Cristal 145ml'),
  ('4caec459-c79c-4074-8de2-3b625c1119f3','Mangueira de Ar','Mangueira de Ar'),
  ('4faa7e91-f768-49f0-b332-e5e0f031f882','Desengripante','Desengripante'),
  ('5306ebbd-a8f6-484a-a6e7-bc5e542f12c1','Adesivo Vinil King Blue','Adesivo Vinil King Blue'),
  ('5452105b-6a8a-4f94-805f-62c01803959d','Garrafa Quadrada','Garrafa Quadrada 500ml'),
  ('549a5919-fc09-4f66-86b7-136b87177c79','Prime PU P/plas 1k (3,6L)','Prime PU P/plas 1k (3,6L)'),
  ('5617eccd-6fac-4087-b013-6444fb158245','Copo Cristal 770ml','Copo Cristal 770ml'),
  ('56c9ac4d-bd00-4d71-a343-a776a70aa2f7','Abraçadeira Nylon Preta','Abraçadeira Nylon Preta 200x2,5mm'),
  ('578f9d08-f450-47ac-bb76-dd2641d41123','Fitilho Reciclado','Fitilho Reciclado'),
  ('59471e86-275a-4c90-9d5a-9aef39ef2c15','Funil Reto','Funil Reto'),
  ('5ab0c45b-985b-4301-a6d4-7b966b699a88','Escova de Aço Latonado','Escova de Aço Latonado'),
  ('5ac3642e-7329-4f01-88ed-54b6c5fc4c92','Seladora Poliuretano','Seladora Poliuretano'),
  ('5da4c74f-22d4-459b-861f-e81865bb6c67','Tinta para impressora','Tinta para Impressora Preta'),
  ('5dfee977-4585-4372-be22-485dfd84527a','Estopa de Pano','Estopa de Pano'),
  ('5eceb603-c08d-4574-82b6-5dd46a41d87e','Lixadeira Orbital','Lixadeira Orbital'),
  ('5ed14552-e460-425a-8c51-21a33359d030','Disco Trizact P1000','Disco Trizact P1000'),
  ('5f659e67-37d9-4b78-960e-e89e34649262','Base Hookit','Base Hookit'),
  ('63609fc9-aab8-41e0-9e8d-9bbb526f4584','Refil de Maçarico','Refil de Maçarico'),
  ('63a068bb-b4a1-4587-92f2-a5074fe851dd','Hookit','Hookit'),
  ('6477addd-ba05-4aec-a70a-a6b2bace4460','Adesivo Vinil White','Adesivo Vinil White'),
  ('65618b97-6168-4453-af4e-6ea49b4d0578','Bucha de Redução','Bucha de Redução'),
  ('65a32b16-bc14-4170-a845-ad101bcc42d1','Primer Pu Preto Rodo','Primer Pu Preto Rodo'),
  ('69f177f5-8613-43c2-93e0-1dae19a75c8c','Parafuso Sextavado Inox 5/16 X 7/8','Parafuso Sextavado Inox 5/16 X 7/8'),
  ('7292888c-1e61-4a7d-b9c5-b57b7d2c00d1','Rebitadeira Pneumatica','Rebitadeira Pneumatica'),
  ('72b713f7-24a4-47d4-a0aa-61e53aaad172','Adesivo Selante Cinza','Adesivo Selante Cinza'),
  ('72f36111-0421-4b49-95d8-0c98e2fbf657','Disco Pluma P2000 (polimento)','Disco Pluma P2000 (polimento)'),
  ('767bfaf1-6551-40ee-bfd8-e3db239fc1f9','Manta de Fibra de Vidro','Manta de Fibra de Vidro'),
  ('7744f313-4c43-41ef-bc13-daccb1ba383b','Arruela Lisa Zincada 3/16','Arruela Lisa Zincada 3/16'),
  ('78e60411-730c-499f-b7f0-4f55a2b49791','Adesivo Preto Jateado','Adesivo Preto Jateado'),
  ('7aac9e04-69be-4193-8387-acc887c67b66','Mangueira de Água','Mangueira de Água'),
  ('7b3c8ed9-bb68-4e03-a8c8-58eb48a4d383','Carvão Em Pó','Carvão Em Pó'),
  ('7b8fb73f-5816-4680-9ca0-13848f26f10f','Manômetro','Manômetro'),
  ('7f327dee-cd14-47a1-9c8a-70b3ab8adb1f','Rebite de Repuxo 525','Rebite de Repuxo 525'),
  ('7f6f3c51-c00b-43a3-8865-e0e3e7b141ac','Líq. de Mascaramento','Líq. de Mascaramento'),
  ('7fb5ece1-08cb-42c1-a96b-e907d039459a','Espatula de Aço','Espatula de Aço'),
  ('80c5e82f-a7d1-46f2-a93d-9b68e8e54e2f','Arruela Lisa Zincada 1/4','Arruela Lisa Zincada 1/4'),
  ('83b17ddd-97e1-43b0-9be4-ead4c1fcf0a9','Parafuso Sextavado Inox','Parafuso Sextavado Inox'),
  ('84c54366-73f7-49b9-81be-53df338a1915','Disco de polir Trizact P3000','Disco de polir Trizact P3000'),
  ('84c6676b-b8a5-4f7a-bbf1-b25f8b5bc596','Parafuso Sextavado Zincado','Parafuso Sextavado Zincado'),
  ('85e03ba8-baba-4cf1-a0c6-0c2a5562a159','Faixa Refletiva 3M .','Faixa Refletiva 3M Esquerda'),
  ('8602aa44-ebd7-4f6c-8565-474fabac71a6','Disco Pluma P1500 (polimento)','Disco Pluma P1500 (polimento)'),
  ('882caa20-9b48-42c7-8b61-5baafb1e910e','Pistola de Pintura','Pistola de Pintura PRO-534'),
  ('886a5ef8-1122-4911-aad4-907774ee2476','Pacote Saco de Lixo 200 lts','Pacote Saco de Lixo 200 lts'),
  ('88b35b96-be03-44a4-ac7a-e640f499375e','Primer Spectra 2k','Primer Spectra 2k P30 Cinza'),
  ('8c11b732-147d-4d33-b19c-f06455386dcd','Soquete Torx T-45','Soquete Torx T-45'),
  ('8d7be8eb-50ae-4638-983e-2613e33c992c','Faixa Refletiva Lateral Direita','Faixa Refletiva Lateral Direita'),
  ('8eebd2c8-6bb5-4bd7-b82b-5782540694e3','Pilha','Pilha'),
  ('8fb75c5d-6e81-4f69-95da-10c40db8ffe1','Primer Pu Fast Dry','Primer Pu Fast Dry'),
  ('91d5a0a1-7419-42b3-af5d-b9e14315c614','Estopa Algodão','Estopa Algodão'),
  ('92083b00-ddcd-49b8-be37-db2e70aa8e2b','Garrafa Quadrada','Garrafa Quadrada 1L'),
  ('92642a1c-7d77-4e79-9162-183eb19a8c00','Arruela Pressão Média 5/16','Arruela Pressão Média 5/16'),
  ('9673ce33-d136-4439-91d0-40b9c22d42e2','Faixa Refletiva 3M','Faixa Refletiva 3M Direita'),
  ('96769ffd-5bc6-4b30-a7c6-c68302dc6ed6','Fita Dupla Face','Fita Dupla Face'),
  ('96e2f769-5f4a-479e-8eb7-278be2d15e23','Wash Primer','Wash Primer 517.600'),
  ('98be5acf-c998-418a-9533-abdf49fb70b7','Rebite Rosca Lisa','Rebite Rosca Lisa'),
  ('98c615cd-0cb5-4659-8451-1bbd799add3b','Filtro Compressor','Filtro Compressor'),
  ('9dc26cf3-c1ef-4200-9f2d-223c6dccb9ae','Copo Pistola de Pintura','Copo Pistola de Pintura'),
  ('9e8da875-3516-4411-86d4-29ba50c32983','Faixa Refletiva Lateral Esquerda','Faixa Refletiva Lateral Esquerda'),
  ('9fa1c485-5e5d-4f29-b00d-4985f4587e55','Arruela Lisa Zincada 5/16','Arruela Lisa Zincada 5/16'),
  ('a155dd9e-71b2-4068-8751-679d37788d3e','Lamina Norma','Lamina Norma'),
  ('a16f8637-b4e3-4e75-a674-2491fb60b6b3','Engate Rapido Macho (int)','Engate Rapido Macho (int)'),
  ('a339e958-2eeb-4ff9-a13c-cf01c57cb4a9','Abraçadeira Nylon Preta','Abraçadeira Nylon Preta 300x7,2mm'),
  ('a3f13e41-8577-46db-9568-bd7482ad3e8a','Rolo anti respingo','Rolo Anti Respingo 9cm'),
  ('a80f70d7-ce9c-4eed-b399-c30101e23508','Rolo de Lona Plastica','Rolo de Lona Plastica'),
  ('a886532b-ce81-42ad-b51e-174743be96a7','Faixa Refletiva','Faixa Refletiva Direita'),
  ('ae030956-8184-4c4d-9f52-a3d40d596012','Bisnaga Pisseta','Bisnaga Pisseta'),
  ('b24a723b-35cb-4f07-a477-8e2b969174e9','Valvula Esferica Latão 3/4','Valvula Esferica Latão 3/4'),
  ('b3a8c4c2-4851-4e8e-9c2e-0f97e29fb38a','Bit T-27','Bit T-27'),
  ('b3beeb4f-4c2c-4130-9a3b-072d473e4a78','Creme Desengraxante','Creme Desengraxante'),
  ('b4823d6c-77df-4e38-af5b-4319c4c13ea3','Espatula Celuloide','Espatula Celuloide'),
  ('b4d313c5-6bc7-455a-9582-a824bce79aec','Pincel','Pincel'),
  ('b7276d96-d177-46a1-9fd7-5eb7784a0cfe','Máscara Solda/autom','Máscara Solda/autom'),
  ('bcd5e2be-d505-4a32-8b8b-0742dd18e63c','Engate Rapido Macho (ext)','Engate Rapido Macho (ext)'),
  ('be5fd1d4-073c-410f-8fac-b381e5430b9d','Resina Laminação','Resina Laminação'),
  ('bf0a96db-f467-41f8-95f3-a3bbacb191ea','Bico de Ar','Bico de Ar'),
  ('c4847cca-9f93-4b15-8d6d-c8cb823160c0','Rebitadeira de Rosca Pneumatica','Rebitadeira de Rosca Pneumatica'),
  ('c87c806a-18cc-4e85-a58f-1db6703c5dc1','Papel Corrugado (ondulado)','Papel Corrugado (ondulado)'),
  ('cb0c60bc-9a2c-4dd7-88f2-7cc3dc0321ee','Vassoura de Palha','Vassoura de Palha'),
  ('cbb5aace-d1e9-4e0a-8333-cf777a3add45','Power Bank Portátil 5000mAh sem fio 20W','Power Bank Portátil 5000mAh sem fio 20W'),
  ('cc6c17ef-5f16-4f40-a083-899b6b659278','Mangueira Irrigação','Mangueira Irrigação'),
  ('ce1a5983-1f06-44c8-b467-1f9e53af6859','Primer Pu Preto 5x1','Primer Pu Preto 5x1'),
  ('ce75f3c4-b1d0-4190-83a5-54ef22825cbb','Plugue Macho','Plugue Macho'),
  ('cf036ba0-7271-493a-b2dc-e09c46b9b4f2','Rolo Antirespingo','Rolo Anti Respingo 15cm'),
  ('d0ae6e57-8567-4b72-a00d-b49766299fb9','Garrafa Quadrada','Garrafa Quadrada 300ml'),
  ('d21bc0a9-04e6-4174-a60b-a81cfdab7d00','Refletor Led','Refletor Led'),
  ('d2743d13-d65b-482f-9913-11906378b622','Adesivo Vinil Light Red','Adesivo Vinil Light Red'),
  ('d35e0465-4ec8-461b-9361-704ad54c8a4e','Fita Filete Pvc','Fita Filete Pvc'),
  ('d3c7d5ed-f824-4089-b195-8baa58a3195b','Adesivo ','Adesivo Vinil 1,06m'),
  ('d3e3b74f-4ea0-413d-ba9e-c20a7f20b165','Rebite de Repuxo 619','Rebite de Repuxo 619'),
  ('de951104-cd26-446b-99f9-f7dcf9b0d2c7','Disco Desbaste','Disco Desbaste'),
  ('df78080a-423d-4ad3-a780-c3e1fc8d1d23','Massa de Polir','Massa de Polir'),
  ('e05bb744-89bb-4457-b57d-96c9ba454733','Trava Rosca','Trava Rosca'),
  ('e156160b-0fde-4c1e-a60d-446e36722d78','Suporte Garfo Rolo de Pintura','Suporte Garfo Rolo de Pintura'),
  ('e293cfbc-6ad8-4bd3-b34c-4ca4951ae8b6','Preto Fosco Chassi','Preto Fosco Chassi'),
  ('e31a22fd-7621-4e92-9357-5345a780c367','Intercap','Intercap'),
  ('e589681b-9206-41d2-8096-b70d3f5b4e1e','Arruela zincada 10mm','Arruela zincada 10mm'),
  ('e8c7b269-d49e-40d4-a3cc-f637fd7c7421','Disco Corte Super','Disco Corte Super'),
  ('eb42810b-1eae-463b-b0f4-c55f49faa08e','Estilete Snap Off','Estilete Snap Off'),
  ('ebf9d92a-174b-4d82-b139-ad18c9624300','Super Bonder','Super Bonder'),
  ('ee6990fa-18ed-4db9-8376-204d8c541c07','Tampa Para Bisnaga','Tampa Para Bisnaga'),
  ('eec23bf8-b58c-4db2-b67e-64cd9542b2bb','Primer Pu 3000','Primer Pu 3000'),
  ('f032acf7-abf6-4573-a25b-24e195abf195','Disco de Corte','Disco de Corte'),
  ('f7200639-3f95-4e2d-bf49-3cdb80f037fe','Suporte de Mangueira','Suporte de Mangueira'),
  ('f9370160-dacf-41c1-accf-c908453a5260','Adesivo Vinil Black','Adesivo Vinil Black'),
  ('fac8ecb6-d78f-40cb-b1ea-20830c71e004','Espatula Feltro','Espatula Feltro');

DO $$
DECLARE n_total int; n_missing int; n_mismatch int; bad text;
BEGIN
  SELECT count(*) INTO n_total FROM _move_expect;

  SELECT count(*) INTO n_missing
  FROM _move_expect e
  WHERE NOT EXISTS (SELECT 1 FROM "Item" i WHERE i.id = e.item_id);

  SELECT count(*),
         string_agg(format('%s=%s (expected %s|%s)', e.item_id, i.name,
                           e.backup_name, e.current_name), E'\n')
    INTO n_mismatch, bad
  FROM _move_expect e JOIN "Item" i ON i.id = e.item_id
  WHERE btrim(regexp_replace(i.name,           '\s+\.$', ''))
        NOT IN (btrim(regexp_replace(e.backup_name,  '\s+\.$', '')),
                btrim(regexp_replace(e.current_name, '\s+\.$', '')));

  RAISE NOTICE 'A5 move pre-flight: % listed ids, % missing, % name mismatches',
               n_total, n_missing, n_mismatch;

  IF n_missing > 5 THEN
    RAISE EXCEPTION 'A5 move pre-flight: % of % listed item ids are missing (>5) — wrong database or heavy drift, aborting', n_missing, n_total;
  END IF;
  IF n_mismatch > 8 THEN
    RAISE EXCEPTION E'A5 move pre-flight: % ids changed name vs the 2026-06-10 backup (>8) — heavy drift, aborting:\n%', n_mismatch, left(bad, 2000);
  END IF;
END $$;

-- guards: every target category exists; warn-and-skip unknown item ids
DO $$
DECLARE missing int;
BEGIN
  SELECT count(DISTINCT cat_name) INTO missing
  FROM _moves m WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = m.cat_name);
  IF missing > 0 THEN RAISE EXCEPTION 'missing target categories: %', missing; END IF;
END $$;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A','A5-skipped-unknown-item','Item', m.item_id, NULL, jsonb_build_object('target', m.cat_name)
FROM _moves m WHERE NOT EXISTS (SELECT 1 FROM "Item" i WHERE i.id = m.item_id);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A','A5-move','Item', i.id,
       jsonb_build_object('categoryId', i."categoryId"),
       jsonb_build_object('categoryName', m.cat_name)
FROM "Item" i JOIN _moves m ON m.item_id = i.id
JOIN "ItemCategory" c ON c.name = m.cat_name
WHERE i."categoryId" IS DISTINCT FROM c.id;

UPDATE "Item" i SET "categoryId" = c.id, "updatedAt" = now()
FROM _moves m JOIN "ItemCategory" c ON c.name = m.cat_name
WHERE i.id = m.item_id AND i."categoryId" IS DISTINCT FROM c.id;

-- ---------------------------------------------------------------------------
-- A6. Deactivations requested by owner (soft delete; FKs forbid hard delete)
-- ---------------------------------------------------------------------------
-- expected_name captured from the 2026-06-10 prod backup (deactivation never
-- renames, so first run and re-run see the same name)
CREATE TEMP TABLE _deact (item_id text, expected_name text, why text);
INSERT INTO _deact VALUES
  ('5a1210ab-9e71-41be-b68e-3f16fc5b294a','Pulverizador de Pressão',   'Removido a pedido do proprietário (Pulverizador de Pressão)'),
  ('27278f33-b534-4e4a-8450-71a300787ab0','Espatula Inox/12cm Cab Pvc','Removido a pedido do proprietário (Espátula Inox)'),
  ('3218b7cb-5850-4f71-9f37-1082def56334','Soprador Térmico Bateria',  'Removido a pedido do proprietário (Soprador Térmico Bateria)');

-- guard: abort on UUID/name drift — deactivating the wrong item zeroes its stock
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s=%s (expected %s)', d.item_id,
                           COALESCE(i.name,'<MISSING>'), d.expected_name), E'\n') INTO bad
  FROM _deact d LEFT JOIN "Item" i ON i.id = d.item_id
  WHERE i.id IS NULL OR i.name <> d.expected_name;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION E'A6 deactivation guard failed — id/name drift vs the 2026-06-10 backup, aborting:\n%', bad;
  END IF;
END $$;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A','A6-deactivate','Item', i.id,
       jsonb_build_object('isActive', i."isActive", 'quantity', i.quantity),
       jsonb_build_object('why', d.why)
FROM "Item" i JOIN _deact d ON d.item_id = i.id WHERE i."isActive";

UPDATE "Item" i
SET "isActive" = false, quantity = 0,
    "deactivatedAt" = COALESCE(i."deactivatedAt", now()),
    "deactivationReason" = d.why, "updatedAt" = now()
FROM _deact d WHERE i.id = d.item_id AND i."isActive";

-- backfill audit fields on items the owner already removed manually
-- (name-guarded like A6: these UUIDs must still be the items captured from the
-- 2026-06-10 prod backup, else abort)
CREATE TEMP TABLE _deact_backfill (item_id text, expected_name text);
INSERT INTO _deact_backfill VALUES
  ('cda57e50-7f11-43b8-b32d-9c0530bf20b5','Fita Led'),
  ('04c48d67-33fe-4b9f-ba91-68d9612f3793','Pá de Lixo Inox'),
  ('eeff8972-e9d7-43e0-ae27-7a6c583be4b8','Trena Dewalt Emb'),
  ('a04a552e-490b-47c3-9548-a6f1fb595b03','Pistola Pintura');  -- (WWSoldas)

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s=%s (expected %s)', b.item_id,
                           COALESCE(i.name,'<MISSING>'), b.expected_name), E'\n') INTO bad
  FROM _deact_backfill b LEFT JOIN "Item" i ON i.id = b.item_id
  WHERE i.id IS NULL OR i.name <> b.expected_name;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION E'A6 backfill guard failed — id/name drift vs the 2026-06-10 backup, aborting:\n%', bad;
  END IF;
END $$;

UPDATE "Item" SET
  "deactivatedAt" = COALESCE("deactivatedAt", now()),
  "deactivationReason" = COALESCE("deactivationReason", 'Removido a pedido do proprietário'),
  "updatedAt" = now()
WHERE id IN (SELECT item_id FROM _deact_backfill)
  AND "isActive" = false
  AND ("deactivatedAt" IS NULL OR "deactivationReason" IS NULL);

-- ---------------------------------------------------------------------------
-- A7. New items requested by owner
-- ---------------------------------------------------------------------------
INSERT INTO "Item" (id, name, "categoryId", quantity, "shouldAssignToUser", "isActive",
                    "estimatedLeadTime", "monthlyConsumption", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v.name, c.id, 0, false, true, 30, 0, now(), now()
FROM (VALUES
  ('Caneta',                       'Escritório'),
  ('Rodo 1m',                      'Cozinha e Limpeza'),
  ('Tinta para Impressora Ciano',  'Informática e Eletrônicos'),
  ('Tinta para Impressora Magenta','Informática e Eletrônicos'),
  ('Tinta para Impressora Amarela','Informática e Eletrônicos')
) AS v(name, cat)
JOIN "ItemCategory" c ON c.name = v.cat
WHERE NOT EXISTS (SELECT 1 FROM "Item" i WHERE i.name = v.name);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, new_value)
SELECT 'A','A7-create','Item', i.id, jsonb_build_object('name', i.name)
FROM "Item" i
WHERE i.name IN ('Caneta','Rodo 1m','Tinta para Impressora Ciano','Tinta para Impressora Magenta','Tinta para Impressora Amarela')
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l WHERE l.step='A7-create' AND l.entity_id = i.id);

-- ---------------------------------------------------------------------------
-- A8. Printer ink quantities (owner: the 4 units were 2 black + 1 each CMY)
-- ---------------------------------------------------------------------------
UPDATE "Item" SET quantity = 2, "updatedAt" = now()
WHERE name = 'Tinta para Impressora Preta' AND quantity = 4;
UPDATE "Item" SET quantity = 1, "updatedAt" = now()
WHERE name IN ('Tinta para Impressora Ciano','Tinta para Impressora Magenta','Tinta para Impressora Amarela')
  AND quantity = 0;

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
SELECT step, count(*) FROM correction_log_20260609 WHERE phase='A' GROUP BY 1 ORDER BY 1;

COMMIT;
