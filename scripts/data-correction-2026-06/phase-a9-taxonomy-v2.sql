-- =============================================================================
-- PHASE A9 — Taxonomy v2: back to the owner-preferred 14-top structure.
-- Data correction 2026-06-10. Idempotent: guarded WHERE clauses; re-running is
-- a no-op. All changes logged to correction_log_20260609 (phase 'A9').
--
-- WHY: the A4 tree consolidated the merged-taxonomy design (docs/categorization/
-- category-reclassify/merged-taxonomy.json, 14 tops) down to 9 tops. The owner
-- prefers the 14-top separation (Funilaria own top, Mascaramento own top,
-- Aplicadores own top, Copa own leaf, Uniforme own top). This phase restores it,
-- improved by what the live item data showed:
--   - Linha Vinílica leaf (4 vinílico paints hiding in "Tinta")
--   - Faixas Refletivas (7) move Reparo→Plotagem (they are adesivação goods)
--   - Hookit/Base Hookit move F.Pneumáticas→Lixas (backing pads, not tools)
--   - Bits/Soquete Torx/Brocas move into the tool leaves
--   - "Peças de Reposição (Caminhões)" kept (proposal lacked it)
--   - Preparação de Superfície leaf keeps the OWNER USAGE-STAGE rule from A8
--     (removedor/desengraxante/estopas stay in Funilaria, NOT solventes/higiene)
-- OWNER DECISIONS (2026-06-10): primers STAY under Tintas (not Funilaria);
-- ar comprimido moves to Manutenção as MANUTENCAO; NO item renames here.
--
-- AFTER THIS PHASE run the ITEM_DERIVED mirror sync:
--   BACKUP_PATH=... npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/sync-transaction-category-mirror.ts
--
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a9-taxonomy-v2.sql
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
-- A29. Rename the tops that change name (id kept, children/items follow).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _top_renames (old_name text, new_name text);
INSERT INTO _top_renames VALUES
  ('Funilaria e Produção',       'Funilaria e Reparo de Carroceria'),
  ('Plotagem',                   'Plotagem e Adesivação'),
  ('Escritório e Apoio',         'Escritório, Cozinha, Limpeza e Cortesia'),
  ('Ferramentas e Equipamentos', 'Ferramentas Elétricas/Pneumáticas e Equipamentos');

-- guard: ItemCategory.name is UNIQUE. If the old name still exists AND the new
-- name is already taken by a different category, the rename can neither apply
-- nor be a completed no-op — that is real drift; abort loudly instead of
-- silently skipping (a skipped top rename would leave the v2 taxonomy half-built).
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s -> %s', r.old_name, r.new_name), '; ') INTO bad
  FROM _top_renames r
  WHERE EXISTS (SELECT 1 FROM "ItemCategory" o WHERE o.name = r.old_name)
    AND EXISTS (SELECT 1 FROM "ItemCategory" n WHERE n.name = r.new_name);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'A29 top-rename collision (target name already taken by another category): %. Resolve manually, then re-run.', bad;
  END IF;
END $$;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A9','A29-rename-top','ItemCategory', c.id,
       jsonb_build_object('name', c.name), jsonb_build_object('name', r.new_name)
FROM "ItemCategory" c JOIN _top_renames r ON r.old_name = c.name
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" x WHERE x.name = r.new_name);

UPDATE "ItemCategory" c
SET name = r.new_name, "updatedAt" = now()
FROM _top_renames r
WHERE c.name = r.old_name
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" x WHERE x.name = r.new_name);

-- ---------------------------------------------------------------------------
-- A30. Promote leaves to tops (row reused: items routed out in A34).
--   Mascaramento e Cobertura  → top [PRODUTIVO]
--   Ferramentas Manuais (leaf)→ top [INVESTIMENTO, TOOL]
--   Uniformes → renamed 'Uniforme' → top [EPI, PPE]
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A9','A30-promote-top','ItemCategory', c.id,
       jsonb_build_object('name', c.name, 'parentId', c."parentId", 'categoryLevel', c."categoryLevel"),
       jsonb_build_object('categoryLevel', 1, 'parentId', NULL)
FROM "ItemCategory" c
WHERE c.name IN ('Mascaramento e Cobertura', 'Ferramentas Manuais', 'Uniformes')
  AND (c."parentId" IS NOT NULL OR c."categoryLevel" IS DISTINCT FROM 1);

