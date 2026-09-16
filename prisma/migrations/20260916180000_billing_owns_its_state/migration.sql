-- O FATURAMENTO PASSA A TER ESTADO PRÓPRIO — e a cobertura antiga sai de cena.
--
-- `20260916120000_billing_entity` criou `Billing` e `BillingTask`, mas deixou a
-- entidade como SOMBRA: quem guardava a cobertura continuava sendo
-- `QuoteBillingTask` (pendurada no PAGADOR), e `BillingTask` era derivada dela a
-- cada reconciliação. Duas tabelas afirmando a mesma verdade, uma delas
-- calculada — que é a forma que a divergência assume antes de aparecer.
--
-- Depois desta migration:
--   · `BillingTask` é A cobertura, escrita direto. `QuoteBillingTask` não existe.
--   · `Billing.approvedAt` é O estado do faturamento. A coluna por PAGADOR
--     (`TaskQuoteCustomerConfig.billingApprovedAt`) não existe.
--
-- `TaskQuote.billingApprovedAt` NÃO é tocado: continua significando outra coisa —
-- "o orçamento INTEIRO está faturado", isto é, o último faturamento fechou.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. O ESTADO PRÓPRIO
ALTER TABLE "Billing" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O BACKFILL — três fontes, da mais precisa para a mais grosseira.
--
--   (a) o MARCADOR DE FATIA, quando existe. É a resposta exata.
--   (b) a FATURA VIVA daquele faturamento. Emitir fatura é o que a aprovação faz,
--       então a data dela é quando aquele recorte foi faturado. Cobre o acervo
--       inteiro anterior à feature de fatias — hoje, 158 dos 575.
--   (c) a data do ORÇAMENTO. "Inteiramente faturado" implica que todo faturamento
--       dele foi aprovado, mesmo sem fatura sobrevivente.
--
-- O que NÃO é adivinhado: dois orçamentos do acervo (216 e 309) estão em status
-- pós-faturamento sem NENHUMA fatura e sem data no orçamento — foram liquidados
-- por conciliação, fora deste caminho. Não há data verdadeira a escrever, então
-- ficam NULOS. Não é lacuna operacional: com o orçamento em DUE/SETTLED a guarda
-- de transição de status já recusa uma nova aprovação.
UPDATE "Billing" b
SET "approvedAt" = COALESCE(
  (SELECT max(c."billingApprovedAt")
     FROM "TaskQuoteCustomerConfig" c
    WHERE c."billingId" = b.id),
  (SELECT min(i."createdAt")
     FROM "Invoice" i
     JOIN "TaskQuoteCustomerConfig" c ON c.id = i."customerConfigId"
    WHERE c."billingId" = b.id AND i.status <> 'CANCELLED'),
  (SELECT q."billingApprovedAt" FROM "TaskQuote" q WHERE q.id = b."quoteId")
)
WHERE b."approvedAt" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. OS PORTÕES — travar em vez de perder um fato.
DO $$
DECLARE perdidos INT; descobertas INT; divergentes INT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'TaskQuoteCustomerConfig' AND column_name = 'billingApprovedAt') THEN

    -- (a) Nenhuma aprovação de fatia pode ficar sem chegar ao faturamento dela.
    SELECT count(*) INTO perdidos
      FROM "TaskQuoteCustomerConfig" c
      JOIN "Billing" b ON b.id = c."billingId"
     WHERE c."billingApprovedAt" IS NOT NULL AND b."approvedAt" IS NULL;
    IF perdidos > 0 THEN
      RAISE EXCEPTION 'Backfill perdeu aprovação: % fatia(s) aprovadas cujo faturamento ficou sem data.', perdidos;
    END IF;

    -- (b) Pagadores do MESMO faturamento em estados diferentes de aprovação: o
    --     colapso para uma data só passaria a considerar aprovado quem não era, e
    --     a geração de fatura daquele pagador seria recusada para sempre.
    SELECT count(*) INTO divergentes FROM (
      SELECT "billingId" FROM "TaskQuoteCustomerConfig" GROUP BY "billingId"
      HAVING count("billingApprovedAt") > 0 AND count("billingApprovedAt") < count(*)
    ) d;
    IF divergentes > 0 THEN
      RAISE EXCEPTION 'Aprovação divergente em % faturamento(s): pagadores do mesmo recorte com estados diferentes. Resolva antes de colapsar a coluna.', divergentes;
    END IF;
  END IF;

  -- (c) Toda cobertura antiga precisa existir na nova antes de a antiga sumir.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'QuoteBillingTask') THEN
    SELECT count(*) INTO descobertas
      FROM (SELECT DISTINCT "taskId" FROM "QuoteBillingTask") o
     WHERE NOT EXISTS (SELECT 1 FROM "BillingTask" n WHERE n."taskId" = o."taskId");
    IF descobertas > 0 THEN
      RAISE EXCEPTION 'Cobertura não migrada: % veículo(s) só existem em QuoteBillingTask.', descobertas;
    END IF;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. AS DUAS VERDADES DUPLICADAS SAEM
ALTER TABLE "TaskQuoteCustomerConfig" DROP COLUMN IF EXISTS "billingApprovedAt";
DROP TABLE IF EXISTS "QuoteBillingTask";

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. `billingId` do pagador já é NOT NULL desde o backfill da migration anterior;
--    reafirmado aqui para que um banco recriado do zero nasça igual ao de produção.
ALTER TABLE "TaskQuoteCustomerConfig" ALTER COLUMN "billingId" SET NOT NULL;

-- O ÍNDICE QUE A TELA NOVA PEDE: a fila "o que entreguei e ainda não cobrei?" e a
-- lista de faturamento ordenam e filtram por aprovação.
CREATE INDEX IF NOT EXISTS "Billing_approvedAt_idx" ON "Billing"("approvedAt");
