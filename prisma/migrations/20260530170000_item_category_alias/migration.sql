-- CreateEnum
CREATE TYPE "ItemCategoryAliasSource" AS ENUM ('MANUAL', 'AUTO_CODE', 'ADMIN_SEEDED');

-- CreateTable
CREATE TABLE "ItemCategoryAlias" (
    "id" TEXT NOT NULL,
    "descriptionFingerprint" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "source" "ItemCategoryAliasSource" NOT NULL,
    "confirmedCount" INTEGER NOT NULL DEFAULT 1,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemCategoryAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemCategoryAlias_descriptionFingerprint_idx" ON "ItemCategoryAlias"("descriptionFingerprint");

-- CreateIndex
CREATE INDEX "ItemCategoryAlias_categoryId_idx" ON "ItemCategoryAlias"("categoryId");

-- CreateIndex
CREATE INDEX "ItemCategoryAlias_disabledAt_idx" ON "ItemCategoryAlias"("disabledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategoryAlias_descriptionFingerprint_categoryId_key" ON "ItemCategoryAlias"("descriptionFingerprint", "categoryId");

-- AddForeignKey
ALTER TABLE "ItemCategoryAlias" ADD CONSTRAINT "ItemCategoryAlias_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

