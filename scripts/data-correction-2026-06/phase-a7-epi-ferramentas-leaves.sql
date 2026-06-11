-- =============================================================================
-- PHASE A7 — EPI subcategories, Ferramentas Manuais split, cross-category sweep.
-- Data correction 2026-06-10. Idempotent: guarded WHERE clauses; re-running is
-- a no-op. All changes logged to correction_log_20260609. Run AFTER phase-a6.
--
-- A23: EPI (95 items directly in the level-1 category) gets 5 level-2 leaves
--      (Calçados de Segurança, Proteção das Mãos, Proteção Respiratória,
--      Proteção Visual, Auditiva e Corporal, Uniformes — the design's separate
--      "Uniforme" top is folded into EPI as a Uniformes leaf, per the owner's
--      live tree). Every EPI item (active AND inactive, merge losers included)
--      is enumerated by name; the leaf was derived offline from Item.ppeType
--      (BOOTS/RAIN_BOOTS→Calçados, GLOVES→Mãos, MASK→Respiratória,
--      SHIRT/PANTS/SHORT/SLEEVES→Uniformes) and by name for OTHERS/null
--      (cartucho/filtro/retentor/respirador→Respiratória; óculos/protetor
--      auricular/máscara de solda→Visual...; luva→Mãos). Item.ppeType itself
--      is NEVER modified — capability fields drive behavior, category is
--      display/accounting only.
-- A24: Ferramentas Manuais (183 items) gets 3 NEW SIBLING level-2 leaves under
--      Ferramentas e Equipamentos (the tree supports only 2 levels):
--      Chaves, Alicates e Soquetes / Corte, Impacto e Escovas / Medição e
--      Alinhamento. Generic hand tools (escadas, cintas catraca, brocas,
--      banqueta, etc.) stay in Ferramentas Manuais. The 4 Bit/Soquete-Torx
--      consumables deliberately living in Produção are NOT touched.
-- A25: cross-category sweep (batch hints + name semantics, only unambiguous
--      fixes): misplaced inactive twins re-join their active twin's category
--      (pistolas/aerógrafo/lixadeira/bico de ar → Ferramentas Pneumáticas,
--      primers → Fundos e Primers, massas → Reparo, rebites → Fixadores,
--      discos flap → Discos de Corte e Desbaste), plotter gear → Ferramentas
--      de Plotagem, LED/garras → Elétrica e Iluminação, eletrônicos →
--      Informática e Eletrônicos, etc. Deliberate phase A/A2/A5/A6 placements
--      (faixas refletivas in Reparo, Bit/Soquete T-* in Produção, printer inks
--      in Informática, Papel Corrugado in Embalagem, clears in Base, baterias/
--      lanternas/soprador in Ferramentas Elétricas) are respected and NOT moved.
--      The merge-loser "Bobina Papel Ondulado" (Produção) is left untouched.
--
-- AFTER THIS PHASE re-run the ITEM_DERIVED mirror sync (new subcategories).
--
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a7-epi-ferramentas-leaves.sql
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
-- A23. EPI: create the 5 level-2 leaves (type PPE, acct EPI) and move every
--      EPI item into its leaf (matched by exact name while still in EPI;
--      already-moved rows are no-ops; unknown names logged as skipped once).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _epi_children (name text);
INSERT INTO _epi_children VALUES
  ('Calçados de Segurança'),
  ('Proteção das Mãos'),
  ('Proteção Respiratória'),
  ('Proteção Visual, Auditiva e Corporal'),
  ('Uniformes');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A7','A23-create-subcategory','ItemCategory', ec.name, NULL,
       jsonb_build_object('parent', 'EPI', 'categoryLevel', 2, 'accountingType', 'EPI', 'type', 'PPE')
FROM _epi_children ec
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = ec.name);

INSERT INTO "ItemCategory" (id, name, type, "categoryLevel", "parentId", "accountingType", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, ec.name, 'PPE'::"ItemCategoryType", 2,
       (SELECT id FROM "ItemCategory" WHERE name = 'EPI'),
       'EPI'::"AccountingType", now(), now()
FROM _epi_children ec
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = ec.name)
  AND EXISTS (SELECT 1 FROM "ItemCategory" p WHERE p.name = 'EPI');