UPDATE "ItemCategory"
SET "parentId" = NULL, "categoryLevel" = 1, "updatedAt" = now()
WHERE name IN ('Mascaramento e Cobertura', 'Ferramentas Manuais', 'Uniformes')
  AND ("parentId" IS NOT NULL OR "categoryLevel" IS DISTINCT FROM 1);

-- guard: same UNIQUE-collision rule for the Uniformes -> Uniforme rename
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ItemCategory" WHERE name = 'Uniformes')
     AND EXISTS (SELECT 1 FROM "ItemCategory" WHERE name = 'Uniforme') THEN
    RAISE EXCEPTION 'A30 rename collision: both Uniformes and Uniforme exist as categories. Resolve manually, then re-run.';
  END IF;
END $$;

UPDATE "ItemCategory" SET name = 'Uniforme', "updatedAt" = now()
WHERE name = 'Uniformes'
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" x WHERE x.name = 'Uniforme');

-- New tops that have no existing row to reuse.
CREATE TEMP TABLE _new_tops (name text, acct text, ctype text);
INSERT INTO _new_tops VALUES
  ('Aplicadores e Auxiliares de Mistura', 'PRODUTIVO', 'REGULAR'),
  ('A Revisar',                            NULL,       'REGULAR');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A9','A30-create-top','ItemCategory', t.name, NULL,
       jsonb_build_object('accountingType', t.acct, 'type', t.ctype)
FROM _new_tops t WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = t.name);

INSERT INTO "ItemCategory" (id, name, type, "categoryLevel", "parentId", "accountingType", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t.name, t.ctype::"ItemCategoryType", 1, NULL,
       CASE WHEN t.acct IS NULL THEN NULL ELSE t.acct::"AccountingType" END, now(), now()
FROM _new_tops t WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = t.name);

-- ---------------------------------------------------------------------------
-- A31. Rename leaves (id kept, items follow).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _leaf_renames (old_name text, new_name text);
INSERT INTO _leaf_renames VALUES
  ('Tinta',                                'Bases Prontas / Tintas'),
  ('Endurecedor',                          'Endurecedores e Catalisadores'),
  ('Diluente',                             'Solventes e Thinners'),
  ('Lixas',                                'Lixas, Fibras e Suportes'),
  ('Polimento',                            'Polimento e Refino'),
  ('Vinil e Adesivos',                     'Vinil, Películas e Adesivos'),
  ('Ferramentas de Plotagem',              'Ferramentas e Equipamentos de Plotagem'),
  ('Ar Comprimido e Conexões',             'Instalação Pneumática'),
  ('Elétrica e Iluminação',                'Instalação Elétrica'),
  ('Materiais de Manutenção/Longo Prazo',  'Peças de Manutenção de Equipamento'),
  ('Cozinha e Limpeza',                    'Higiene, Limpeza e Zeladoria'),
  ('Escritório',                           'Escritório e Administrativo');

-- guard: same UNIQUE-collision rule as A29 — abort on real collisions instead
-- of silently skipping a leaf rename
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s -> %s', r.old_name, r.new_name), '; ') INTO bad
  FROM _leaf_renames r
  WHERE EXISTS (SELECT 1 FROM "ItemCategory" o WHERE o.name = r.old_name)
    AND EXISTS (SELECT 1 FROM "ItemCategory" n WHERE n.name = r.new_name);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'A31 leaf-rename collision (target name already taken by another category): %. Resolve manually, then re-run.', bad;
  END IF;
END $$;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A9','A31-rename-leaf','ItemCategory', c.id,
       jsonb_build_object('name', c.name), jsonb_build_object('name', r.new_name)
FROM "ItemCategory" c JOIN _leaf_renames r ON r.old_name = c.name
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" x WHERE x.name = r.new_name);

UPDATE "ItemCategory" c
SET name = r.new_name, "updatedAt" = now()
FROM _leaf_renames r
WHERE c.name = r.old_name
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" x WHERE x.name = r.new_name);

