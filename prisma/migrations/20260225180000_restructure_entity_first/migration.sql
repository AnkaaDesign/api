-- File Storage Restructuring: Entity-First Organization
-- Transforms File.path from type-first layout to entity-first layout
--
-- OLD: /srv/files/Orcamentos/Tarefas/{customer}/file.pdf
-- NEW: /srv/files/Clientes/{customer}/Orcamentos/file.pdf
--
-- Order is CRITICAL:
-- 1. Process nested/specific paths first (Aerografias financial, External Withdrawal)
-- 2. Then task/order financial paths
-- 3. Then simple customer/supplier paths
-- 4. Each category: "Notas Fiscais Reembolso" BEFORE "Notas Fiscais" (prefix overlap)
-- 5. Every UPDATE has NOT LIKE guard to prevent double-transformation

-- ============================================================
-- 1. AIRBRUSHING FINANCIAL (customer-based)
-- Pattern: {type}/Aerografias/{customer}/ → Clientes/{customer}/Aerografias/{type}/
-- ============================================================

-- Airbrushing: Notas Fiscais Reembolso (MUST be before Notas Fiscais)
UPDATE "File"
SET path = regexp_replace(path, '/Notas Fiscais Reembolso/Aerografias/([^/]+)/', '/Clientes/\1/Aerografias/Notas Fiscais Reembolso/')
WHERE path LIKE '%/Notas Fiscais Reembolso/Aerografias/%'
  AND path NOT LIKE '%/Clientes/%';

-- Airbrushing: Notas Fiscais
UPDATE "File"
SET path = regexp_replace(path, '/Notas Fiscais/Aerografias/([^/]+)/', '/Clientes/\1/Aerografias/Notas Fiscais/')
WHERE path LIKE '%/Notas Fiscais/Aerografias/%'
  AND path NOT LIKE '%/Clientes/%';

-- Airbrushing: Orcamentos
UPDATE "File"
SET path = regexp_replace(path, '/Orcamentos/Aerografias/([^/]+)/', '/Clientes/\1/Aerografias/Orcamentos/')
WHERE path LIKE '%/Orcamentos/Aerografias/%'
  AND path NOT LIKE '%/Clientes/%';

-- Airbrushing: Comprovantes
UPDATE "File"
SET path = regexp_replace(path, '/Comprovantes/Aerografias/([^/]+)/', '/Clientes/\1/Aerografias/Comprovantes/')
WHERE path LIKE '%/Comprovantes/Aerografias/%'
  AND path NOT LIKE '%/Clientes/%';

-- Airbrushing: Reembolsos
UPDATE "File"
SET path = regexp_replace(path, '/Reembolsos/Aerografias/([^/]+)/', '/Clientes/\1/Aerografias/Reembolsos/')
WHERE path LIKE '%/Reembolsos/Aerografias/%'
  AND path NOT LIKE '%/Clientes/%';

-- ============================================================
-- 2. TASK FINANCIAL (customer-based)
-- Pattern: {type}/Tarefas/{customer}/ → Clientes/{customer}/{type}/
-- ============================================================

-- Tasks: Notas Fiscais Reembolso (MUST be before Notas Fiscais)
UPDATE "File"
SET path = regexp_replace(path, '/Notas Fiscais Reembolso/Tarefas/([^/]+)/', '/Clientes/\1/Notas Fiscais Reembolso/')
WHERE path LIKE '%/Notas Fiscais Reembolso/Tarefas/%'
  AND path NOT LIKE '%/Clientes/%';

-- Tasks: Notas Fiscais
UPDATE "File"
SET path = regexp_replace(path, '/Notas Fiscais/Tarefas/([^/]+)/', '/Clientes/\1/Notas Fiscais/')
WHERE path LIKE '%/Notas Fiscais/Tarefas/%'
  AND path NOT LIKE '%/Clientes/%';

-- Tasks: Orcamentos
UPDATE "File"
SET path = regexp_replace(path, '/Orcamentos/Tarefas/([^/]+)/', '/Clientes/\1/Orcamentos/')
WHERE path LIKE '%/Orcamentos/Tarefas/%'
  AND path NOT LIKE '%/Clientes/%';

-- Tasks: Comprovantes
UPDATE "File"
SET path = regexp_replace(path, '/Comprovantes/Tarefas/([^/]+)/', '/Clientes/\1/Comprovantes/')
WHERE path LIKE '%/Comprovantes/Tarefas/%'
  AND path NOT LIKE '%/Clientes/%';

