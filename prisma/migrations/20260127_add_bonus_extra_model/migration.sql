-- CreateTable
CREATE TABLE "BonusExtra" (
    "id" TEXT NOT NULL,
    "bonusId" TEXT NOT NULL,
    "percentage" DECIMAL(5,2),
    "value" DECIMAL(10,2),
    "reference" TEXT NOT NULL,
    "calculationOrder" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BonusExtra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BonusExtra_bonusId_idx" ON "BonusExtra"("bonusId");

-- CreateIndex
CREATE INDEX "BonusExtra_calculationOrder_idx" ON "BonusExtra"("calculationOrder");

-- AddForeignKey
ALTER TABLE "BonusExtra" ADD CONSTRAINT "BonusExtra_bonusId_fkey" FOREIGN KEY ("bonusId") REFERENCES "Bonus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