-- ---------------------------------------------------------------------------
-- A32. Create the new leaves.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _new_leaves (name text, parent text, acct text, ctype text);
INSERT INTO _new_leaves VALUES
  ('Linha Vinílica',                    'Tintas, Vernizes e Auxiliares Químicos',            'MATERIA_PRIMA', 'REGULAR'),
  ('Massas e Laminação',                'Funilaria e Reparo de Carroceria',                  'PRODUTIVO',     'REGULAR'),
  ('Selantes e Vedantes',               'Funilaria e Reparo de Carroceria',                  'PRODUTIVO',     'REGULAR'),
  ('Preparação de Superfície',          'Funilaria e Reparo de Carroceria',                  'PRODUTIVO',     'REGULAR'),
  ('Fitas de Mascaramento',             'Mascaramento e Cobertura',                          'PRODUTIVO',     'REGULAR'),
  ('Papel de Cobertura',                'Mascaramento e Cobertura',                          'PRODUTIVO',     'REGULAR'),
  ('Pincéis, Rolos e Espátulas',        'Aplicadores e Auxiliares de Mistura',               'PRODUTIVO',     'REGULAR'),
  ('Copos, Dosagem e Filtragem',        'Aplicadores e Auxiliares de Mistura',               'PRODUTIVO',     'REGULAR'),
  ('Abraçadeiras e Presilhas',          'Peças, Fixação e Conexões',                         'PRODUTIVO',     'REGULAR'),
  ('Conexões, Mangueiras e Suportes',   'Peças, Fixação e Conexões',                         'PRODUTIVO',     'REGULAR'),
  ('Pistolas de Pintura e Aerografia',  'Ferramentas Elétricas/Pneumáticas e Equipamentos',  'INVESTIMENTO',  'TOOL'),
  ('Equipamentos e Acesso',             'Ferramentas Elétricas/Pneumáticas e Equipamentos',  'INVESTIMENTO',  'TOOL'),
  ('Uniforme — Parte Superior',         'Uniforme',                                          'EPI',           'PPE'),
  ('Uniforme — Parte Inferior',         'Uniforme',                                          'EPI',           'PPE'),
  ('Uniforme — Corpo Inteiro',          'Uniforme',                                          'EPI',           'PPE');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A9','A32-create-leaf','ItemCategory', l.name, NULL,
       jsonb_build_object('parent', l.parent, 'accountingType', l.acct, 'type', l.ctype)
FROM _new_leaves l WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = l.name);

INSERT INTO "ItemCategory" (id, name, type, "categoryLevel", "parentId", "accountingType", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, l.name, l.ctype::"ItemCategoryType", 2, p.id,
       l.acct::"AccountingType", now(), now()
FROM _new_leaves l JOIN "ItemCategory" p ON p.name = l.parent
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = l.name);

-- ---------------------------------------------------------------------------
-- A33. Re-parent existing leaves that change top / accounting.
--   Chaves|Corte|Medição → top Ferramentas Manuais
--   Instalação Pneumática → top Manutenção e Instalações  [acct → MANUTENCAO,
--     owner decision 2026-06-10: keeps the shop running, not consumed on trucks]
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _reparent (child text, parent text, acct text);
INSERT INTO _reparent VALUES
  ('Chaves, Alicates e Soquetes', 'Ferramentas Manuais',        'INVESTIMENTO'),
  ('Corte, Impacto e Escovas',    'Ferramentas Manuais',        'INVESTIMENTO'),
  ('Medição e Alinhamento',       'Ferramentas Manuais',        'INVESTIMENTO'),
  ('Instalação Pneumática',       'Manutenção e Instalações',   'MANUTENCAO');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A9','A33-reparent','ItemCategory', c.id,
       jsonb_build_object('name', c.name, 'parentId', c."parentId", 'accountingType', c."accountingType"),
       jsonb_build_object('parent', t.parent, 'accountingType', t.acct)
FROM "ItemCategory" c JOIN _reparent t ON t.child = c.name
JOIN "ItemCategory" p ON p.name = t.parent
WHERE c."parentId" IS DISTINCT FROM p.id OR c."accountingType"::text IS DISTINCT FROM t.acct;

UPDATE "ItemCategory" c
SET "parentId" = p.id, "categoryLevel" = 2,
    "accountingType" = t.acct::"AccountingType", "updatedAt" = now()
FROM _reparent t JOIN "ItemCategory" p ON p.name = t.parent
WHERE c.name = t.child
  AND (c."parentId" IS DISTINCT FROM p.id OR c."accountingType"::text IS DISTINCT FROM t.acct);