-- Tasks: Reembolsos
UPDATE "File"
SET path = regexp_replace(path, '/Reembolsos/Tarefas/([^/]+)/', '/Clientes/\1/Reembolsos/')
WHERE path LIKE '%/Reembolsos/Tarefas/%'
  AND path NOT LIKE '%/Clientes/%';

-- Tasks: Boletos
UPDATE "File"
SET path = regexp_replace(path, '/Boletos/Tarefas/([^/]+)/', '/Clientes/\1/Boletos/')
WHERE path LIKE '%/Boletos/Tarefas/%'
  AND path NOT LIKE '%/Clientes/%';

-- ============================================================
-- 3. ORDER FINANCIAL (supplier-based)
-- Pattern: {type}/Pedidos/{supplier}/ → Fornecedores/{supplier}/{type}/
-- ============================================================

-- Orders: Notas Fiscais Reembolso (MUST be before Notas Fiscais)
UPDATE "File"
SET path = regexp_replace(path, '/Notas Fiscais Reembolso/Pedidos/([^/]+)/', '/Fornecedores/\1/Notas Fiscais Reembolso/')
WHERE path LIKE '%/Notas Fiscais Reembolso/Pedidos/%'
  AND path NOT LIKE '%/Fornecedores/%';

-- Orders: Notas Fiscais
UPDATE "File"
SET path = regexp_replace(path, '/Notas Fiscais/Pedidos/([^/]+)/', '/Fornecedores/\1/Notas Fiscais/')
WHERE path LIKE '%/Notas Fiscais/Pedidos/%'
  AND path NOT LIKE '%/Fornecedores/%';

-- Orders: Orcamentos
UPDATE "File"
SET path = regexp_replace(path, '/Orcamentos/Pedidos/([^/]+)/', '/Fornecedores/\1/Orcamentos/')
WHERE path LIKE '%/Orcamentos/Pedidos/%'
  AND path NOT LIKE '%/Fornecedores/%';

-- Orders: Comprovantes
UPDATE "File"
SET path = regexp_replace(path, '/Comprovantes/Pedidos/([^/]+)/', '/Fornecedores/\1/Comprovantes/')
WHERE path LIKE '%/Comprovantes/Pedidos/%'
  AND path NOT LIKE '%/Fornecedores/%';

-- Orders: Reembolsos
UPDATE "File"
SET path = regexp_replace(path, '/Reembolsos/Pedidos/([^/]+)/', '/Fornecedores/\1/Reembolsos/')
WHERE path LIKE '%/Reembolsos/Pedidos/%'
  AND path NOT LIKE '%/Fornecedores/%';

-- ============================================================
-- 4. SIMPLE CUSTOMER PATHS
-- Pattern: {folder}/{customer}/ → Clientes/{customer}/{folder}/
-- ============================================================

-- Layouts/{customer}/ → Clientes/{customer}/Layouts/
UPDATE "File"
SET path = regexp_replace(path, '/Layouts/([^/]+)/', '/Clientes/\1/Layouts/')
WHERE path LIKE '%/Layouts/%'
  AND path NOT LIKE '%/Clientes/%';

-- Projetos/{customer}/ → Clientes/{customer}/Projetos/
UPDATE "File"
SET path = regexp_replace(path, '/Projetos/([^/]+)/', '/Clientes/\1/Projetos/')
WHERE path LIKE '%/Projetos/%'
  AND path NOT LIKE '%/Clientes/%';

-- Checkin/{customer}/ → Clientes/{customer}/Checkin/
UPDATE "File"
SET path = regexp_replace(path, '/Checkin/([^/]+)/', '/Clientes/\1/Checkin/')
WHERE path LIKE '%/Checkin/%'
  AND path NOT LIKE '%/Clientes/%';

-- Checkout/{customer}/ → Clientes/{customer}/Checkout/
UPDATE "File"
SET path = regexp_replace(path, '/Checkout/([^/]+)/', '/Clientes/\1/Checkout/')
WHERE path LIKE '%/Checkout/%'
  AND path NOT LIKE '%/Clientes/%';

-- Aerografias/{customer}/ → Clientes/{customer}/Aerografias/
UPDATE "File"
SET path = regexp_replace(path, '/Aerografias/([^/]+)/', '/Clientes/\1/Aerografias/')
WHERE path LIKE '%/Aerografias/%'
  AND path NOT LIKE '%/Clientes/%';

