-- P00 — medições de PRODUÇÃO para o plano do implemento. SOMENTE LEITURA.
\pset pager off
\pset footer off
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

\echo '## Q00 carimbo'
SELECT now() AS medido_em, current_database() AS banco,
       (SELECT count(*) FROM "Task") AS tarefas,
       (SELECT count(*) FROM "Truck") AS trucks,
       (SELECT count(*) FROM "Budget") AS orcamentos,
       (SELECT max("budgetNumber") FROM "Budget") AS max_budget_number,
       (SELECT max("createdAt") FROM "Task") AS ultima_tarefa,
       (SELECT max("createdAt") FROM "File") AS ultimo_arquivo;

\echo '## Q01 Layout por tipo x status x aerografia'
SELECT CASE WHEN f.mimetype = 'application/pdf' THEN 'pdf'
            WHEN f.mimetype LIKE 'image/%' THEN 'imagem'
            ELSE coalesce(f.mimetype, '?') END AS tipo,
       l.status, (l."airbrushingId" IS NOT NULL) AS aerografia, count(*)
  FROM "Layout" l JOIN "File" f ON f.id = l."fileId"
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo '## Q02 Layout ligados a tarefa (linhas distintas e vínculos) por tipo'
SELECT CASE WHEN f.mimetype = 'application/pdf' THEN 'pdf'
            WHEN f.mimetype LIKE 'image/%' THEN 'imagem' ELSE 'outro' END AS tipo,
       count(DISTINCT l.id) AS layouts_ligados, count(*) AS vinculos
  FROM "_TaskLayouts" tl JOIN "Layout" l ON l.id = tl."A" JOIN "File" f ON f.id = l."fileId"
 GROUP BY 1 ORDER BY 1;

\echo '## Q03 fan-out (tarefas por Layout)'
WITH fo AS (SELECT tl."A" AS layout_id, count(*) AS n FROM "_TaskLayouts" tl GROUP BY 1)
SELECT max(n) AS fanout_max,
       count(*) FILTER (WHERE n = 1) AS com_1,
       count(*) FILTER (WHERE n BETWEEN 2 AND 5) AS de_2_a_5,
       count(*) FILTER (WHERE n BETWEEN 6 AND 10) AS de_6_a_10,
       count(*) FILTER (WHERE n > 10) AS mais_de_10,
       sum(n) FILTER (WHERE n > 1) AS vinculos_em_layouts_compartilhados
  FROM fo;

\echo '## Q03b os 5 maiores fan-outs (tipo, status)'
SELECT l.id, l.status, f.mimetype, count(*) AS tarefas
  FROM "_TaskLayouts" tl JOIN "Layout" l ON l.id = tl."A" JOIN "File" f ON f.id = l."fileId"
 GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 5;

\echo '## Q04 órfãos (Layout sem tarefa e sem aerografia)'
SELECT count(*) AS orfaos
  FROM "Layout" l
 WHERE l."airbrushingId" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "_TaskLayouts" tl WHERE tl."A" = l.id);

\echo '## Q05 Budget.layoutFiles (File.quoteLayoutId)'
SELECT CASE WHEN f.mimetype = 'application/pdf' THEN 'pdf'
            WHEN f.mimetype LIKE 'image/%' THEN 'imagem' ELSE 'outro' END AS tipo,
       count(*) AS arquivos, count(DISTINCT f."quoteLayoutId") AS orcamentos,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Layout" l WHERE l."fileId" = f.id)) AS mesmo_file_da_galeria
  FROM "File" f WHERE f."quoteLayoutId" IS NOT NULL
 GROUP BY 1 ORDER BY 1;

\echo '## Q05b Budget.layoutFiles por status do orçamento'
SELECT b.status::text, count(DISTINCT b.id) AS orcamentos, count(*) AS arquivos
  FROM "File" f JOIN "Budget" b ON b.id = f."quoteLayoutId"
 GROUP BY 1 ORDER BY 1;

\echo '## Q06 layoutScope por valor'
SELECT "layoutScope"::text, count(*) FROM "Budget" GROUP BY 1 ORDER BY 1;

