-- =============================================================================
-- PHASE A4 — Category tree + accounting groups for the 28-category taxonomy.
-- Data correction 2026-06-10. Idempotent: guarded WHERE clauses; re-running is
-- a no-op. All changes logged to correction_log_20260609.
--
-- WHY: phase A built the 28 operational categories FLAT (parentId null,
-- categoryLevel 1, accountingType null), so the Categorias page showed no
-- Categoria/Subcategoria tree and "-" for every Grupo Contábil. This phase
-- grafts the structure from the owner-approved merged-taxonomy design
-- (docs/categorization/category-reclassify/merged-taxonomy.json) onto the live
-- 28 categories: 7 new level-1 parent groups, 26 categories nested as level-2
-- children, EPI and Plotagem kept as standalone level-1, and an AccountingType
-- on every row. Items are NOT touched — they keep pointing at the 28 original
-- categories. The stale apply-merged-taxonomy.ts script (whose per-item batches
-- predated the phase-A moves/merges and would clobber them) was deleted from
-- the repo on 2026-06-11.
--
-- AFTER THIS PHASE run the ITEM_DERIVED mirror sync so reconciliation picks up
-- the new names/accounting groups:
--   NODE_ENV=production node dist/scripts/sync-transaction-category-mirror.js
--
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a4-category-tree.sql
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
-- A14. Create the 7 level-1 parent groups (skipped when the name exists).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _parents (name text, acct text, ctype text);
INSERT INTO _parents VALUES
  ('Tintas, Vernizes e Auxiliares Químicos', 'MATERIA_PRIMA', 'REGULAR'),
  ('Produção e Preparação',                  'PRODUTIVO',     'REGULAR'),
  ('Abrasivos e Polimento',                  'PRODUTIVO',     'REGULAR'),
  ('Peças, Fixação e Conexões',              'PRODUTIVO',     'REGULAR'),
  ('Ferramentas e Equipamentos',             'INVESTIMENTO',  'TOOL'),
  ('Manutenção e Instalações',               'MANUTENCAO',    'REGULAR'),
  ('Escritório e Apoio',                     'ESCRITORIO',    'REGULAR');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A4','A14-create-parent','ItemCategory', p.name, NULL,
       jsonb_build_object('accountingType', p.acct, 'type', p.ctype, 'categoryLevel', 1)
FROM _parents p
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = p.name);

INSERT INTO "ItemCategory" (id, name, type, "categoryLevel", "parentId", "accountingType", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p.name, p.ctype::"ItemCategoryType", 1, NULL,
       p.acct::"AccountingType", now(), now()
FROM _parents p
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = p.name);