-- ---------------------------------------------------------------------------
-- A34. Item moves. First matching rule (lowest prio) per item wins.
--   src = item's CURRENT category (post-renames); pattern on lower(name).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _moves (prio int, src text, pattern text, dest text);
INSERT INTO _moves VALUES
  -- Tinta split: vinílicos → Linha Vinílica
  (10, 'Bases Prontas / Tintas', '%vinilico%',          'Linha Vinílica'),
  (11, 'Bases Prontas / Tintas', '%vinílico%',          'Linha Vinílica'),
  -- Reparo e Preparação dissolution
  (20, 'Reparo e Preparação', 'faixa refletiva%',       'Vinil, Películas e Adesivos'),
  (21, 'Reparo e Preparação', 'massa%',                 'Massas e Laminação'),
  (22, 'Reparo e Preparação', 'manta%',                 'Massas e Laminação'),
  (23, 'Reparo e Preparação', 'resina%',                'Massas e Laminação'),
  (24, 'Reparo e Preparação', 'adesivo selante%',       'Selantes e Vedantes'),
  (25, 'Reparo e Preparação', 'super bonder%',          'Selantes e Vedantes'),
  (26, 'Reparo e Preparação', 'trava rosca%',           'Selantes e Vedantes'),
  (27, 'Reparo e Preparação', 'desengra%',              'Preparação de Superfície'),
  (28, 'Reparo e Preparação', 'desengri%',              'Preparação de Superfície'),
  (29, 'Reparo e Preparação', 'removedor%',             'Preparação de Superfície'),
  (30, 'Reparo e Preparação', 'estopa%',                'Preparação de Superfície'),
  (31, 'Reparo e Preparação', 'espatula%',              'Pincéis, Rolos e Espátulas'),
  (32, 'Reparo e Preparação', 'escova%',                'Corte, Impacto e Escovas'),
  -- Produção dissolution (copo pistola BEFORE copo%)
  (40, 'Produção', 'copo pistola%',                     'Pistolas de Pintura e Aerografia'),
  (41, 'Produção', 'bit %',                             'Chaves, Alicates e Soquetes'),
  (42, 'Produção', 'soquete%',                          'Chaves, Alicates e Soquetes'),
  (43, 'Produção', 'lamina%',                           'Corte, Impacto e Escovas'),
  (44, 'Produção', 'pincel%',                           'Pincéis, Rolos e Espátulas'),
  (45, 'Produção', 'pacote pincel%',                    'Pincéis, Rolos e Espátulas'),
  (46, 'Produção', 'rolo %',                            'Pincéis, Rolos e Espátulas'),
  (47, 'Produção', 'suporte garfo%',                    'Pincéis, Rolos e Espátulas'),
  (48, 'Produção', 'bandeija%',                         'Pincéis, Rolos e Espátulas'),
  (49, 'Produção', 'aplicador calafetador manual%',     'Pincéis, Rolos e Espátulas'),
  (50, 'Produção', 'copo%',                             'Copos, Dosagem e Filtragem'),
  (51, 'Produção', 'garrafa%',                          'Copos, Dosagem e Filtragem'),
  (52, 'Produção', 'funil%',                            'Copos, Dosagem e Filtragem'),
  (53, 'Produção', 'bisnaga%',                          'Copos, Dosagem e Filtragem'),
  (54, 'Produção', 'pote%',                             'Copos, Dosagem e Filtragem'),
  (55, 'Produção', 'tampa%',                            'Copos, Dosagem e Filtragem'),
  (56, 'Produção', 'balde%',                            'Copos, Dosagem e Filtragem'),
  (57, 'Produção', 'peneira%',                          'Copos, Dosagem e Filtragem'),
  (58, 'Produção', 'lapis%',                            'Escritório e Administrativo'),
  (59, 'Produção', 'refil%',                            'Peças de Manutenção de Equipamento'),
  (60, 'Produção', 'suporte para pistola%',             'Conexões, Mangueiras e Suportes'),
  (61, 'Produção', 'bobina%',                           'Embalagem e Expedição'),
  -- Mascaramento split (items live on the promoted TOP row)
  (70, 'Mascaramento e Cobertura', 'rolo de lona%',     'Embalagem e Expedição'),
  (71, 'Mascaramento e Cobertura', 'fita%',             'Fitas de Mascaramento'),
  (72, 'Mascaramento e Cobertura', 'líq%',              'Fitas de Mascaramento'),
  (73, 'Mascaramento e Cobertura', 'liq%',              'Fitas de Mascaramento'),
  (74, 'Mascaramento e Cobertura', '%papel%',           'Papel de Cobertura'),
  -- Kraft is masking paper, not vinyl
  (80, 'Vinil, Películas e Adesivos', 'papel kraft%',   'Papel de Cobertura'),
  -- Pneumáticas: pads → Lixas; pistolas/aerógrafo → own leaf; bico → instalação
  (90, 'Ferramentas Pneumáticas', '%hookit%',           'Lixas, Fibras e Suportes'),
  (91, 'Ferramentas Pneumáticas', 'aerógrafo%',         'Pistolas de Pintura e Aerografia'),
  (92, 'Ferramentas Pneumáticas', 'aerografo%',         'Pistolas de Pintura e Aerografia'),
  (93, 'Ferramentas Pneumáticas', 'pistola%',           'Pistolas de Pintura e Aerografia'),
  (94, 'Ferramentas Pneumáticas', 'bico de ar%',        'Instalação Pneumática'),
  -- Elétricas: nível a laser é medição
  (100, 'Ferramentas Elétricas', 'nivel%',              'Medição e Alinhamento'),
  (101, 'Ferramentas Elétricas', 'nível%',              'Medição e Alinhamento'),
  -- Old Ferramentas Manuais leaf (now the TOP row) — route everything out
  (110, 'Ferramentas Manuais', 'escada%',               'Equipamentos e Acesso'),
  (111, 'Ferramentas Manuais', 'banqueta%',             'Equipamentos e Acesso'),
  (112, 'Ferramentas Manuais', 'cavalete%',             'Equipamentos e Acesso'),
  (113, 'Ferramentas Manuais', 'pulverizador%',         'Equipamentos e Acesso'),
  (114, 'Ferramentas Manuais', 'seladora%',             'Equipamentos e Acesso'),
  (115, 'Ferramentas Manuais', 'broca%',                'Corte, Impacto e Escovas'),
  (116, 'Ferramentas Manuais', 'mandril%',              'Corte, Impacto e Escovas'),
  (117, 'Ferramentas Manuais', 'cinta%',                'Abraçadeiras e Presilhas'),
  (118, 'Ferramentas Manuais', 'kit de rodas%',         'Peças de Manutenção de Equipamento'),
  (119, 'Ferramentas Manuais', 'suporte reforçado%',    'Conexões, Mangueiras e Suportes'),
  (120, 'Ferramentas Manuais', 'suporte reforcado%',    'Conexões, Mangueiras e Suportes'),
  -- Fixadores: abraçadeiras/arames split out
  (130, 'Fixadores', 'abraçadeira%',                    'Abraçadeiras e Presilhas'),
  (131, 'Fixadores', 'abracadeira%',                    'Abraçadeiras e Presilhas'),
  (132, 'Fixadores', 'arame%',                          'Abraçadeiras e Presilhas'),
  -- Mangueiras de água saem de Peças de Manutenção (leaf renomeada)
  (140, 'Peças de Manutenção de Equipamento', 'mangueira%', 'Conexões, Mangueiras e Suportes'),
  -- Luva Redução é conexão galvanizada (pneumática), não elétrica
  (150, 'Instalação Elétrica', 'luva redução%',         'Instalação Pneumática'),
  (151, 'Instalação Elétrica', 'luva reducao%',         'Instalação Pneumática'),
  -- Filtro do compressor é peça de manutenção de equipamento
  (160, 'Instalação Pneumática', 'filtro compressor%',  'Peças de Manutenção de Equipamento'),
  -- Copa separada da limpeza (decisão do owner)
  (170, 'Higiene, Limpeza e Zeladoria', 'copo %',       'Copa e Alimentação'),
  (171, 'Higiene, Limpeza e Zeladoria', 'café%',        'Copa e Alimentação'),
  (172, 'Higiene, Limpeza e Zeladoria', 'cafe%',        'Copa e Alimentação'),
  (173, 'Higiene, Limpeza e Zeladoria', 'açúcar%',      'Copa e Alimentação'),
  (174, 'Higiene, Limpeza e Zeladoria', 'acucar%',      'Copa e Alimentação'),
  -- Uniforme top → leaves
  (180, 'Uniforme', 'camiseta%',                        'Uniforme — Parte Superior'),
  (181, 'Uniforme', 'camisa%',                          'Uniforme — Parte Superior'),
  (182, 'Uniforme', 'manguito%',                        'Uniforme — Parte Superior'),
  (183, 'Uniforme', 'jaleco%',                          'Uniforme — Parte Superior'),
  (184, 'Uniforme', 'blusa%',                           'Uniforme — Parte Superior'),
  (185, 'Uniforme', 'jaqueta%',                         'Uniforme — Parte Superior'),
  (186, 'Uniforme', 'calça%',                           'Uniforme — Parte Inferior'),
  (187, 'Uniforme', 'calca%',                           'Uniforme — Parte Inferior'),
  (188, 'Uniforme', 'bermuda%',                         'Uniforme — Parte Inferior'),
  (189, 'Uniforme', 'avental%',                         'Uniforme — Parte Inferior'),
  (190, 'Uniforme', 'macacão%',                         'Uniforme — Corpo Inteiro'),
  (191, 'Uniforme', 'macacao%',                         'Uniforme — Corpo Inteiro');