\echo '## Q06b BudgetLayoutTask'
SELECT count(*) AS linhas, count(DISTINCT "fileId") AS arquivos, count(DISTINCT "taskId") AS tarefas,
       count(DISTINCT f."quoteLayoutId") AS orcamentos,
       count(*) FILTER (WHERE f."quoteLayoutId" IS NULL) AS arquivo_sem_orcamento
  FROM "BudgetLayoutTask" blt JOIN "File" f ON f.id = blt."fileId";

\echo '## Q06c PER_VEHICLE: veículos cobertos x descobertos'
SELECT b."budgetNumber", b.status::text,
       (SELECT count(*) FROM "Task" t WHERE t."quoteId" = b.id) AS veiculos,
       (SELECT count(DISTINCT blt."taskId") FROM "BudgetLayoutTask" blt JOIN "File" f ON f.id = blt."fileId" WHERE f."quoteLayoutId" = b.id) AS cobertos
  FROM "Budget" b WHERE b."layoutScope" = 'PER_VEHICLE' ORDER BY 1;

\echo '## Q07 Budget.status x último envelope (SQL do 08 §2.13)'
WITH last AS (SELECT DISTINCT ON ("quoteId") "quoteId", status FROM "SignatureEnvelope" ORDER BY "quoteId", "createdAt" DESC)
SELECT b.status::text, coalesce(l.status::text, '(sem envelope)') AS ultimo, count(*),
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Billing" x WHERE x."quoteId" = b.id AND (x."approvedAt" IS NOT NULL OR x.status::text IN ('APPROVED','PARTIAL','OVERDUE','SETTLED')))) AS com_cobranca_aprovada
  FROM "Budget" b LEFT JOIN last l ON l."quoteId" = b.id
 GROUP BY 1, 2 ORDER BY 1, 2;

\echo '## Q07b Budget.status x envelope VIGENTE (RUNNING/COMPLETED primeiro, senão o último)'
WITH vig AS (
  SELECT DISTINCT ON ("quoteId") "quoteId", status
    FROM "SignatureEnvelope"
   ORDER BY "quoteId", (status::text IN ('RUNNING','COMPLETED')) DESC, "createdAt" DESC)
SELECT b.status::text, coalesce(v.status::text, '(sem envelope)') AS vigente, count(*),
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Billing" x WHERE x."quoteId" = b.id AND (x."approvedAt" IS NOT NULL OR x.status::text IN ('APPROVED','PARTIAL','OVERDUE','SETTLED')))) AS com_cobranca_aprovada,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Billing" x WHERE x."quoteId" = b.id AND x."approvedAt" IS NULL AND x.status::text NOT IN ('APPROVED','PARTIAL','OVERDUE','SETTLED','CANCELLED'))) AS com_cobranca_por_aprovar
  FROM "Budget" b LEFT JOIN vig v ON v."quoteId" = b.id
 GROUP BY 1, 2 ORDER BY 1, 2;

\echo '## Q07c DD7: APROVADOS com coleta viva (RUNNING) e cobrança ainda por aprovar'
WITH vig AS (
  SELECT DISTINCT ON ("quoteId") "quoteId", status
    FROM "SignatureEnvelope"
   ORDER BY "quoteId", (status::text IN ('RUNNING','COMPLETED')) DESC, "createdAt" DESC)
SELECT b."budgetNumber", v.status::text AS vigente,
       (SELECT string_agg(x.status::text || coalesce('@' || to_char(x."approvedAt", 'YYYY-MM-DD'), ''), ',') FROM "Billing" x WHERE x."quoteId" = b.id) AS cobrancas
  FROM "Budget" b JOIN vig v ON v."quoteId" = b.id
 WHERE b.status = 'APPROVED' AND v.status::text = 'RUNNING'
 ORDER BY 1;

\echo '## Q08 envelopes por status: com arte, com cobertura por veículo, formato v1/v2'
SELECT status::text, count(*),
       count(*) FILTER (WHERE jsonb_typeof("quoteSnapshot"->'layoutFileIds') = 'array' AND jsonb_array_length("quoteSnapshot"->'layoutFileIds') > 0) AS com_arte,
       count(*) FILTER (WHERE "quoteSnapshot" ? 'layoutCoverage') AS com_layout_coverage,
       count(*) FILTER (WHERE "quoteSnapshot" ? 'truck') AS formato_v1_v2
  FROM "SignatureEnvelope" GROUP BY 1 ORDER BY 1;

