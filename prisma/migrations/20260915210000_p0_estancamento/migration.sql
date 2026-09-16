-- P0 · ESTANCAMENTO
--
-- Nada muda de forma. Cada item aqui fecha um buraco por onde dinheiro ou
-- documento fiscal já escapou, e existe sozinho: se a reforma de
-- Orçamento × Faturamento morrer amanhã, isto continua valendo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. O ÍNDICE PARCIAL DE `Invoice.customerConfigId` É MANTIDO À MÃO.
--
-- `20260506000001_invoice_customer_config_partial_unique` dropou o UNIQUE global
-- e criou `UNIQUE (customerConfigId) WHERE status <> 'CANCELLED'`. O Prisma não
-- sabe declarar índice parcial, e o `@unique` ficou no `schema.prisma` por
-- engano — um `migrate dev`/`db push` recriava o índice global e MATAVA o
-- refaturamento (uma fatia cancelada e uma viva são duas linhas).
-- O `@unique` saiu do schema nesta mesma leva. Reafirmamos o índice parcial aqui
-- para que um banco recriado do zero nasça com ele.
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_customerConfigId_active_unique"
  ON "Invoice" ("customerConfigId")
  WHERE status <> 'CANCELLED';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CASCADE → RESTRICT NAS TRÊS RELAÇÕES QUE CARREGAM DINHEIRO.
--
-- Apagar uma fatia levava junto a fatura, as parcelas (PAGAS inclusive) e, por
-- tabela, o boleto REGISTRADO no Sicredi e o `ReconciliationMatch`. A guarda de
-- obrigação viva olhava faturas `status <> 'CANCELLED'`, então uma fatura
-- CANCELADA com parcela PAGA passava despercebida e o cascade a levava.
-- Agora quem remove decide explicitamente o que fazer com a fatura.
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_customerConfigId_fkey";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerConfigId_fkey"
  FOREIGN KEY ("customerConfigId") REFERENCES "TaskQuoteCustomerConfig"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Installment" DROP CONSTRAINT IF EXISTS "Installment_customerConfigId_fkey";
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_customerConfigId_fkey"
  FOREIGN KEY ("customerConfigId") REFERENCES "TaskQuoteCustomerConfig"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankSlip" DROP CONSTRAINT IF EXISTS "BankSlip_installmentId_fkey";
ALTER TABLE "BankSlip" ADD CONSTRAINT "BankSlip_installmentId_fkey"
  FOREIGN KEY ("installmentId") REFERENCES "Installment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. UMA NOTA VIVA POR FATURA — a regra sai do código e vira do banco.
--
-- `NfseDocument` não tinha nenhum índice único além da chave primária. "Uma nota
-- viva por ciclo" era promessa de código, e foi por esse buraco que saíram notas
-- duplas na prefeitura.
--
-- 3a. O ACERVO PRIMEIRO. Existem faturas com DUAS notas vivas: uma antiga em
--     `CANCEL_REJECTED` (o fiscal RECUSOU o cancelamento, então ela continua
--     valendo) e uma nova `AUTHORIZED` emitida depois. As duas existem de
--     verdade na prefeitura e o banco não pode fingir o contrário: NÃO mexemos
--     em `status`. O que registramos é o fato que já ocorreu — a nova SUBSTITUIU
--     a antiga —, nas colunas que existem exatamente para isso.
--
--     ISTO NÃO CANCELA NADA NA PREFEITURA. As notas antigas seguem ativas lá e
--     precisam de decisão humana/contábil. Ver o relatório em
--     `scripts/report-nfse-vivas-duplicadas.ts`.
WITH viva AS (
  SELECT id, "invoiceId", "nfseNumber", "createdAt",
         ROW_NUMBER() OVER (
           PARTITION BY "invoiceId"
           ORDER BY "nfseNumber" DESC NULLS LAST, "createdAt" DESC
         ) AS rn
  FROM "NfseDocument"
  WHERE "invoiceId" IS NOT NULL
    AND "supersededByNfseDocumentId" IS NULL
    AND status IN ('PENDING','PROCESSING','AUTHORIZED','CANCEL_REQUESTED','CANCEL_REJECTED')
),
mais_nova AS (SELECT * FROM viva WHERE rn = 1),
antigas   AS (SELECT * FROM viva WHERE rn > 1)
UPDATE "NfseDocument" n
SET "supersededByNfseDocumentId" = m.id,
    "supersededByNfseNumber"     = m."nfseNumber",
    "supersededAt"               = NOW()
FROM antigas a
JOIN mais_nova m ON m."invoiceId" = a."invoiceId"
WHERE n.id = a.id;

-- 3b. Agora o índice. `supersededByNfseDocumentId IS NULL` é parte da regra, não
--     um remendo: uma nota substituída não disputa o lugar de nota vigente.
CREATE UNIQUE INDEX IF NOT EXISTS "NfseDocument_live_per_invoice_unique"
  ON "NfseDocument" ("invoiceId")
  WHERE "invoiceId" IS NOT NULL
    AND "supersededByNfseDocumentId" IS NULL
    AND status IN ('PENDING','PROCESSING','AUTHORIZED','CANCEL_REQUESTED','CANCEL_REJECTED');