-- "Copa e Alimentação" leaf must exist before the moves reference it.
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A9','A32-create-leaf','ItemCategory', 'Copa e Alimentação', NULL,
       jsonb_build_object('parent', 'Escritório, Cozinha, Limpeza e Cortesia', 'accountingType', 'ESCRITORIO', 'type', 'REGULAR')
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = 'Copa e Alimentação');

INSERT INTO "ItemCategory" (id, name, type, "categoryLevel", "parentId", "accountingType", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Copa e Alimentação', 'REGULAR', 2, p.id, 'ESCRITORIO', now(), now()
FROM "ItemCategory" p
WHERE p.name = 'Escritório, Cozinha, Limpeza e Cortesia'
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = 'Copa e Alimentação');

-- Resolve: first matching rule per item.
CREATE TEMP TABLE _item_moves AS
SELECT DISTINCT ON (i.id) i.id AS item_id, i.name AS item_name,
       src.id AS src_id, src.name AS src_name, dest.id AS dest_id, dest.name AS dest_name
FROM "Item" i
JOIN "ItemCategory" src ON src.id = i."categoryId"
JOIN _moves m ON m.src = src.name AND lower(i.name) LIKE m.pattern
JOIN "ItemCategory" dest ON dest.name = m.dest
ORDER BY i.id, m.prio;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A9','A34-move-item','Item', m.item_id,
       jsonb_build_object('name', m.item_name, 'category', m.src_name),
       jsonb_build_object('category', m.dest_name)