\echo '## Q08b documentos com seção LAYOUT'
SELECT count(*) AS docs_com_layout FROM "EnvelopeDocument" WHERE 'LAYOUT' = ANY(sections);

\echo '## Q09 veículos em envelopes RUNNING/COMPLETED com série congelada != série atual'
SELECT e.status::text, count(*) AS veiculos,
       count(*) FILTER (WHERE t.id IS NULL) AS tarefa_sumiu,
       count(*) FILTER (WHERE t.id IS NOT NULL AND (v->>'serialNumber') IS DISTINCT FROM t."serialNumber") AS serie_diferente
  FROM "SignatureEnvelope" e
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e."quoteSnapshot"->'vehicles') = 'array' THEN e."quoteSnapshot"->'vehicles' ELSE '[]'::jsonb END) v
  LEFT JOIN "Task" t ON t.id = v->>'taskId'
 WHERE e.status::text IN ('RUNNING','COMPLETED')
 GROUP BY 1 ORDER BY 1;

\echo '## Q10 tarefas sem Truck'
SELECT t.status::text, count(*), min(t."createdAt")::date AS de, max(t."createdAt")::date AS ate
  FROM "Task" t WHERE NOT EXISTS (SELECT 1 FROM "Truck" k WHERE k."taskId" = t.id)
 GROUP BY 1 ORDER BY 1;

\echo '## Q11 séries: preenchidas / nulas / vazias / duplicadas / fora do regex'
SELECT count(*) FILTER (WHERE "serialNumber" IS NOT NULL AND btrim("serialNumber") <> '') AS preenchidas,
       count(*) FILTER (WHERE "serialNumber" IS NULL) AS nulas,
       count(*) FILTER (WHERE "serialNumber" IS NOT NULL AND btrim("serialNumber") = '') AS vazias,
       count(*) FILTER (WHERE "serialNumber" !~ '^[A-Z0-9-]+$') AS fora_regex_web_cru,
       count(*) FILTER (WHERE upper(btrim("serialNumber")) !~ '^[A-Z0-9-]+$') AS fora_regex_api_normalizado,
       max(length("serialNumber")) AS maior
  FROM "Task";

\echo '## Q11b séries duplicadas (lower/trim)'
SELECT count(*) AS grupos_duplicados, coalesce(sum(n), 0) AS tarefas_envolvidas
  FROM (SELECT lower(btrim("serialNumber")) s, count(*) n FROM "Task"
         WHERE "serialNumber" IS NOT NULL AND btrim("serialNumber") <> '' GROUP BY 1 HAVING count(*) > 1) d;

\echo '## Q11c amostra das duplicadas (até 15)'
SELECT lower(btrim("serialNumber")) AS serie, count(*) AS n,
       string_agg(status::text, ',' ORDER BY "createdAt") AS status,
       string_agg(("createdAt")::date::text, ',' ORDER BY "createdAt") AS criadas
  FROM "Task" WHERE "serialNumber" IS NOT NULL AND btrim("serialNumber") <> ''
 GROUP BY 1 HAVING count(*) > 1 ORDER BY 2 DESC, 1 LIMIT 15;

\echo '## Q11d forma das séries (tem Truck? x forma)'
SELECT EXISTS (SELECT 1 FROM "Truck" k WHERE k."taskId" = t.id) AS tem_truck,
       CASE WHEN t."serialNumber" IS NULL OR btrim(t."serialNumber") = '' THEN 'vazia'
            WHEN upper(btrim(t."serialNumber")) ~ '^[A-Z]{3}-?[0-9][A-Z0-9][0-9]{2}$' THEN 'placa'
            WHEN upper(btrim(t."serialNumber")) ~ '^CH' THEN 'chassi'
            WHEN btrim(t."serialNumber") ~ '^[0-9]+$' THEN 'numerica'
            WHEN btrim(t."serialNumber") ~ '^[0-9]+-[0-9]+$' THEN 'numerica_com_hifen'
            WHEN btrim(t."serialNumber") !~ '[A-Za-z0-9]{2,}' THEN 'marcador'
            ELSE 'outra' END AS forma,
       count(*)
  FROM "Task" t GROUP BY 1, 2 ORDER BY 1, 2;

