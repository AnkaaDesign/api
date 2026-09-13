-- ══════════════════════════════════════════════════════════════════════════════
-- A COBERTURA DO FATURAMENTO VIRA DADO
--
-- `TaskQuoteCustomerConfig.taskId` era nulo para dizer "cobre todas as tarefas
-- do orçamento". Duas consequências que esta migração desfaz:
--
--   1. A resposta a "de quais veículos é esta fatura?" era uma REGRA avaliada na
--      leitura, não um registro. Um caminhão acrescentado ao orçamento depois da
--      emissão passava a ser coberto por uma fatura que nunca soube dele.
--   2. Não existia meio-termo. "Os vinte primeiros no pedido 8842 e os quarenta
--      restantes no 9013" — que é como o cliente de sessenta caminhões paga — não
--      cabia em JOINT nem em PER_TASK.
--
-- A cobertura passa a ser linha em `QuoteBillingTask`, e a regra que importa
-- passa a ser garantida pelo BANCO: um veículo é cobrado por exatamente UM
-- faturamento daquele cliente (`@@unique([taskId, customerId])`).
--
-- NADA MUDA DE COMPORTAMENTO. O backfill reproduz a semântica anterior linha a
-- linha: fatia com `taskId` vira uma cobertura; fatia nula vira N coberturas,
-- uma por tarefa do orçamento. Todo orçamento existente continua `JOINT` com o
-- faturamento conjunto que já tinha.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Lotes livres ───────────────────────────────────────────────────────────
-- PG 12+ aceita ADD VALUE dentro de transação desde que o valor não seja USADO
-- na mesma transação — e não é: nenhum orçamento nasce CUSTOM aqui.
ALTER TYPE "QuoteBillingSplit" ADD VALUE IF NOT EXISTS 'CUSTOM';

-- ── 2. A tabela de cobertura ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "QuoteBillingTask" (
  "configId"   TEXT NOT NULL,
  "taskId"     TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuoteBillingTask_pkey" PRIMARY KEY ("configId", "taskId")
);

ALTER TABLE "QuoteBillingTask" DROP CONSTRAINT IF EXISTS "QuoteBillingTask_configId_fkey";
ALTER TABLE "QuoteBillingTask"
  ADD CONSTRAINT "QuoteBillingTask_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "TaskQuoteCustomerConfig"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuoteBillingTask" DROP CONSTRAINT IF EXISTS "QuoteBillingTask_taskId_fkey";
ALTER TABLE "QuoteBillingTask"
  ADD CONSTRAINT "QuoteBillingTask_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A REGRA. Um veículo, um faturamento, por cliente — nos três modos. Era o que
-- os dois índices parciais de `20260903120000_multitask_quote` tentavam dizer
-- sem conseguir, porque o NULO do JOINT não se deixa comparar.
CREATE UNIQUE INDEX IF NOT EXISTS "QuoteBillingTask_taskId_customerId_key"
  ON "QuoteBillingTask"("taskId", "customerId");
CREATE INDEX IF NOT EXISTS "QuoteBillingTask_taskId_idx" ON "QuoteBillingTask"("taskId");
CREATE INDEX IF NOT EXISTS "QuoteBillingTask_customerId_idx" ON "QuoteBillingTask"("customerId");

-- ── 3. Backfill — a semântica antiga, escrita ─────────────────────────────────
-- (a) Fatia de UM veículo (`PER_TASK`): uma linha, o veículo dela.
INSERT INTO "QuoteBillingTask" ("configId", "taskId", "customerId", "createdAt")
SELECT c."id", c."taskId", c."customerId", c."createdAt"
  FROM "TaskQuoteCustomerConfig" c
 WHERE c."taskId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- (b) Fatia conjunta (`taskId` nulo): uma linha por tarefa do orçamento.
--
-- O `NOT EXISTS` é o que impede a migração de falhar num orçamento MISTO — uma
-- fatia conjunta convivendo com fatias por veículo do mesmo cliente. Esse estado
-- não deveria existir, mas a reconciliação antiga podia produzi-lo ao trocar o
-- modo com uma gravação que não trazia `customerConfigs`; se existir, o veículo
-- fica com a fatia específica (a mais restrita), que é a leitura certa, em vez de
-- a migração abortar no índice único.
INSERT INTO "QuoteBillingTask" ("configId", "taskId", "customerId", "createdAt")
SELECT c."id", t."id", c."customerId", c."createdAt"
  FROM "TaskQuoteCustomerConfig" c
  JOIN "Task" t ON t."quoteId" = c."quoteId"
 WHERE c."taskId" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "QuoteBillingTask" b
      WHERE b."taskId" = t."id" AND b."customerId" = c."customerId"
   )
ON CONFLICT DO NOTHING;

-- ── 4. A coluna antiga sai ────────────────────────────────────────────────────
-- Mantê-la seria deixar duas fontes para a mesma pergunta, e a que deixasse de
-- ser escrita continuaria sendo lida por algum caminho (a fatura, a NFS-e, o
-- filtro de aprovação) — o modo silencioso de cobrar o caminhão errado.
DROP INDEX IF EXISTS "TaskQuoteCustomerConfig_one_joint_per_customer";
DROP INDEX IF EXISTS "TaskQuoteCustomerConfig_one_per_customer_task";
DROP INDEX IF EXISTS "TaskQuoteCustomerConfig_taskId_idx";
DROP INDEX IF EXISTS "TaskQuoteCustomerConfig_quoteId_taskId_idx";

ALTER TABLE "TaskQuoteCustomerConfig" DROP CONSTRAINT IF EXISTS "TaskQuoteCustomerConfig_taskId_fkey";
ALTER TABLE "TaskQuoteCustomerConfig" DROP COLUMN IF EXISTS "taskId";
