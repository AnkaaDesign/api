-- A NOTA FISCAL PASSA A SABER DE QUAL PAGADOR ELA É
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `NfseDocument` tinha três elos, e nenhum deles responde a pergunta que a
-- substituição fiscal precisa fazer — "de quem é esta nota?":
--
--   · `invoiceId`  some na reversão (`ON DELETE SET NULL`, de propósito: nota
--                  emitida sobrevive à fatura);
--   · `taskId`     é NULO numa nota conjunta ou de lote — ela não é de nenhum
--                  dos sessenta caminhões em particular;
--   · `quoteId`    é grosso demais: não distingue DUAS notas de DOIS PAGADORES
--                  da MESMA cobrança.
--
-- POR QUE ISSO IMPORTA. Substituir uma nota na prefeitura de Ibiporã são dois
-- passos nossos (o `SubstituirNfseEnvio` atômico do ABRASF vem DESLIGADO lá): a
-- reversão deixa a nota velha de pé, e a aprovação seguinte cancela a velha
-- CITANDO o número da nova. Citar a substituta ERRADA é erro fiscal
-- IRREVERSÍVEL — a nota morre apontando para um serviço que não é o dela.
--
-- Sem um elo por pagador, duas notas de dois pagadores da mesma cobrança ficam
-- indistinguíveis depois de uma reversão, e a regra conservadora de
-- `ElotechOxyNfseService.supersedePreviousNfses` é deixar as DUAS vivas. Nota
-- viva a mais é problema visível; nota cancelada errado, não. Mas notas vivas se
-- acumulam na prefeitura — é o que esta coluna resolve.
--
-- `ON DELETE SET NULL`, como `invoiceId` e `taskId`: a nota é histórico fiscal e
-- sobrevive à remoção do pagador.
--
-- BACKFILL. Só o que é DERIVÁVEL COM EXATIDÃO: a nota que ainda tem fatura
-- herda o pagador DAQUELA fatura. Notas já órfãs (`invoiceId` nulo — 11 linhas
-- no acervo de 17/09, das quais 2 vivas) ficam com a coluna NULA: atribuí-las
-- pelo veículo daria certo hoje, porque toda nota do acervo tem `taskId`, mas
-- seria adivinhação no caso exato que a coluna existe para resolver — duas notas
-- do mesmo veículo e de pagadores diferentes. Não se adivinha em nota fiscal.
--
-- Quem preenche daqui em diante é o ponto de EMISSÃO (`InvoiceGenerationService`
-- / `ElotechOxyNfseService`), na mesma escrita que cria a nota.

ALTER TABLE "NfseDocument" ADD COLUMN IF NOT EXISTS "customerConfigId" TEXT;

CREATE INDEX IF NOT EXISTS "NfseDocument_customerConfigId_idx"
  ON "NfseDocument" ("customerConfigId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'NfseDocument_customerConfigId_fkey'
  ) THEN
    ALTER TABLE "NfseDocument"
      ADD CONSTRAINT "NfseDocument_customerConfigId_fkey"
      FOREIGN KEY ("customerConfigId") REFERENCES "TaskQuoteCustomerConfig"("id")
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

UPDATE "NfseDocument" n
SET "customerConfigId" = i."customerConfigId"
FROM "Invoice" i
WHERE n."invoiceId" = i.id
  AND n."customerConfigId" IS NULL
  AND i."customerConfigId" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- E O ÍNDICE PARCIAL DA FATURA, REAFIRMADO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `UNIQUE (customerConfigId) WHERE status <> 'CANCELLED'` é o que impede um
-- pagador de ter DUAS faturas vivas — a segunda nota, o segundo boleto, a
-- segunda cobrança do mesmo serviço. É também a última linha de defesa da corrida
-- de aprovação simultânea.
--
-- O Prisma NÃO SABE DECLARAR índice parcial: não existe cláusula `where` em
-- `@@index`/`@@unique`. Por isso ele não está no `schema.prisma` (só
-- documentado, em `model Invoice`) e é mantido À MÃO, aqui e na migração
-- `20260915210000_p0_estancamento`. A consequência prática, que já custou caro
-- uma vez: um `prisma db push` recria o índice GLOBAL do `@unique` e mata o
-- refaturamento (uma fatia cancelada e uma viva são duas linhas). Reafirmar a
-- cada leva que mexe em fatura é barato e mantém um banco recriado do zero
-- correto.
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_customerConfigId_active_unique"
  ON "Invoice" ("customerConfigId")
  WHERE status <> 'CANCELLED';