\echo '## Q11e fora do regex web (amostra 20)'
SELECT '"' || "serialNumber" || '"' AS serie, status::text FROM "Task"
 WHERE "serialNumber" !~ '^[A-Z0-9-]+$' ORDER BY "createdAt" DESC LIMIT 20;

\echo '## Q12 medidas compartilhadas (mesma ImplementMeasure em mais de um Truck/face)'
WITH refs AS (
  SELECT "leftSideMeasureId" AS m, id AS truck FROM "Truck" WHERE "leftSideMeasureId" IS NOT NULL
  UNION ALL SELECT "rightSideMeasureId", id FROM "Truck" WHERE "rightSideMeasureId" IS NOT NULL
  UNION ALL SELECT "backSideMeasureId", id FROM "Truck" WHERE "backSideMeasureId" IS NOT NULL),
agg AS (SELECT m, count(*) AS usos, count(DISTINCT truck) AS trucks FROM refs GROUP BY m)
SELECT (SELECT count(*) FROM "ImplementMeasure") AS medidas_total,
       count(*) FILTER (WHERE usos > 1) AS medidas_compartilhadas,
       (SELECT count(DISTINCT r.truck) FROM refs r JOIN agg a ON a.m = r.m WHERE a.usos > 1) AS trucks_envolvidos,
       coalesce(sum(usos - 1) FILTER (WHERE usos > 1), 0) AS copias_necessarias,
       max(usos) AS max_usos
  FROM agg;

\echo '## Q13 projectFiles da tarefa'
SELECT count(*) AS vinculos, count(DISTINCT "A") AS arquivos, count(DISTINCT "B") AS tarefas FROM "_TASK_PROJECT_FILES";

\echo '## Q13b baseFiles com cara de projeto Furgões'
SELECT (t.status::text = 'COMPLETED') AS tarefa_concluida,
       count(*) FILTER (WHERE f.mimetype = 'application/pdf') AS pdfs_base,
       count(*) FILTER (WHERE f.mimetype = 'application/pdf' AND (upper(coalesce(f."originalName", f.filename)) ~ '^PROJETO' OR upper(coalesce(f."originalName", f.filename)) ~ '^[0-9]{5}.*LAYOUT')) AS cara_de_furgoes,
       count(*) FILTER (WHERE f.mimetype = 'application/pdf' AND (upper(coalesce(f."originalName", f.filename)) ~ '^PROJETO' OR upper(coalesce(f."originalName", f.filename)) ~ '^[0-9]{5}.*LAYOUT')
                        AND t."serialNumber" IS NOT NULL AND btrim(t."serialNumber") <> '' AND position(btrim(t."serialNumber") IN coalesce(f."originalName", f.filename)) > 0) AS cita_a_serie
  FROM "_TASK_BASE_FILES" bf JOIN "File" f ON f.id = bf."A" JOIN "Task" t ON t.id = bf."B"
 GROUP BY 1 ORDER BY 1;

\echo '## Q14 O.S. de ARTE por status'
SELECT status::text, count(*) FROM "ServiceOrder" WHERE type = 'ARTWORK' GROUP BY 1 ORDER BY 1;

\echo '## Q14b O.S. ARTE em WAITING_APPROVE: o que a tarefa tem na galeria'
SELECT count(*) AS os,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "_TaskLayouts" tl JOIN "Layout" l ON l.id = tl."A" JOIN "File" f ON f.id = l."fileId" WHERE tl."B" = so."taskId" AND f.mimetype LIKE 'image/%' AND l.status = 'APPROVED')) AS com_imagem_aprovada,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "_TaskLayouts" tl JOIN "Layout" l ON l.id = tl."A" JOIN "File" f ON f.id = l."fileId" WHERE tl."B" = so."taskId" AND f.mimetype LIKE 'image/%' AND l.status = 'DRAFT')) AS com_imagem_rascunho,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "_TaskLayouts" tl JOIN "Layout" l ON l.id = tl."A" JOIN "File" f ON f.id = l."fileId" WHERE tl."B" = so."taskId" AND f.mimetype LIKE 'image/%')) AS sem_imagem,
       count(DISTINCT so."taskId") AS tarefas
  FROM "ServiceOrder" so WHERE so.type = 'ARTWORK' AND so.status = 'WAITING_APPROVE';

