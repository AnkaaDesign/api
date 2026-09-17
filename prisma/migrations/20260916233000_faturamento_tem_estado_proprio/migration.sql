-- O CICLO DO PAGAMENTO SAI DO ORÇAMENTO E VAI PARA O FATURAMENTO.
--
-- `20260916120000_billing_entity` separou a ENTIDADE; a MÁQUINA DE ESTADOS ficou
-- para trás. `TaskQuote.status` continuava carregando BILLING_APPROVED, UPCOMING,
-- DUE, PARTIAL e SETTLED — estados que descrevem a COBRANÇA, não a proposta.
-- Enquanto isso o `Billing`, que é a cobrança, não tinha estado nenhum: a tela de
-- Faturamento lia o status do ORÇAMENTO para falar de faturamento.
--
-- A consequência prática: dois faturamentos do mesmo orçamento — um pago, um
-- vencido — não tinham como estar em estados diferentes, porque o estado era do
-- orçamento, que é UM.
--
-- A fronteira, dita em uma frase: o orçamento se altera no máximo até a execução
-- do serviço; o faturamento, até o pagamento terminar.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. O ENUM DO FATURAMENTO
--
-- Sem "A Vencer": aprovado já quer dizer "cobrado, esperando pagar", e um estado
-- a mais só para dizer "ainda não venceu" separava duas linhas que o operador
-- trata igual.
CREATE TYPE "BillingStatus" AS ENUM (
  'OVERDUE', 'PENDING', 'APPROVED', 'PARTIAL', 'SETTLED', 'CANCELLED'
);

ALTER TABLE "Billing" ADD COLUMN "status"      "BillingStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Billing" ADD COLUMN "statusOrder" INTEGER         NOT NULL DEFAULT 2;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O BACKFILL DO FATURAMENTO
--
-- A verdade preferida é a das PARCELAS, que é o que a cascata passará a ler. Mas
-- nem todo faturamento tem parcela: há orçamentos liquidados por CONCILIAÇÃO,
-- sem fatura nenhuma (os casos 216 e 309 do acervo). Para esses, a única fonte é
-- o estado que o ORÇAMENTO guardava — que é justamente o que esta migration está
-- aposentando, e por isso tem de ser lido agora ou nunca mais.
WITH parcelas AS (
  SELECT
    c."billingId" AS billing_id,
    count(*) FILTER (WHERE i.status <> 'CANCELLED')                                     AS ativas,
    count(*) FILTER (WHERE i.status = 'PAID')                                           AS pagas,
    count(*) FILTER (WHERE i.status NOT IN ('PAID','CANCELLED') AND i."dueDate" < now()) AS vencidas
  FROM "TaskQuoteCustomerConfig" c
  JOIN "Installment" i ON i."customerConfigId" = c.id
  WHERE c."billingId" IS NOT NULL
  GROUP BY c."billingId"
),
resolvido AS (
  SELECT
    b.id,
    CASE
      -- O orçamento cancelado cancela as suas cobranças.
      WHEN q.status = 'CANCELLED' THEN 'CANCELLED'
      -- COM parcelas: elas mandam.
      WHEN coalesce(p.ativas, 0) > 0 AND p.pagas = p.ativas THEN 'SETTLED'
      WHEN coalesce(p.vencidas, 0) > 0                      THEN 'OVERDUE'
      WHEN coalesce(p.pagas, 0)    > 0                      THEN 'PARTIAL'
      WHEN coalesce(p.ativas, 0)   > 0 AND b."approvedAt" IS NOT NULL THEN 'APPROVED'
      WHEN coalesce(p.ativas, 0)   > 0                      THEN 'PENDING'
      -- SEM parcelas: herda do estado que o orçamento carregava.
      WHEN q.status = 'SETTLED'                             THEN 'SETTLED'
      WHEN q.status = 'DUE'                                 THEN 'OVERDUE'
      WHEN q.status = 'PARTIAL'                             THEN 'PARTIAL'
      WHEN q.status IN ('BILLING_APPROVED','UPCOMING')      THEN 'APPROVED'
      WHEN b."approvedAt" IS NOT NULL                       THEN 'APPROVED'
      ELSE 'PENDING'
    END AS novo
  FROM "Billing" b
  JOIN "TaskQuote" q ON q.id = b."quoteId"
  LEFT JOIN parcelas p ON p.billing_id = b.id
)
UPDATE "Billing" b
SET "status" = r.novo::"BillingStatus",
    "statusOrder" = CASE r.novo
      WHEN 'OVERDUE'   THEN 1
      WHEN 'PENDING'   THEN 2
      WHEN 'APPROVED'  THEN 3
      WHEN 'PARTIAL'   THEN 4
      WHEN 'SETTLED'   THEN 5
      WHEN 'CANCELLED' THEN 6
    END
