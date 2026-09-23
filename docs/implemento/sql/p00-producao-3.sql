\pset pager off
\pset footer off
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
\echo '## V01 versões do app nas assinaturas de EPI e advertência (últimos 30 dias)'
SELECT 'PpeDeliverySignature' AS origem, coalesce("appVersion", '(nulo)') AS versao, count(*), max("createdAt")::date AS ultima
  FROM "PpeDeliverySignature" WHERE "createdAt" > now() - interval '30 days' GROUP BY 1, 2
UNION ALL
SELECT 'WarningSignature', coalesce("appVersion", '(nulo)'), count(*), max("createdAt")::date
  FROM "WarningSignature" WHERE "createdAt" > now() - interval '30 days' GROUP BY 1, 2
ORDER BY 1, 2;
\echo '## V02 versões do app (todo o período, últimas 8)'
SELECT coalesce("appVersion", '(nulo)') AS versao, count(*), min("createdAt")::date AS primeira, max("createdAt")::date AS ultima
  FROM (SELECT "appVersion", "createdAt" FROM "PpeDeliverySignature" UNION ALL SELECT "appVersion", "createdAt" FROM "WarningSignature") x
 GROUP BY 1 ORDER BY max("createdAt") DESC LIMIT 8;
ROLLBACK;
