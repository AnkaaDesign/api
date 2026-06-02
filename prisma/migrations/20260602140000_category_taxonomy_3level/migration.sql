-- 3-level item taxonomy + chart-of-accounts (AccountingType) axis.
-- Operational tree lives on ItemCategory (parentId self-relation, categoryLevel);
-- accountingType is the rollup ("ponte"/grupoContabil) used for cost allocation and
-- carried on both ItemCategory and TransactionCategory. Item.categoryReviewNeeded
-- flags low-confidence auto-classifications for human review.
-- Seed + data migration: src/scripts/backfill-category-taxonomy.ts

CREATE TYPE "AccountingType" AS ENUM (
    'SALARIOS', 'DESPESAS_FIXAS', 'PRODUTIVO', 'IMPOSTO_TARIFAS', 'MATERIA_PRIMA',
    'INVESTIMENTO', 'MANUTENCAO', 'COZINHA_ALIMENTACAO', 'EPI', 'ESCRITORIO',
    'APLICACAO_FINANCEIRA', 'ESTORNO', 'LUCRO_DISTRIBUIDO'
);

ALTER TABLE "ItemCategory"
    ADD COLUMN "parentId"       TEXT,
    ADD COLUMN "categoryLevel"  INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "accountingType" "AccountingType";

CREATE INDEX "ItemCategory_parentId_idx" ON "ItemCategory"("parentId");
CREATE INDEX "ItemCategory_accountingType_idx" ON "ItemCategory"("accountingType");

ALTER TABLE "ItemCategory"
    ADD CONSTRAINT "ItemCategory_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "ItemCategory"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TransactionCategory" ADD COLUMN "accountingType" "AccountingType";
CREATE INDEX "TransactionCategory_accountingType_idx" ON "TransactionCategory"("accountingType");

ALTER TABLE "Item" ADD COLUMN "categoryReviewNeeded" BOOLEAN NOT NULL DEFAULT false;