CREATE TEMP TABLE _epi_moves (item_name text, target text);
INSERT INTO _epi_moves VALUES
  ('Bermuda - 36', 'Uniformes'),
  ('Bermuda - 38', 'Uniformes'),
  ('Bermuda - 40', 'Uniformes'),
  ('Bermuda - 42', 'Uniformes'),
  ('Bermuda - 44', 'Uniformes'),
  ('Bermuda - 46', 'Uniformes'),
  ('Bermuda - 48', 'Uniformes'),
  ('Bota Pvc - 42', 'Calçados de Segurança'),
  ('Botina - 35', 'Calçados de Segurança'),
  ('Botina - 39', 'Calçados de Segurança'),
  ('Botina - 40', 'Calçados de Segurança'),
  ('Botina - 41', 'Calçados de Segurança'),
  ('Botina - 42', 'Calçados de Segurança'),
  ('Botina - 43', 'Calçados de Segurança'),
  ('Botina - 44', 'Calçados de Segurança'),
  ('Botina - 45', 'Calçados de Segurança'),
  ('Botina Reposição - 35', 'Calçados de Segurança'),
  ('Botina Reposição - 37', 'Calçados de Segurança'),
  ('Botina Reposição - 38', 'Calçados de Segurança'),
  ('Botina Reposição - 39', 'Calçados de Segurança'),
  ('Botina Reposição - 40', 'Calçados de Segurança'),
  ('Botina Reposição - 41', 'Calçados de Segurança'),
  ('Botina Reposição - 42', 'Calçados de Segurança'),
  ('Botina Reposição - 43', 'Calçados de Segurança'),
  ('Botina Reposição - 44', 'Calçados de Segurança'),
  ('Botina Reposição - 45', 'Calçados de Segurança'),
  ('Caixa Luva Nitrílica G', 'Proteção das Mãos'),
  ('Caixa Luva Nitrílica M', 'Proteção das Mãos'),
  ('Caixa Luva Nitrílica P', 'Proteção das Mãos'),
  ('Calça', 'Uniformes'),
  ('Calça - 36', 'Uniformes'),
  ('Calça - 38', 'Uniformes'),
  ('Calça - 40', 'Uniformes'),
  ('Calça - 42', 'Uniformes'),
  ('Calça - 44', 'Uniformes'),
  ('Calça - 46', 'Uniformes'),
  ('Calça - 48', 'Uniformes'),
  ('Camisa - EXG', 'Uniformes'),
  ('Camisa - G', 'Uniformes'),
  ('Camisa - GG', 'Uniformes'),
  ('Camisa - M', 'Uniformes'),
  ('Camisa - P', 'Uniformes'),
  ('Camiseta', 'Uniformes'),
  ('Camiseta - fem', 'Uniformes'),
  ('Galocha - 35', 'Calçados de Segurança'),
  ('Galocha - 38', 'Calçados de Segurança'),
  ('Galocha - 39', 'Calçados de Segurança'),
  ('Galocha - 40', 'Calçados de Segurança'),
  ('Galocha - 41', 'Calçados de Segurança'),
  ('Galocha - 42', 'Calçados de Segurança'),
  ('Galocha - 43', 'Calçados de Segurança'),
  ('Galocha - 44', 'Calçados de Segurança'),
  ('Galocha - 45', 'Calçados de Segurança'),
  ('Galocha - 46', 'Calçados de Segurança'),
  ('Luva Látex G', 'Proteção das Mãos'),
  ('Luva Látex M', 'Proteção das Mãos'),
  ('Luva Neoprene - G', 'Proteção das Mãos'),
  ('Luva Neoprene - M', 'Proteção das Mãos'),
  ('Luva Química', 'Proteção das Mãos'),
  ('Luva de Proteção Anticorte', 'Proteção das Mãos'),
  ('Luva de Vaqueta', 'Proteção das Mãos'),
  ('Macacão de Segurança', 'Uniformes'),
  ('Manguito - G', 'Uniformes'),
  ('Manguito - GG', 'Uniformes'),
  ('Manguito - M', 'Uniformes'),
  ('Manguito - P', 'Uniformes'),
  ('Máscara Semi Facial Média', 'Proteção Respiratória'),
  ('Máscara Semi Facial Pequena', 'Proteção Respiratória'),
  ('Máscara Solda/autom', 'Proteção Visual, Auditiva e Corporal'),
  ('Par Protetor Auric. Auditivo', 'Proteção Visual, Auditiva e Corporal'),
  ('Par de Cartucho Para Máscara', 'Proteção Respiratória'),
  ('Par de Filtro Para Máscara', 'Proteção Respiratória'),
  ('Respirador Descartável - C/ Válvula', 'Proteção Respiratória'),
  ('Retentor Para Máscara', 'Proteção Respiratória'),
  ('Óculos de Proteção', 'Proteção Visual, Auditiva e Corporal'),
  ('Óculos de Sobrepor Escuro', 'Proteção Visual, Auditiva e Corporal');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A7','A23-skipped-unknown-item','Item', m.item_name, NULL,
       jsonb_build_object('target', m.target)
