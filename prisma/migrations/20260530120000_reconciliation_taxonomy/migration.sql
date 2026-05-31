-- Reconciliation taxonomy overhaul.
--
-- Replaces the single `ReconciliationCategory` enum column on BankTransaction
-- with a DB-backed taxonomy (TransactionCategory) + a many-to-many tag join
-- (BankTransactionCategory), so a single NF transaction can carry multiple
-- item-derived categories (Verniz + Endurecedor) while user-created
-- transaction-only categories (Aluguel) keep resolving NF-less transactions.
--
-- Ordering matters: we create + seed + backfill the new structures BEFORE
-- dropping the old enum column, so no classification data is lost.

-- ---------------------------------------------------------------------------
-- 1. New enum + sync ItemCategoryType with production (already has the value).
-- ---------------------------------------------------------------------------
CREATE TYPE "TransactionCategoryKind" AS ENUM ('ITEM_DERIVED', 'SERVICE', 'TRANSACTION_ONLY');

-- ELECTRONIC_TOOL already exists in production (schema was stale); IF NOT EXISTS
-- makes this a no-op there. Requires PostgreSQL 12+ to run inside the migration
-- transaction. If your PG is older, run this one statement separately first.
ALTER TYPE "ItemCategoryType" ADD VALUE IF NOT EXISTS 'ELECTRONIC_TOOL';

-- ---------------------------------------------------------------------------
-- 2. New tables.
-- ---------------------------------------------------------------------------
CREATE TABLE "TransactionCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "TransactionCategoryKind" NOT NULL,
    "itemCategoryId" TEXT,
    "isResolving" BOOLEAN NOT NULL DEFAULT false,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankTransactionCategory" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "source" "ReconciliationSource" NOT NULL DEFAULT 'AUTO',
    "confidence" INTEGER,
    "allocatedAmount" DECIMAL(14,2),
    "derivedFromFiscalItemId" TEXT,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransactionCategory_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 3. New columns on existing tables (added BEFORE dropping the old enum col).
-- ---------------------------------------------------------------------------
ALTER TABLE "BankTransaction" ADD COLUMN "expectsFiscalDocument" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "FiscalDocumentItem"
    ADD COLUMN "categoryId" TEXT,
    ADD COLUMN "categoryConfidence" INTEGER,
    ADD COLUMN "categorySource" "ReconciliationSource";

ALTER TABLE "ReconciliationAlias" ADD COLUMN "categoryId" TEXT;

-- ---------------------------------------------------------------------------
-- 4. Indexes + foreign keys for the new structures.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "TransactionCategory_name_key" ON "TransactionCategory"("name");
CREATE UNIQUE INDEX "TransactionCategory_slug_key" ON "TransactionCategory"("slug");
CREATE INDEX "TransactionCategory_kind_idx" ON "TransactionCategory"("kind");
CREATE INDEX "TransactionCategory_itemCategoryId_idx" ON "TransactionCategory"("itemCategoryId");
CREATE INDEX "TransactionCategory_isRecurring_idx" ON "TransactionCategory"("isRecurring");
CREATE INDEX "TransactionCategory_isActive_idx" ON "TransactionCategory"("isActive");
CREATE INDEX "BankTransactionCategory_transactionId_idx" ON "BankTransactionCategory"("transactionId");
CREATE INDEX "BankTransactionCategory_categoryId_idx" ON "BankTransactionCategory"("categoryId");
CREATE INDEX "BankTransactionCategory_categoryId_source_idx" ON "BankTransactionCategory"("categoryId", "source");
CREATE UNIQUE INDEX "BankTransactionCategory_transactionId_categoryId_key" ON "BankTransactionCategory"("transactionId", "categoryId");
CREATE INDEX "BankTransaction_expectsFiscalDocument_idx" ON "BankTransaction"("expectsFiscalDocument");
CREATE INDEX "FiscalDocumentItem_categoryId_idx" ON "FiscalDocumentItem"("categoryId");
CREATE INDEX "ReconciliationAlias_categoryId_idx" ON "ReconciliationAlias"("categoryId");

ALTER TABLE "TransactionCategory" ADD CONSTRAINT "TransactionCategory_itemCategoryId_fkey" FOREIGN KEY ("itemCategoryId") REFERENCES "ItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FiscalDocumentItem" ADD CONSTRAINT "FiscalDocumentItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReconciliationAlias" ADD CONSTRAINT "ReconciliationAlias_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankTransactionCategory" ADD CONSTRAINT "BankTransactionCategory_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankTransactionCategory" ADD CONSTRAINT "BankTransactionCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransactionCategory" ADD CONSTRAINT "BankTransactionCategory_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Seed the taxonomy.
-- ---------------------------------------------------------------------------
-- 5a. Transaction-only categories (migrated from the old enum's self-justifying
--     values). isResolving=true so assigning one reconciles the transaction.
--     isRecurring pre-set for the obvious monthly obligations; user-tunable.
INSERT INTO "TransactionCategory" ("id","name","slug","kind","isResolving","isRecurring","sortOrder")
VALUES
  (gen_random_uuid(), 'Tributo',          'tributo',         'TRANSACTION_ONLY', true, false, 10),
  (gen_random_uuid(), 'Folha de Pagamento','folha',          'TRANSACTION_ONLY', true, true,  11),
  (gen_random_uuid(), 'Transferência',    'transferencia',   'TRANSACTION_ONLY', true, false, 12),
  (gen_random_uuid(), 'Tarifa Bancária',  'tarifa-bancaria', 'TRANSACTION_ONLY', true, false, 13),
  (gen_random_uuid(), 'Convênio',         'convenio',        'TRANSACTION_ONLY', true, true,  14),
  (gen_random_uuid(), 'Pró-labore',       'pro-labore',      'TRANSACTION_ONLY', true, true,  15),
  (gen_random_uuid(), 'Aluguel',          'aluguel',         'TRANSACTION_ONLY', true, true,  16),
  (gen_random_uuid(), 'Estorno',          'estorno',         'TRANSACTION_ONLY', true, false, 17),
  (gen_random_uuid(), 'Outros',           'outros',          'TRANSACTION_ONLY', true, false, 18);