-- ---------------------------------------------------------------------------
-- A15. Nest the 26 operational categories as level-2 children + set their
--      AccountingType (children inherit the parent group's accounting rollup;
--      Fundos e Primers -> MATERIA_PRIMA per the merged-taxonomy override).
--      EPI and Plotagem stay level-1 (they get accounting in A16).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _tree (child text, parent text, acct text);
INSERT INTO _tree VALUES
  ('Base',                                'Tintas, Vernizes e Auxiliares Químicos', 'MATERIA_PRIMA'),
  ('Diluente',                            'Tintas, Vernizes e Auxiliares Químicos', 'MATERIA_PRIMA'),
  ('Endurecedor',                         'Tintas, Vernizes e Auxiliares Químicos', 'MATERIA_PRIMA'),
  ('Fundos e Primers',                    'Tintas, Vernizes e Auxiliares Químicos', 'MATERIA_PRIMA'),
  ('Pigmento',                            'Tintas, Vernizes e Auxiliares Químicos', 'MATERIA_PRIMA'),
  ('Tinta',                               'Tintas, Vernizes e Auxiliares Químicos', 'MATERIA_PRIMA'),
  ('Verniz',                              'Tintas, Vernizes e Auxiliares Químicos', 'MATERIA_PRIMA'),
  ('Mascaramento e Cobertura',            'Produção e Preparação',                  'PRODUTIVO'),
  ('Produção',                            'Produção e Preparação',                  'PRODUTIVO'),
  ('Reparo e Preparação',                 'Produção e Preparação',                  'PRODUTIVO'),
  ('Discos de Corte e Desbaste',          'Abrasivos e Polimento',                  'PRODUTIVO'),
  ('Lixas',                               'Abrasivos e Polimento',                  'PRODUTIVO'),
  ('Polimento',                           'Abrasivos e Polimento',                  'PRODUTIVO'),
  ('Ar Comprimido e Conexões',            'Peças, Fixação e Conexões',              'PRODUTIVO'),
  ('Fixadores',                           'Peças, Fixação e Conexões',              'PRODUTIVO'),
  ('Peças de Reposição (Caminhões)',      'Peças, Fixação e Conexões',              'PRODUTIVO'),
  ('Ferramentas Elétricas',               'Ferramentas e Equipamentos',             'INVESTIMENTO'),
  ('Ferramentas Manuais',                 'Ferramentas e Equipamentos',             'INVESTIMENTO'),
  ('Ferramentas Pneumáticas',             'Ferramentas e Equipamentos',             'INVESTIMENTO'),
  ('Elétrica e Iluminação',               'Manutenção e Instalações',               'MANUTENCAO'),
  ('Materiais de Manutenção/Longo Prazo', 'Manutenção e Instalações',               'MANUTENCAO'),
  ('Cortesia',                            'Escritório e Apoio',                     'ESCRITORIO'),
  ('Cozinha e Limpeza',                   'Escritório e Apoio',                     'ESCRITORIO'),
  ('Embalagem e Expedição',               'Escritório e Apoio',                     'ESCRITORIO'),
  ('Escritório',                          'Escritório e Apoio',                     'ESCRITORIO'),
  ('Informática e Eletrônicos',           'Escritório e Apoio',                     'ESCRITORIO');

-- unknown child names are logged as skipped (once) instead of failing
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A4','A15-skipped-unknown-category','ItemCategory', t.child, NULL,
       jsonb_build_object('parent', t.parent)
FROM _tree t
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = t.child)
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'A15-skipped-unknown-category' AND l.entity_id = t.child);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A4','A15-nest-child','ItemCategory', c.id,
       jsonb_build_object('parentId', c."parentId", 'categoryLevel', c."categoryLevel",
                          'accountingType', c."accountingType"),
       jsonb_build_object('parent', t.parent, 'categoryLevel', 2, 'accountingType', t.acct)
FROM "ItemCategory" c
JOIN _tree t ON t.child = c.name
JOIN "ItemCategory" p ON p.name = t.parent
WHERE c."parentId" IS DISTINCT FROM p.id
   OR c."categoryLevel" IS DISTINCT FROM 2
   OR c."accountingType"::text IS DISTINCT FROM t.acct;

UPDATE "ItemCategory" c
SET "parentId" = p.id,
    "categoryLevel" = 2,
    "accountingType" = t.acct::"AccountingType",
    "updatedAt" = now()
FROM _tree t
JOIN "ItemCategory" p ON p.name = t.parent
WHERE c.name = t.child
  AND (c."parentId" IS DISTINCT FROM p.id
       OR c."categoryLevel" IS DISTINCT FROM 2
       OR c."accountingType"::text IS DISTINCT FROM t.acct);

-- ---------------------------------------------------------------------------
-- A16. Standalone level-1 categories that keep their items: accounting only.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _standalone (name text, acct text);
INSERT INTO _standalone VALUES
  ('EPI',      'EPI'),
  ('Plotagem', 'PRODUTIVO');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A4','A16-set-accounting','ItemCategory', c.id,
       jsonb_build_object('accountingType', c."accountingType"),
       jsonb_build_object('accountingType', s.acct)
FROM "ItemCategory" c JOIN _standalone s ON s.name = c.name
WHERE c."accountingType"::text IS DISTINCT FROM s.acct;

UPDATE "ItemCategory" c
SET "accountingType" = s.acct::"AccountingType", "updatedAt" = now()
FROM _standalone s
WHERE c.name = s.name AND c."accountingType"::text IS DISTINCT FROM s.acct;

-- summary
SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A4' GROUP BY step ORDER BY step;

COMMIT;