FROM _item_moves m WHERE m.src_id <> m.dest_id;

UPDATE "Item" i
SET "categoryId" = m.dest_id, "updatedAt" = now()
FROM _item_moves m
WHERE i.id = m.item_id AND m.src_id <> m.dest_id;

-- ---------------------------------------------------------------------------
-- A35. Leftovers in dissolved sources → "A Revisar" (+ review flag).
--   (Promoted tops must hold no items; dissolved leaves get deleted in A36.)
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A9','A35-leftover-to-revisar','Item', i.id,
       jsonb_build_object('name', i.name, 'category', c.name),
       jsonb_build_object('category', 'A Revisar', 'categoryReviewNeeded', true)
FROM "Item" i JOIN "ItemCategory" c ON c.id = i."categoryId"
WHERE c.name IN ('Produção', 'Reparo e Preparação', 'Mascaramento e Cobertura',
                 'Ferramentas Manuais', 'Uniforme');

UPDATE "Item" i
SET "categoryId" = (SELECT id FROM "ItemCategory" WHERE name = 'A Revisar'),
    "categoryReviewNeeded" = true, "updatedAt" = now()
FROM "ItemCategory" c
WHERE c.id = i."categoryId"
  AND c.name IN ('Produção', 'Reparo e Preparação', 'Mascaramento e Cobertura',
                 'Ferramentas Manuais', 'Uniforme');

-- ---------------------------------------------------------------------------
-- A36. Delete dissolved leaves once empty (no items, no children).
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A9','A36-delete-empty-leaf','ItemCategory', c.id,
       jsonb_build_object('name', c.name), NULL
FROM "ItemCategory" c
WHERE c.name IN ('Produção', 'Reparo e Preparação')
  AND NOT EXISTS (SELECT 1 FROM "Item" i WHERE i."categoryId" = c.id)
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" k WHERE k."parentId" = c.id);

DELETE FROM "ItemCategory" c
WHERE c.name IN ('Produção', 'Reparo e Preparação')
  AND NOT EXISTS (SELECT 1 FROM "Item" i WHERE i."categoryId" = c.id)
  AND NOT EXISTS (SELECT 1 FROM "ItemCategory" k WHERE k."parentId" = c.id);

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A9' GROUP BY step ORDER BY step;

SELECT p.name AS top, count(c.id) AS leaves,
       (SELECT count(*) FROM "Item" i JOIN "ItemCategory" x ON x.id = i."categoryId"
        WHERE (x.id = p.id OR x."parentId" = p.id) AND i."isActive") AS active_items
FROM "ItemCategory" p LEFT JOIN "ItemCategory" c ON c."parentId" = p.id
WHERE p."categoryLevel" = 1
GROUP BY p.id, p.name ORDER BY p.name;

COMMIT;
