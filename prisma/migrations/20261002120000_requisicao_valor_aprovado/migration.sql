-- A requisição do portal fala a língua do Modelo C (P14): o que era a
-- "pré-aprovação" do vendedor do cliente É a aprovação do valor. Os nomes
-- `preApproved*` e a chave de aviso `budget.portal_pre_approved` nunca foram a
-- produção (a branch do portal não foi publicada; a `main` não tem nem a
-- tabela), então é rename puro, sem janela de compatibilidade (DD13).

ALTER TABLE "BudgetRequest" RENAME COLUMN "preApprovedAt" TO "valueApprovedAt";
ALTER TABLE "BudgetRequest" RENAME COLUMN "preApprovedByResponsibleId" TO "valueApprovedByResponsibleId";

-- O nome da FK acompanha a coluna (a forma que o Prisma geraria).
ALTER TABLE "BudgetRequest"
  RENAME CONSTRAINT "BudgetRequest_preApprovedByResponsibleId_fkey"
  TO "BudgetRequest_valueApprovedByResponsibleId_fkey";

-- `BudgetRequest_decisao_unica` segue a coluna sozinho (o Postgres reescreve a
-- expressão do CHECK no rename).

-- Avisos já gravados com a chave velha (só dado local de teste) passam a nomear
-- a origem nova, para a régua de chaves não encontrar uma órfã.
UPDATE "Notification"
SET "metadata" = jsonb_set("metadata", '{configKey}', '"budget.portal_value_approved"')
WHERE "metadata"->>'configKey' = 'budget.portal_pre_approved';