FROM resolvido r
WHERE r.id = b.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. O CARIMBO QUE FALTAVA EM QUEM JÁ TINHA PARCELA
--
-- Parcela só existe depois de a cobrança ser aprovada. Um `Billing` com parcela e
-- `approvedAt` nulo é, portanto, uma aprovação cuja DATA se perdeu — não uma
-- aprovação que não houve. O backfill de `20260916120000_billing_entity` não tinha
-- de onde derivá-la (nem marcador de fatia, nem fatura viva).
--
-- Isso não é cosmético: `isQuoteMoneyLocked` pergunta exatamente por `approvedAt`,
-- então sem carimbo o orçamento fica EDITÁVEL — e no acervo há um caso com duas
-- parcelas vencidas (o 309) que passaria a aceitar mudança de preço sobre dívida
-- em cobrança. A data mais defensável é a da parcela mais antiga: ela não pode ter
-- nascido antes da aprovação.
UPDATE "Billing" b
SET "approvedAt" = sub.nascimento
FROM (
  SELECT c."billingId" AS id, min(i."createdAt") AS nascimento
  FROM "TaskQuoteCustomerConfig" c
  JOIN "Installment" i ON i."customerConfigId" = c.id
  WHERE c."billingId" IS NOT NULL
  GROUP BY c."billingId"
) sub
WHERE sub.id = b.id AND b."approvedAt" IS NULL;

CREATE INDEX "Billing_statusOrder_idx" ON "Billing" ("statusOrder");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. O ENUM DO ORÇAMENTO ENCOLHE
--
-- `BUDGET_APPROVED` vira `APPROVED`: o prefixo existia só para desambiguar de
-- `BILLING_APPROVED`, que sai daqui. E os cinco estados de cobrança convergem
-- para `APPROVED` — um orçamento cuja cobrança está vencida CONTINUA sendo um
-- orçamento aprovado; quem está vencido é o faturamento, e agora ele tem onde
-- dizer isso.
--
-- Postgres não remove valor de enum: o tipo é recriado. `TaskQuote.status` é a
-- ÚNICA coluna que o usa (conferido em produção), então a troca é local.
ALTER TABLE "TaskQuote" ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "TaskQuoteStatus_new" AS ENUM (
  'EXPIRED', 'SIGNED', 'PENDING', 'APPROVED', 'CANCELLED'
);

ALTER TABLE "TaskQuote"
  ALTER COLUMN "status" TYPE "TaskQuoteStatus_new"
  USING (
    CASE "status"::text
      WHEN 'EXPIRED'          THEN 'EXPIRED'
      WHEN 'SIGNED'           THEN 'SIGNED'
      WHEN 'PENDING'          THEN 'PENDING'
      WHEN 'CANCELLED'        THEN 'CANCELLED'
      ELSE 'APPROVED'
    END
  )::"TaskQuoteStatus_new";

DROP TYPE "TaskQuoteStatus";
ALTER TYPE "TaskQuoteStatus_new" RENAME TO "TaskQuoteStatus";

ALTER TABLE "TaskQuote" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. A RÉGUA DO ORÇAMENTO, AGORA CURTA
--
-- Ordem da AÇÃO PENDENTE, da nossa para a do cliente: vencido (reprecificar) →
-- assinado (falta a nossa contra-assinatura) → pendente (esperando o cliente) →
-- aprovado (não há mais nada a fazer aqui). Espelho em código:
-- `src/constants/sortOrders.ts` → `TASK_QUOTE_STATUS_ORDER`.
UPDATE "TaskQuote" SET "statusOrder" = CASE "status"
  WHEN 'EXPIRED'   THEN 1
  WHEN 'SIGNED'    THEN 2
  WHEN 'PENDING'   THEN 3
  WHEN 'APPROVED'  THEN 4
  WHEN 'CANCELLED' THEN 5
END;