FROM _epi_moves m
WHERE NOT EXISTS (
        SELECT 1 FROM "Item" i
        JOIN "ItemCategory" c ON c.id = i."categoryId"
        WHERE i.name = m.item_name
          AND c.name IN ('EPI', m.target))
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'A23-skipped-unknown-item' AND l.entity_id = m.item_name);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A7','A23-move','Item', i.id,
       jsonb_build_object('categoryId', i."categoryId"),
       jsonb_build_object('categoryName', m.target)
FROM "Item" i
JOIN "ItemCategory" c  ON c.id = i."categoryId" AND c.name = 'EPI'
JOIN _epi_moves m      ON m.item_name = i.name
JOIN "ItemCategory" tc ON tc.name = m.target;

UPDATE "Item" i
SET "categoryId" = tc.id, "updatedAt" = now()
FROM "ItemCategory" c, _epi_moves m, "ItemCategory" tc
WHERE c.id = i."categoryId" AND c.name = 'EPI'
  AND m.item_name = i.name AND tc.name = m.target;

-- ---------------------------------------------------------------------------
-- A24. Ferramentas Manuais: create the 3 sibling level-2 leaves under
--      Ferramentas e Equipamentos (type TOOL, acct INVESTIMENTO) and move the
--      enumerated items; everything not listed stays in Ferramentas Manuais.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _fm_children (name text);
INSERT INTO _fm_children VALUES
  ('Chaves, Alicates e Soquetes'),
  ('Corte, Impacto e Escovas'),
  ('Medição e Alinhamento');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A7','A24-create-subcategory','ItemCategory', fc.name, NULL,
       jsonb_build_object('parent', 'Ferramentas e Equipamentos', 'categoryLevel', 2,
                          'accountingType', 'INVESTIMENTO', 'type', 'TOOL')
FROM _fm_children fc
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = fc.name);