-- Traseiras/{customer}/ → Clientes/{customer}/Traseiras/
UPDATE "File"
SET path = regexp_replace(path, '/Traseiras/([^/]+)/', '/Clientes/\1/Traseiras/')
WHERE path LIKE '%/Traseiras/%'
  AND path NOT LIKE '%/Clientes/%';

-- Plotter/{customer}/ → Clientes/{customer}/Plotter/
UPDATE "File"
SET path = regexp_replace(path, '/Plotter/([^/]+)/', '/Clientes/\1/Plotter/')
WHERE path LIKE '%/Plotter/%'
  AND path NOT LIKE '%/Clientes/%';

-- Observacoes/{customer}/ → Clientes/{customer}/Observacoes/
UPDATE "File"
SET path = regexp_replace(path, '/Observacoes/([^/]+)/', '/Clientes/\1/Observacoes/')
WHERE path LIKE '%/Observacoes/%'
  AND path NOT LIKE '%/Clientes/%';

-- ============================================================
-- 5. LOGOS
-- ============================================================

-- Logos/Clientes/{customer}/ → Clientes/{customer}/Logo/
UPDATE "File"
SET path = regexp_replace(path, '/Logos/Clientes/([^/]+)/', '/Clientes/\1/Logo/')
WHERE path LIKE '%/Logos/Clientes/%'
  AND path NOT LIKE '%/Clientes/%/Logo/%';

-- Logos/Fornecedores/{supplier}/ → Fornecedores/{supplier}/Logo/
UPDATE "File"
SET path = regexp_replace(path, '/Logos/Fornecedores/([^/]+)/', '/Fornecedores/\1/Logo/')
WHERE path LIKE '%/Logos/Fornecedores/%'
  AND path NOT LIKE '%/Fornecedores/%/Logo/%';

-- ============================================================
-- 6. BASE FILES RENAME
-- Arquivos Clientes/{customer}/ → Clientes/{customer}/Outros/
-- ============================================================

UPDATE "File"
SET path = regexp_replace(path, '/Arquivos Clientes/([^/]+)/', '/Clientes/\1/Outros/')
WHERE path LIKE '%/Arquivos Clientes/%'
  AND path NOT LIKE '%/Clientes/%';

-- ============================================================
-- 7. USER FOLDERS
-- Colaboradores/{userName}/ → Colaboradores/{userName}/Fotos/ (avatar stays same parent)
-- Colaboradores/Documentos/{userName}/ → Colaboradores/{userName}/EPIs/
-- Advertencias/{userName}/ → Colaboradores/{userName}/Advertencias/
-- ============================================================

-- Colaboradores/Documentos/{userName}/ → Colaboradores/{userName}/EPIs/
UPDATE "File"
SET path = regexp_replace(path, '/Colaboradores/Documentos/([^/]+)/', '/Colaboradores/\1/EPIs/')
WHERE path LIKE '%/Colaboradores/Documentos/%';

-- Advertencias/{userName}/ → Colaboradores/{userName}/Advertencias/
UPDATE "File"
SET path = regexp_replace(path, '/Advertencias/([^/]+)/', '/Colaboradores/\1/Advertencias/')
WHERE path LIKE '%/Advertencias/%'
  AND path NOT LIKE '%/Colaboradores/%';

-- Colaboradores/{userName}/file → Colaboradores/{userName}/Fotos/file
-- Only for files directly in user folder (avatar), not in subfolders
UPDATE "File"
SET path = regexp_replace(path, '/Colaboradores/([^/]+)/([^/]+)$', '/Colaboradores/\1/Fotos/\2')
WHERE path ~ '/Colaboradores/[^/]+/[^/]+$'
  AND path NOT LIKE '%/Colaboradores/%/Fotos/%'
  AND path NOT LIKE '%/Colaboradores/%/EPIs/%'
  AND path NOT LIKE '%/Colaboradores/%/Advertencias/%';

-- ============================================================
-- VERIFICATION QUERIES (commented out — run manually after migration)
-- ============================================================

-- Check for double-transforms:
-- SELECT id, path FROM "File" WHERE path LIKE '%/Clientes/Clientes/%' OR path LIKE '%/Fornecedores/Fornecedores/%';

-- Check for old patterns still present:
-- SELECT id, path FROM "File" WHERE path LIKE '%/Orcamentos/Tarefas/%' OR path LIKE '%/Notas Fiscais/Tarefas/%' OR path LIKE '%/Layouts/%' AND path NOT LIKE '%/Clientes/%';
