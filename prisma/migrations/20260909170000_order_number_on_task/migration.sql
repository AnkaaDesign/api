-- O NÚMERO DO PEDIDO DE COMPRA SAI DO CLIENTE E VAI PARA O VEÍCULO.
--
-- `TaskQuoteCustomerConfig.orderNumber` era uma linha por CLIENTE do orçamento.
-- Com um orçamento cobrindo N caminhões, os sessenta passavam a citar o MESMO
-- pedido na nota fiscal e no boleto — e o pedido de compra é por ENTREGA: às
-- vezes é o mesmo para todos, às vezes muda a cada veículo, às vezes vem em
-- blocos. Às vezes coincidir não faz dele uma regra.
--
-- Livre e NÃO único: repetir o mesmo número em vários veículos é caso legítimo.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "customerOrderNumber" TEXT;

-- Backfill: o número da fatia desce para as tarefas que ela cobre. A fatia com
-- `taskId` preenchido (cobrança veículo a veículo) responde só pelo veículo
-- dela; a fatia conjunta (`taskId` nulo) responde por todas as tarefas do
-- orçamento. Quando duas configurações do mesmo orçamento têm números
-- diferentes (orçamento com dois clientes), vence a mais antiga — é a que a tela
-- mostrava primeiro.
UPDATE "Task" t
SET "customerOrderNumber" = sub."orderNumber"
FROM (
  SELECT DISTINCT ON (c."quoteId", COALESCE(c."taskId", '*'))
         c."quoteId", c."taskId", c."orderNumber"
  FROM "TaskQuoteCustomerConfig" c
  WHERE c."orderNumber" IS NOT NULL AND btrim(c."orderNumber") <> ''
  ORDER BY c."quoteId", COALESCE(c."taskId", '*'), c."createdAt" ASC
) AS sub
WHERE sub."quoteId" = t."quoteId"
  AND (sub."taskId" IS NULL OR sub."taskId" = t."id")
  AND t."customerOrderNumber" IS NULL;

-- Procurado pela regra de atenção "pedido em falta" e pelo filtro das listas.
CREATE INDEX IF NOT EXISTS "Task_customerOrderNumber_idx" ON "Task"("customerOrderNumber");

-- A coluna antiga SAI. Mantê-la seria deixar duas fontes para o mesmo número —
-- e a que a tela deixasse de escrever continuaria sendo lida por algum caminho
-- (a nota, o boleto, a regra de atenção), que é o modo silencioso de a nota
-- fiscal sair com o pedido errado.
ALTER TABLE "TaskQuoteCustomerConfig" DROP COLUMN IF EXISTS "orderNumber";