\echo '## Q15 orçamentos com layout: imagem APROVADA da galeria fora do layout do orçamento'
WITH ql AS (SELECT DISTINCT "quoteLayoutId" AS qid FROM "File" WHERE "quoteLayoutId" IS NOT NULL)
SELECT count(*) AS orcamentos_com_layout,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM "Task" t JOIN "_TaskLayouts" tl ON tl."B" = t.id JOIN "Layout" l ON l.id = tl."A" JOIN "File" g ON g.id = l."fileId"
          WHERE t."quoteId" = ql.qid AND l.status = 'APPROVED' AND g.mimetype LIKE 'image/%'
            AND NOT EXISTS (SELECT 1 FROM "File" q WHERE q."quoteLayoutId" = ql.qid AND q.id = g.id))) AS com_aprovada_fora,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "Task" t WHERE t."quoteId" = ql.qid)) AS sem_tarefa
  FROM ql;

\echo '## Q15b gêmeo DRAFT: arquivo do orçamento com homônimo em rascunho na galeria (outro File.id)'
SELECT count(*) AS pares
  FROM "File" q JOIN "Task" t ON t."quoteId" = q."quoteLayoutId"
  JOIN "_TaskLayouts" tl ON tl."B" = t.id JOIN "Layout" l ON l.id = tl."A" JOIN "File" g ON g.id = l."fileId"
 WHERE q."quoteLayoutId" IS NOT NULL AND g.id <> q.id AND l.status = 'DRAFT'
   AND coalesce(g."originalName", g.filename) = coalesce(q."originalName", q.filename);

\echo '## Q16 orçamentos por número de veículos'
SELECT CASE WHEN n = 0 THEN '0' WHEN n = 1 THEN '1' WHEN n <= 5 THEN '2-5' WHEN n <= 20 THEN '6-20' ELSE '21+' END AS veiculos,
       count(*), max(n)
  FROM (SELECT b.id, (SELECT count(*) FROM "Task" t WHERE t."quoteId" = b.id) AS n FROM "Budget" b) x
 GROUP BY 1 ORDER BY 1;

\echo '## Q17 enums em uso no Truck'
SELECT category::text, "implementType"::text, count(*) FROM "Truck" GROUP BY 1, 2 ORDER BY 3 DESC;

\echo '## Q17b spot dos Trucks de tarefas concluídas'
SELECT t.status::text AS tarefa, k.spot::text, count(*) FROM "Truck" k JOIN "Task" t ON t.id = k."taskId" GROUP BY 1, 2 ORDER BY 1, 2;

\echo '## Q18 preferências com chaves truck/layout'
SELECT count(*) FILTER (WHERE "dashboardLayoutWeb"::text ~ '"(truckCategories|implementTypes|hasTruck|truckCategory|implementType|hasLayouts)"') AS dash_web,
       count(*) FILTER (WHERE "dashboardLayoutMobile"::text ILIKE '%layouts%') AS dash_mobile,
       count(*) FILTER (WHERE "tableConfigsWeb"::text ~ '(truckCategory|implementType|truckSpot)') AS table_web,
       count(*) FILTER (WHERE "detailConfigsWeb"::text ~ '(truckCategory|implementType|truckSpot|"layouts")') AS detail_web
  FROM "Preferences";

\echo '## Q19 histórico e notificações com truck/layout'
SELECT "entityType"::text, count(*) FROM "ChangeLog" WHERE "entityType"::text IN ('TRUCK','IMPLEMENT_MEASURE') GROUP BY 1;
SELECT key, enabled FROM "NotificationConfiguration" WHERE key ILIKE '%truck%' OR key ILIKE 'task.field.layout%' OR key ILIKE 'task.field.project%' OR key ILIKE 'task.field.serial%' ORDER BY 1;

\echo '## Q20 aerografia'
SELECT (SELECT count(*) FROM "Airbrushing") AS aerografias, (SELECT count(*) FROM "Layout" WHERE "airbrushingId" IS NOT NULL) AS layouts_de_aerografia;

ROLLBACK;
