-- QUANTOS VEÍCULOS o orçamento cobre, desnormalizado em `TaskQuote`.
--
-- `total` é o valor do CONTRATO (`por veículo × N`) desde o orçamento
-- multitarefa. As telas que listam TAREFAS — Orçamentos, Faturamento,
-- Preparação, Histórico — mostram uma linha por veículo e liam `quote.total`
-- como "o valor desta linha": num orçamento de sessenta caminhões cada linha
-- afirmava R$ 730.224,00, e o painel de receita, que soma linha a linha,
-- chegava a R$ 43,8 milhões. Com esta coluna a linha divide e volta a dizer
-- R$ 12.170,40, e a soma das sessenta dá o contrato de novo.
--
-- Idempotente: a coluna nasce com 1 (o caso de todo orçamento de um veículo) e
-- o backfill corrige os que cobrem mais de um.
ALTER TABLE "TaskQuote" ADD COLUMN IF NOT EXISTS "vehicleCount" INTEGER NOT NULL DEFAULT 1;

-- Backfill: a contagem real de tarefas, com o piso em 1 para o orçamento que
-- ainda não tem tarefa vinculada (o registro nasce antes do vínculo) — dividir
-- por zero é o único resultado que a tela não sabe exibir.
UPDATE "TaskQuote" q
SET "vehicleCount" = GREATEST(1, (SELECT COUNT(*) FROM "Task" t WHERE t."quoteId" = q."id"))
WHERE q."vehicleCount" IS DISTINCT FROM GREATEST(1, (SELECT COUNT(*) FROM "Task" t WHERE t."quoteId" = q."id"));