-- 5b. Service categories for NFSe content (no inventory equivalent). NF-derived
--     enrichment, so isResolving=false.
INSERT INTO "TransactionCategory" ("id","name","slug","kind","isResolving","sortOrder")
VALUES
  (gen_random_uuid(), 'Pintura e Colorimetria', 'pintura',            'SERVICE', false, 30),
  (gen_random_uuid(), 'Contabilidade',          'contabilidade',      'SERVICE', false, 31),
  (gen_random_uuid(), 'Saúde e Medicina do Trabalho', 'saude',        'SERVICE', false, 32),
  (gen_random_uuid(), 'TI e Cloud',             'ti',                 'SERVICE', false, 33),
  (gen_random_uuid(), 'Monitoramento',          'monitoramento',      'SERVICE', false, 34),
  (gen_random_uuid(), 'Comunicação Visual',     'comunicacao-visual', 'SERVICE', false, 35);

-- 5c. Item-derived categories — one per existing ItemCategory (1:1 mirror).
--     Slug is "item-" + a slugified, accent-collapsed name; guaranteed unique
--     by name uniqueness. NF-derived enrichment, so isResolving=false.
INSERT INTO "TransactionCategory" ("id","name","slug","kind","itemCategoryId","isResolving","sortOrder")
SELECT
  gen_random_uuid(),
  ic."name",
  'item-' || trim(both '-' from regexp_replace(
    lower(translate(ic."name",
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
    '[^a-z0-9]+', '-', 'g')),
  'ITEM_DERIVED',
  ic."id",
  false,
  100
FROM "ItemCategory" ic
ON CONFLICT ("name") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Backfill from the old enum column.
-- ---------------------------------------------------------------------------
-- 6a. expectsFiscalDocument: the old "NF" category meant "run the scoring matcher".
UPDATE "BankTransaction" SET "expectsFiscalDocument" = true WHERE "category" = 'NF';

-- 6b. Transaction-only tags: one BankTransactionCategory row per transaction
--     whose old category was a self-justifying (non-NF, non-UNCLASSIFIED) value.
INSERT INTO "BankTransactionCategory" ("id","transactionId","categoryId","source","createdAt","updatedAt")
SELECT
  gen_random_uuid(),
  bt."id",
  tc."id",
  COALESCE(bt."categorySource", 'AUTO'),
  now(),
  now()
FROM "BankTransaction" bt
JOIN "TransactionCategory" tc
  ON tc."slug" = CASE bt."category"::text
       WHEN 'TRIBUTO'         THEN 'tributo'
       WHEN 'FOLHA'           THEN 'folha'
       WHEN 'TRANSFERENCIA'   THEN 'transferencia'
       WHEN 'TARIFA_BANCARIA' THEN 'tarifa-bancaria'
       WHEN 'CONVENIO'        THEN 'convenio'
       WHEN 'PRO_LABORE'      THEN 'pro-labore'
       WHEN 'ALUGUEL'         THEN 'aluguel'
       WHEN 'ESTORNO'         THEN 'estorno'
       WHEN 'OUTROS'          THEN 'outros'
     END
WHERE bt."category"::text NOT IN ('NF','UNCLASSIFIED')
ON CONFLICT ("transactionId","categoryId") DO NOTHING;

-- 6c. ReconciliationAlias.categoryId from its old enum category.
UPDATE "ReconciliationAlias" ra
SET "categoryId" = tc."id"
FROM "TransactionCategory" tc
WHERE tc."slug" = CASE ra."category"::text
       WHEN 'TRIBUTO'         THEN 'tributo'
       WHEN 'FOLHA'           THEN 'folha'
       WHEN 'TRANSFERENCIA'   THEN 'transferencia'
       WHEN 'TARIFA_BANCARIA' THEN 'tarifa-bancaria'
       WHEN 'CONVENIO'        THEN 'convenio'
       WHEN 'PRO_LABORE'      THEN 'pro-labore'
       WHEN 'ALUGUEL'         THEN 'aluguel'
       WHEN 'ESTORNO'         THEN 'estorno'
       WHEN 'OUTROS'          THEN 'outros'
     END
  AND ra."category" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. Drop the old enum column + type now that everything is backfilled.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "BankTransaction_category_idx";
ALTER TABLE "BankTransaction" DROP COLUMN "category";
ALTER TABLE "ReconciliationAlias" DROP COLUMN "category";
DROP TYPE "ReconciliationCategory";

-- ---------------------------------------------------------------------------
-- Optional cleanup (left commented — data deletion is your call): the junk
-- ItemCategory rows 'teste','testeoipoi','trtsetw' will be mirrored as
-- item-derived categories; deactivate or delete them from the UI afterwards.
