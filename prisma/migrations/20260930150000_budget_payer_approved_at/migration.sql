-- Aprovacao do faturamento POR PAGADOR.
--
-- Dois pagadores do mesmo recorte (ex.: RKO + Ibipora sobre o mesmo caminhao)
-- passam a poder ser faturados em momentos diferentes. `Billing.approvedAt`
-- continua sendo a trava do recorte (gravado na primeira aprovacao); esta coluna
-- diz QUAL pagador ja foi faturado.
ALTER TABLE "BudgetPayer" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- BACKFILL: ate hoje todo pagador de uma cobranca aprovada foi aprovado junto
-- com ela, entao cada um herda a data da propria cobranca. A cobranca aprovada
-- so pelo ESTADO (liquidada por conciliacao, sem carimbo) herda a data da
-- fatura viva mais antiga do pagador e, sem fatura, a ultima alteracao da
-- cobranca -- qualquer data serve, o que importa e deixar de ser nula.
UPDATE "BudgetPayer" p
SET "approvedAt" = COALESCE(
  b."approvedAt",
  (SELECT MIN(i."createdAt") FROM "Invoice" i
    WHERE i."customerConfigId" = p.id AND i.status <> 'CANCELLED'),
  b."updatedAt"
)
FROM "Billing" b
WHERE b.id = p."billingId"
  AND p."approvedAt" IS NULL
  AND (b."approvedAt" IS NOT NULL
       OR b.status IN ('APPROVED', 'PARTIAL', 'OVERDUE', 'SETTLED'));

CREATE INDEX "BudgetPayer_approvedAt_idx" ON "BudgetPayer"("approvedAt");
