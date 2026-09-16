-- O FATURAMENTO VIRA ENTIDADE.
--
-- Até aqui "faturamento" era `TaskQuoteCustomerConfig`: uma linha que dizia ao
-- mesmo tempo A QUEM cobrar e QUAIS VEÍCULOS a cobrança cobre. Num orçamento de
-- quatro caminhões cobrados um a um isso virava quatro linhas do MESMO cliente,
-- sem nada que as distinguisse — e era por isso que a tela mostrava "Fatura 1, 2,
-- 3, 4" na mesma página: não havia quatro coisas, havia uma lista de
-- configurações de uma coisa só.
--
-- Depois desta migration há quatro coisas, cada uma com o seu `id`. Trocar o modo
-- de faturamento deixa de ser um campo que muda de valor e passa a ser entidade
-- que nasce e morre.
--
-- SEM NÚMERO, de propósito: o número é do ORÇAMENTO. Ver o comentário do modelo
-- `Billing` no schema.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AS TABELAS
CREATE TABLE "Billing" (
  "id"        TEXT NOT NULL,
  "quoteId"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Billing_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Billing_quoteId_idx" ON "Billing"("quoteId");
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "TaskQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BillingTask" (
  "billingId" TEXT NOT NULL,
  "taskId"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingTask_pkey" PRIMARY KEY ("billingId","taskId")
);
-- UM VEÍCULO, UM FATURAMENTO. Mais forte que a regra anterior
-- (`QuoteBillingTask.@@unique([taskId, customerId])`): dois pagadores do mesmo
-- recorte dividem o MESMO `Billing`, então o veículo aparece uma vez só.
-- Conferido contra o acervo antes de escrever isto: zero tarefas em mais de um
-- grupo de cobertura.
CREATE UNIQUE INDEX "BillingTask_taskId_key" ON "BillingTask"("taskId");
CREATE INDEX "BillingTask_taskId_idx" ON "BillingTask"("taskId");
ALTER TABLE "BillingTask" ADD CONSTRAINT "BillingTask_billingId_fkey"
  FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingTask" ADD CONSTRAINT "BillingTask_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskQuoteCustomerConfig" ADD COLUMN "billingId" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O BACKFILL — determinístico, derivado da cobertura que já existe.
--
-- A regra: configs do MESMO orçamento que cobrem EXATAMENTE os mesmos veículos
-- são o mesmo faturamento. Isso resolve os três arranjos de uma vez —
--   JOINT 1 pagador  ⇒ 1 grupo                      ⇒ 1 Billing
--   PER_TASK 4 veíc. ⇒ 4 grupos de 1                ⇒ 4 Billings
--   2 pagadores JOINT⇒ 1 grupo (mesma cobertura)    ⇒ 1 Billing, 2 configs
-- — e é exatamente o que o modelo passa a afirmar.
CREATE TEMP TABLE _cfg_cov AS
SELECT c.id AS config_id,
       c."quoteId" AS quote_id,
       COALESCE(
         (SELECT array_agg(b."taskId" ORDER BY b."taskId")
          FROM "QuoteBillingTask" b WHERE b."configId" = c.id),
         ARRAY[]::text[]
       ) AS cset
FROM "TaskQuoteCustomerConfig" c;

CREATE TEMP TABLE _billing_map AS
SELECT gen_random_uuid()::text AS billing_id, quote_id, cset
FROM (SELECT DISTINCT quote_id, cset FROM _cfg_cov) g;

INSERT INTO "Billing" ("id","quoteId","createdAt","updatedAt")
SELECT billing_id, quote_id, NOW(), NOW() FROM _billing_map;

UPDATE "TaskQuoteCustomerConfig" c
SET "billingId" = m.billing_id
FROM _cfg_cov cc
JOIN _billing_map m ON m.quote_id = cc.quote_id AND m.cset = cc.cset
WHERE c.id = cc.config_id;

INSERT INTO "BillingTask" ("billingId","taskId","createdAt")
SELECT m.billing_id, t.task_id, NOW()
FROM _billing_map m, LATERAL unnest(m.cset) AS t(task_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. OS PORTÕES — a migration TRAVA em vez de deixar passar meio feita.
DO $$
DECLARE orfas INT; descobertas INT;
BEGIN
  SELECT count(*) INTO orfas FROM "TaskQuoteCustomerConfig" WHERE "billingId" IS NULL;
  IF orfas > 0 THEN
    RAISE EXCEPTION 'Backfill incompleto: % pagador(es) sem faturamento.', orfas;
  END IF;

  -- Toda linha de cobertura antiga precisa ter chegado à nova tabela.
  SELECT count(*) INTO descobertas
  FROM (SELECT DISTINCT "taskId" FROM "QuoteBillingTask") o
  WHERE NOT EXISTS (SELECT 1 FROM "BillingTask" n WHERE n."taskId" = o."taskId");
  IF descobertas > 0 THEN
    RAISE EXCEPTION 'Backfill perdeu cobertura: % veículo(s) ficaram sem faturamento.', descobertas;
  END IF;
END $$;

ALTER TABLE "TaskQuoteCustomerConfig" ALTER COLUMN "billingId" SET NOT NULL;
CREATE INDEX "TaskQuoteCustomerConfig_billingId_idx" ON "TaskQuoteCustomerConfig"("billingId");
ALTER TABLE "TaskQuoteCustomerConfig" ADD CONSTRAINT "TaskQuoteCustomerConfig_billingId_fkey"
  FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE _cfg_cov;
DROP TABLE _billing_map;