INSERT INTO "ItemCategory" (id, name, type, "categoryLevel", "parentId", "accountingType", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, fc.name, 'TOOL'::"ItemCategoryType", 2,
       (SELECT id FROM "ItemCategory" WHERE name = 'Ferramentas e Equipamentos'),
       'INVESTIMENTO'::"AccountingType", now(), now()
FROM _fm_children fc
WHERE NOT EXISTS (SELECT 1 FROM "ItemCategory" c WHERE c.name = fc.name)
  AND EXISTS (SELECT 1 FROM "ItemCategory" p WHERE p.name = 'Ferramentas e Equipamentos');

CREATE TEMP TABLE _fm_moves (item_name text, target text);
INSERT INTO _fm_moves VALUES
  ('Alicate Pressão', 'Chaves, Alicates e Soquetes'),
  ('Alicate Universal', 'Chaves, Alicates e Soquetes'),
  ('Alicate de Corte', 'Chaves, Alicates e Soquetes'),
  ('Chave Biela L10', 'Chaves, Alicates e Soquetes'),
  ('Chave Biela L11', 'Chaves, Alicates e Soquetes'),
  ('Chave Biela L12', 'Chaves, Alicates e Soquetes'),
  ('Chave Biela L13', 'Chaves, Alicates e Soquetes'),
  ('Chave Biela L14', 'Chaves, Alicates e Soquetes'),
  ('Chave Biela L15', 'Chaves, Alicates e Soquetes'),
  ('Chave Biela L16', 'Chaves, Alicates e Soquetes'),
  ('Chave Biela L17', 'Chaves, Alicates e Soquetes'),
  ('Chave Biela L18', 'Chaves, Alicates e Soquetes'),
  ('Chave Biela L19', 'Chaves, Alicates e Soquetes'),
  ('Chave Biela L8', 'Chaves, Alicates e Soquetes'),
  ('Chave Biela L9', 'Chaves, Alicates e Soquetes'),
  ('Chave Canhão 10', 'Chaves, Alicates e Soquetes'),
  ('Chave Canhão 11', 'Chaves, Alicates e Soquetes'),
  ('Chave Canhão 12', 'Chaves, Alicates e Soquetes'),
  ('Chave Canhão 13', 'Chaves, Alicates e Soquetes'),
  ('Chave Canhão 14', 'Chaves, Alicates e Soquetes'),
  ('Chave Canhão 3', 'Chaves, Alicates e Soquetes'),
  ('Chave Canhão 4', 'Chaves, Alicates e Soquetes'),
  ('Chave Canhão 5', 'Chaves, Alicates e Soquetes'),
  ('Chave Canhão 6', 'Chaves, Alicates e Soquetes'),
  ('Chave Canhão 7', 'Chaves, Alicates e Soquetes'),
  ('Chave Canhão 8', 'Chaves, Alicates e Soquetes'),
  ('Chave Canhão 9', 'Chaves, Alicates e Soquetes'),
  ('Chave Catraca Grande', 'Chaves, Alicates e Soquetes'),
  ('Chave Catraca Media', 'Chaves, Alicates e Soquetes'),
  ('Chave Catraca Pequena', 'Chaves, Alicates e Soquetes'),
  ('Chave Fenda Grande', 'Chaves, Alicates e Soquetes'),
  ('Chave Fenda Média', 'Chaves, Alicates e Soquetes'),
  ('Chave Fenda Pequena', 'Chaves, Alicates e Soquetes'),
  ('Chave Inglesa', 'Chaves, Alicates e Soquetes'),
  ('Chave P/ Mandril', 'Chaves, Alicates e Soquetes'),
  ('Chave Philips Média', 'Chaves, Alicates e Soquetes'),
  ('Chave Torx 27', 'Chaves, Alicates e Soquetes'),
  ('Combinada 10', 'Chaves, Alicates e Soquetes'),
  ('Combinada 11', 'Chaves, Alicates e Soquetes'),
  ('Combinada 12', 'Chaves, Alicates e Soquetes'),
  ('Combinada 13', 'Chaves, Alicates e Soquetes'),
  ('Combinada 14', 'Chaves, Alicates e Soquetes'),
  ('Combinada 15', 'Chaves, Alicates e Soquetes'),
  ('Combinada 16', 'Chaves, Alicates e Soquetes'),
  ('Combinada 17', 'Chaves, Alicates e Soquetes'),
  ('Combinada 18', 'Chaves, Alicates e Soquetes'),
  ('Combinada 19', 'Chaves, Alicates e Soquetes'),
  ('Combinada 20', 'Chaves, Alicates e Soquetes'),
  ('Combinada 21', 'Chaves, Alicates e Soquetes'),
  ('Combinada 22', 'Chaves, Alicates e Soquetes'),
  ('Combinada 32', 'Chaves, Alicates e Soquetes'),
  ('Combinada 6', 'Chaves, Alicates e Soquetes'),
  ('Combinada 7', 'Chaves, Alicates e Soquetes'),
  ('Combinada 8', 'Chaves, Alicates e Soquetes'),
  ('Combinada 9', 'Chaves, Alicates e Soquetes'),
  ('Combinada Articulada 10', 'Chaves, Alicates e Soquetes'),
  ('Combinada Articulada 11', 'Chaves, Alicates e Soquetes'),
  ('Combinada Articulada 12', 'Chaves, Alicates e Soquetes'),
  ('Combinada Articulada 13', 'Chaves, Alicates e Soquetes'),
  ('Combinada Articulada 14', 'Chaves, Alicates e Soquetes'),
  ('Combinada Articulada 15', 'Chaves, Alicates e Soquetes'),
  ('Combinada Articulada 16', 'Chaves, Alicates e Soquetes'),
  ('Combinada Articulada 17', 'Chaves, Alicates e Soquetes'),
  ('Combinada Articulada 18', 'Chaves, Alicates e Soquetes'),
  ('Combinada Articulada 19', 'Chaves, Alicates e Soquetes'),
  ('Combinada Articulada 8', 'Chaves, Alicates e Soquetes'),
  ('Combinada Articulada 9', 'Chaves, Alicates e Soquetes'),
  ('Combinada Catraca 10', 'Chaves, Alicates e Soquetes'),
  ('Combinada Catraca 11', 'Chaves, Alicates e Soquetes'),
  ('Combinada Catraca 12', 'Chaves, Alicates e Soquetes'),
  ('Combinada Catraca 13', 'Chaves, Alicates e Soquetes'),
  ('Combinada Catraca 14', 'Chaves, Alicates e Soquetes'),
  ('Combinada Catraca 15', 'Chaves, Alicates e Soquetes'),
  ('Combinada Catraca 16', 'Chaves, Alicates e Soquetes'),
  ('Combinada Catraca 17', 'Chaves, Alicates e Soquetes'),
  ('Combinada Catraca 19', 'Chaves, Alicates e Soquetes'),
  ('Combinada Catraca 22', 'Chaves, Alicates e Soquetes'),
  ('Combinada Catraca 24', 'Chaves, Alicates e Soquetes'),
  ('Combinada Catraca 8', 'Chaves, Alicates e Soquetes'),
  ('Combinada Catraca 9', 'Chaves, Alicates e Soquetes'),
  ('Combinada Speedy 10', 'Chaves, Alicates e Soquetes'),
  ('Combinada Speedy 11', 'Chaves, Alicates e Soquetes'),
  ('Combinada Speedy 12', 'Chaves, Alicates e Soquetes'),
  ('Combinada Speedy 13', 'Chaves, Alicates e Soquetes'),
  ('Combinada Speedy 14', 'Chaves, Alicates e Soquetes'),
  ('Combinada Speedy 15', 'Chaves, Alicates e Soquetes'),
  ('Combinada Speedy 16', 'Chaves, Alicates e Soquetes'),
  ('Combinada Speedy 17', 'Chaves, Alicates e Soquetes'),
  ('Combinada Speedy 18', 'Chaves, Alicates e Soquetes'),
  ('Combinada Speedy 19', 'Chaves, Alicates e Soquetes'),
  ('Combinada Speedy 8', 'Chaves, Alicates e Soquetes'),
  ('Combinada Speedy 9', 'Chaves, Alicates e Soquetes'),
  ('Conjunto Chave Allen', 'Chaves, Alicates e Soquetes'),
  ('Conjunto de Chaves Fenda Phillips', 'Chaves, Alicates e Soquetes'),
  ('Esquadro Carpinteiro', 'Medição e Alinhamento'),
  ('Extensor P/ Soquete Grande', 'Chaves, Alicates e Soquetes'),
  ('Extensor p/ Soquete pequeno', 'Chaves, Alicates e Soquetes'),
  ('Extensão P/ Soquete Pequeno', 'Chaves, Alicates e Soquetes'),
  ('Kit Soquete Adaptador Macho', 'Chaves, Alicates e Soquetes'),
  ('Macho', 'Corte, Impacto e Escovas'),
  ('Macho 3/8', 'Corte, Impacto e Escovas'),
  ('Marreta Pequena', 'Corte, Impacto e Escovas'),
  ('Martelo Pena Cabo Fibra', 'Corte, Impacto e Escovas'),
  ('Morsa', 'Corte, Impacto e Escovas'),
  ('Nivel de Mão', 'Medição e Alinhamento'),
  ('Rompedor/talhadeira', 'Corte, Impacto e Escovas'),
  ('Soquete Hexagonal 4', 'Chaves, Alicates e Soquetes'),
  ('Soquete Hexagonal 5', 'Chaves, Alicates e Soquetes'),
  ('Soquete Hexagonal 6', 'Chaves, Alicates e Soquetes'),
  ('Soquete Hexagonal 7', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 10', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 10 Longo', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 11', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 11 Longo', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 12', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 12 Longo', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 13', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 13 Longo', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 14', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 14 Longo', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 15', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 15 Longo', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 16', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 16 Longo', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 17', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 18', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 19', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 32', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 6', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 7', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 7 Longo', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 8', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 8 Longo', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 9', 'Chaves, Alicates e Soquetes'),
  ('Soquete Sextavado 9 Longo', 'Chaves, Alicates e Soquetes'),
  ('Soquete Torx T-20', 'Chaves, Alicates e Soquetes'),
  ('Soquete Torx T-27', 'Chaves, Alicates e Soquetes'),
  ('Soquete Torx T-30', 'Chaves, Alicates e Soquetes'),
  ('Soquete Torx T-40 Longo', 'Chaves, Alicates e Soquetes'),
  ('Soquete allen 7/32', 'Chaves, Alicates e Soquetes'),
  ('Trena 5m', 'Medição e Alinhamento'),
  ('Trena 8m', 'Medição e Alinhamento'),
  ('Trena Dewalt Emb', 'Medição e Alinhamento'),
  ('Tripé P/ Nivel Á Laser', 'Medição e Alinhamento'),
  ('Vira Macho Reto', 'Corte, Impacto e Escovas'),
  ('kit Bits Phhillips', 'Chaves, Alicates e Soquetes');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A7','A24-skipped-unknown-item','Item', m.item_name, NULL,
       jsonb_build_object('target', m.target)
FROM _fm_moves m
WHERE NOT EXISTS (
        SELECT 1 FROM "Item" i
        JOIN "ItemCategory" c ON c.id = i."categoryId"
        WHERE i.name = m.item_name
          AND c.name IN ('Ferramentas Manuais', m.target))
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'A24-skipped-unknown-item' AND l.entity_id = m.item_name);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A7','A24-move','Item', i.id,
       jsonb_build_object('categoryId', i."categoryId"),
       jsonb_build_object('categoryName', m.target)
