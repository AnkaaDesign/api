\pset pager off
\pset footer off
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

\echo '## R01 APPROVED com envelope vigente EXPIRED (DD7: ficariam sem cobrança)'
WITH vig AS (
  SELECT DISTINCT ON ("quoteId") "quoteId", status, "createdAt"
    FROM "SignatureEnvelope"
   ORDER BY "quoteId", (status::text IN ('RUNNING','COMPLETED')) DESC, "createdAt" DESC)
SELECT b."budgetNumber", v.status::text AS vigente, v."createdAt"::date AS envelope_em,
       (SELECT string_agg(x.status::text || coalesce('@' || to_char(x."approvedAt", 'YYYY-MM-DD'), ''), ',') FROM "Billing" x WHERE x."quoteId" = b.id) AS cobrancas
  FROM "Budget" b JOIN vig v ON v."quoteId" = b.id
 WHERE b.status = 'APPROVED' AND v.status::text NOT IN ('COMPLETED')
 ORDER BY 1;

\echo '## R02 APPROVED+COMPLETED: cobranças por estado'
WITH vig AS (
  SELECT DISTINCT ON ("quoteId") "quoteId", status FROM "SignatureEnvelope"
   ORDER BY "quoteId", (status::text IN ('RUNNING','COMPLETED')) DESC, "createdAt" DESC)
SELECT x.status::text, count(*) FROM "Budget" b JOIN vig v ON v."quoteId" = b.id JOIN "Billing" x ON x."quoteId" = b.id
 WHERE b.status = 'APPROVED' AND v.status::text = 'COMPLETED' GROUP BY 1 ORDER BY 1;

\echo '## R03 envelopes por mês de criação'
SELECT to_char("createdAt", 'YYYY-MM') AS mes, status::text, count(*) FROM "SignatureEnvelope" GROUP BY 1, 2 ORDER BY 1, 2;

\echo '## R04 PENDING (7) e orçamentos de 2 veículos'
SELECT b."budgetNumber", b.status::text, b."layoutScope"::text, b."createdAt"::date,
       (SELECT count(*) FROM "Task" t WHERE t."quoteId" = b.id) AS veiculos,
       (SELECT count(*) FROM "File" f WHERE f."quoteLayoutId" = b.id) AS layout_files
  FROM "Budget" b
 WHERE b.status = 'PENDING' OR (SELECT count(*) FROM "Task" t WHERE t."quoteId" = b.id) > 1
 ORDER BY 1;

\echo '## R05 tarefas vivas (não concluídas/canceladas) x arte-imagem na galeria x orçamento'
SELECT t.status::text,
       count(*) AS tarefas,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "_TaskLayouts" tl JOIN "Layout" l ON l.id = tl."A" JOIN "File" f ON f.id = l."fileId" WHERE tl."B" = t.id AND f.mimetype LIKE 'image/%' AND l.status = 'APPROVED')) AS com_imagem_aprovada,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "_TaskLayouts" tl JOIN "Layout" l ON l.id = tl."A" JOIN "File" f ON f.id = l."fileId" WHERE tl."B" = t.id AND f.mimetype LIKE 'image/%')) AS sem_imagem,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "File" q WHERE q."quoteLayoutId" = t."quoteId" AND q.mimetype LIKE 'image/%')) AS orcamento_com_layout,
       count(*) FILTER (WHERE t."quoteId" IS NULL) AS sem_orcamento,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Truck" k WHERE k."taskId" = t.id)) AS com_truck
  FROM "Task" t WHERE t.status::text NOT IN ('COMPLETED','CANCELLED')
 GROUP BY 1 ORDER BY 1;

\echo '## R06 O.S. de ARTE abertas por status da tarefa'
SELECT t.status::text AS tarefa, so.status::text AS os, count(*)
  FROM "ServiceOrder" so JOIN "Task" t ON t.id = so."taskId"
 WHERE so.type = 'ARTWORK' AND so.status::text NOT IN ('COMPLETED','CANCELLED')
 GROUP BY 1, 2 ORDER BY 1, 2;

\echo '## R07 O.S. COMERCIAL "Aprovar com o Cliente" / "Em Negociação"'
SELECT description, status::text, count(*) FROM "ServiceOrder"
 WHERE type = 'COMMERCIAL' AND (description ILIKE '%aprovar%cliente%' OR description ILIKE '%negocia%')
 GROUP BY 1, 2 ORDER BY 1, 2;

\echo '## R08 séries com Truck: vazias por status'
SELECT t.status::text, count(*) FROM "Task" t JOIN "Truck" k ON k."taskId" = t.id
 WHERE t."serialNumber" IS NULL OR btrim(t."serialNumber") = '' GROUP BY 1 ORDER BY 1;

\echo '## R09 Layout imagem ligadas a tarefas vivas por status'
SELECT l.status::text, count(DISTINCT l.id) AS layouts, count(*) AS vinculos
  FROM "_TaskLayouts" tl JOIN "Layout" l ON l.id = tl."A" JOIN "File" f ON f.id = l."fileId" JOIN "Task" t ON t.id = tl."B"
 WHERE f.mimetype LIKE 'image/%' AND t.status::text NOT IN ('COMPLETED','CANCELLED')
 GROUP BY 1 ORDER BY 1;

\echo '## R10 enums de Budget e ResponsibleRole em uso'
SELECT unnest(enum_range(NULL::"BudgetStatus"))::text AS budget_status_no_enum;
SELECT r::text AS papel, count(*) FROM "Representative", unnest(roles) r GROUP BY 1 ORDER BY 2 DESC;

\echo '## R11 _prisma_migrations: últimas'
SELECT migration_name, finished_at::date FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 6;

ROLLBACK;
