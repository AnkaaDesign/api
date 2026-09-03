-- ══════════════════════════════════════════════════════════════════════════════
-- ORÇAMENTO MULTITAREFA
--
-- Até aqui a relação tarefa↔orçamento era 1:1 (`Task_quoteId_key`), e a tela de
-- criação — que já produzia N tarefas do produto cartesiano placas × números de
-- série — emitia um orçamento para CADA uma. O Marquespan de 02/09 saiu assim:
-- orçamentos 642 a 701, sessenta números, sessenta PDFs, sessenta cerimônias de
-- assinatura, todos com a mesma lista (Logomarca Laterais R$ 4.545, Logomarca
-- Traseira R$ 1.285, Aerografia Parcial R$ 8.000) e o mesmo total de
-- R$ 12.170,40. Um orçamento passa a cobrir os sessenta.
--
-- NADA É MIGRADO. Todo orçamento existente continua com a sua única tarefa e com
-- `billingSplit = JOINT`, que é byte a byte o comportamento anterior. Agrupar os
-- irmãos já emitidos apagaria cinquenta e nove números de orçamento que o
-- cliente já viu.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Uma tarefa por orçamento deixa de ser regra ────────────────────────────
DROP INDEX IF EXISTS "Task_quoteId_key";
CREATE INDEX IF NOT EXISTS "Task_quoteId_idx" ON "Task"("quoteId");

-- ── 2. Junto ou separado ──────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "QuoteBillingSplit" AS ENUM ('JOINT', 'PER_TASK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "TaskQuote"
  ADD COLUMN IF NOT EXISTS "billingSplit" "QuoteBillingSplit" NOT NULL DEFAULT 'JOINT';

-- ── 3. A configuração de faturamento pode ser de UMA tarefa ───────────────────
ALTER TABLE "TaskQuoteCustomerConfig"
  ADD COLUMN IF NOT EXISTS "taskId" TEXT,
  ADD COLUMN IF NOT EXISTS "billingApprovedAt" TIMESTAMP(3);

ALTER TABLE "TaskQuoteCustomerConfig"
  DROP CONSTRAINT IF EXISTS "TaskQuoteCustomerConfig_taskId_fkey";
ALTER TABLE "TaskQuoteCustomerConfig"
  ADD CONSTRAINT "TaskQuoteCustomerConfig_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A unicidade antiga era `(quoteId, customerId)`. Ela não sobrevive à coluna
-- nova: com `PER_TASK` o mesmo cliente tem UMA configuração por veículo. E não dá
-- para trocá-la por `(quoteId, customerId, taskId)`, porque no Postgres NULO
-- nunca é igual a NULO — duas configurações JOINT do mesmo cliente passariam.
-- São dois índices parciais, um para cada forma.
DROP INDEX IF EXISTS "TaskQuoteCustomerConfig_quoteId_customerId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "TaskQuoteCustomerConfig_one_joint_per_customer"
  ON "TaskQuoteCustomerConfig"("quoteId", "customerId")
  WHERE "taskId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "TaskQuoteCustomerConfig_one_per_customer_task"
  ON "TaskQuoteCustomerConfig"("quoteId", "customerId", "taskId")
  WHERE "taskId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "TaskQuoteCustomerConfig_taskId_idx"
  ON "TaskQuoteCustomerConfig"("taskId");
CREATE INDEX IF NOT EXISTS "TaskQuoteCustomerConfig_quoteId_taskId_idx"
  ON "TaskQuoteCustomerConfig"("quoteId", "taskId");

-- ── 4. A NFS-e passa a ter âncora no orçamento ────────────────────────────────
-- `taskId` continua e continua sendo a resposta certa quando a nota é de UM
-- veículo. Quando ela cobre os sessenta (JOINT), escolher um deles faria os
-- outros cinquenta e nove exibirem "sem nota" tendo sido faturados: ali `taskId`
-- é NULO e quem liga é `quoteId`. A guarda de "nunca emitir uma segunda nota viva
-- no mesmo ciclo" passa a ser por orçamento, que é o escopo real de um ciclo.
ALTER TABLE "NfseDocument" ADD COLUMN IF NOT EXISTS "quoteId" TEXT;

ALTER TABLE "NfseDocument" DROP CONSTRAINT IF EXISTS "NfseDocument_quoteId_fkey";
ALTER TABLE "NfseDocument"
  ADD CONSTRAINT "NfseDocument_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "TaskQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "NfseDocument_quoteId_idx" ON "NfseDocument"("quoteId");

-- Toda nota já emitida é de uma tarefa, e toda tarefa tem no máximo um
-- orçamento: o preenchimento é determinístico e sem ambiguidade.
UPDATE "NfseDocument" n
   SET "quoteId" = t."quoteId"
  FROM "Task" t
 WHERE t."id" = n."taskId"
   AND n."quoteId" IS NULL
   AND t."quoteId" IS NOT NULL;