FROM "Item" i
JOIN "ItemCategory" c  ON c.id = i."categoryId" AND c.name = 'Ferramentas Manuais'
JOIN _fm_moves m       ON m.item_name = i.name
JOIN "ItemCategory" tc ON tc.name = m.target;

UPDATE "Item" i
SET "categoryId" = tc.id, "updatedAt" = now()
FROM "ItemCategory" c, _fm_moves m, "ItemCategory" tc
WHERE c.id = i."categoryId" AND c.name = 'Ferramentas Manuais'
  AND m.item_name = i.name AND tc.name = m.target;

-- ---------------------------------------------------------------------------
-- A25. Cross-category sweep: unambiguous misplacements only, matched by exact
--      name while still in the stated source category (twins elsewhere are
--      untouched); already-moved rows are no-ops; unknown rows logged once.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _x_moves (item_name text, from_cat text, target text);
INSERT INTO _x_moves VALUES
  ('Aerógrafo', 'Ferramentas Manuais', 'Ferramentas Pneumáticas'),
  ('Aplicador Calafetador Manual', 'Ferramentas Manuais', 'Produção'),
  ('Balde P/ Pçs de Varão', 'Ferramentas Manuais', 'Produção'),
  ('Balde Plástico', 'Ferramentas Manuais', 'Produção'),
  ('Bandeija P/pintura', 'Ferramentas Manuais', 'Produção'),
  ('Bico de Ar', 'Ferramentas Manuais', 'Ferramentas Pneumáticas'),
  ('Disco Finishing Foam', 'Ferramentas Manuais', 'Polimento'),
  ('Disco Hookit 800', 'Ferramentas Manuais', 'Lixas'),
  ('Fita Led', 'Ferramentas Manuais', 'Elétrica e Iluminação'),
  ('Garra Jacaré 400a', 'Ferramentas Manuais', 'Elétrica e Iluminação'),
  ('Garra Jacaré 600a', 'Ferramentas Manuais', 'Elétrica e Iluminação'),
  ('Lampada Led', 'Ferramentas Manuais', 'Elétrica e Iluminação'),
  ('Lixadeira Orbital', 'Ferramentas Manuais', 'Ferramentas Pneumáticas'),
  ('Maçarico', 'Ferramentas Manuais', 'Ferramentas Elétricas'),
  ('Martelete Pneumatico', 'Ferramentas Manuais', 'Ferramentas Pneumáticas'),
  ('Peneira', 'Ferramentas Manuais', 'Produção'),
  ('Pistola Pintura', 'Ferramentas Manuais', 'Ferramentas Pneumáticas'),
  ('Pistola Pintura K3', 'Ferramentas Manuais', 'Ferramentas Pneumáticas'),
  ('Plotter de Recorte', 'Ferramentas Manuais', 'Ferramentas de Plotagem'),
  ('Pá de Lixo Inox', 'Ferramentas Manuais', 'Cozinha e Limpeza'),
  ('Resina Laminação', 'Ferramentas Manuais', 'Reparo e Preparação'),
  ('Disco Flap', 'Lixas', 'Discos de Corte e Desbaste'),
  ('Disco Flap Vila', 'Lixas', 'Discos de Corte e Desbaste'),
  ('Lamina Plotter', 'Lixas', 'Ferramentas de Plotagem'),
  ('Primer Pu P/plas 1k (900ml)', 'Pigmento', 'Fundos e Primers'),
  ('Primer 8200', 'Tinta', 'Fundos e Primers'),
  ('Primer Pu Cinza', 'Tinta', 'Fundos e Primers'),
  ('Massa Plastica', 'Tinta', 'Reparo e Preparação'),
  ('Massa Poliester', 'Tinta', 'Reparo e Preparação'),
  ('Rebite de Repuxo 416', 'Peças de Reposição (Caminhões)', 'Fixadores'),
  ('Rebite de Repuxo 630', 'Peças de Reposição (Caminhões)', 'Fixadores'),
  ('Bobina Filme Stretch', 'Produção', 'Embalagem e Expedição'),
  ('Arduino Nano', 'Elétrica e Iluminação', 'Informática e Eletrônicos'),
  ('Cabo Flexivel tipo-C', 'Elétrica e Iluminação', 'Informática e Eletrônicos'),
  ('Cartão de Memória', 'Escritório', 'Informática e Eletrônicos');

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A7','A25-skipped-unknown-item','Item', m.item_name || ' @ ' || m.from_cat, NULL,
       jsonb_build_object('target', m.target)
FROM _x_moves m
WHERE NOT EXISTS (
        SELECT 1 FROM "Item" i
        JOIN "ItemCategory" c ON c.id = i."categoryId"
        WHERE i.name = m.item_name
          AND c.name IN (m.from_cat, m.target))
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'A25-skipped-unknown-item'
                    AND l.entity_id = m.item_name || ' @ ' || m.from_cat);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A7','A25-move','Item', i.id,
       jsonb_build_object('categoryId', i."categoryId", 'categoryName', m.from_cat),
       jsonb_build_object('categoryName', m.target)
FROM "Item" i
JOIN _x_moves m        ON m.item_name = i.name
JOIN "ItemCategory" c  ON c.id = i."categoryId" AND c.name = m.from_cat
JOIN "ItemCategory" tc ON tc.name = m.target;

UPDATE "Item" i
SET "categoryId" = tc.id, "updatedAt" = now()
FROM "ItemCategory" c, _x_moves m, "ItemCategory" tc
WHERE c.id = i."categoryId" AND c.name = m.from_cat
  AND m.item_name = i.name AND tc.name = m.target;

-- summary
SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A7' GROUP BY step ORDER BY step;

COMMIT;
