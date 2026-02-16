-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivationReason" TEXT,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ConsumptionSnapshot" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "totalConsumption" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "consumptionCount" INTEGER NOT NULL DEFAULT 0,
    "normalizedConsumption" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "workingDays" INTEGER NOT NULL DEFAULT 22,
    "seasonalFactor" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsumptionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsumptionSnapshot_itemId_idx" ON "ConsumptionSnapshot"("itemId");

-- CreateIndex
CREATE INDEX "ConsumptionSnapshot_year_month_idx" ON "ConsumptionSnapshot"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumptionSnapshot_itemId_year_month_key" ON "ConsumptionSnapshot"("itemId", "year", "month");

-- CreateIndex
CREATE INDEX "Item_lastUsedAt_idx" ON "Item"("lastUsedAt");

-- CreateIndex
CREATE INDEX "Item_deactivatedAt_idx" ON "Item"("deactivatedAt");
