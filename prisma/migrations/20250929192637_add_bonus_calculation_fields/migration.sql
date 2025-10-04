-- AlterTable
ALTER TABLE "Bonus" ADD COLUMN     "ponderedTaskCount" DECIMAL(10,4) NOT NULL DEFAULT 0,
ADD COLUMN     "averageTasksPerUser" DECIMAL(10,4) NOT NULL DEFAULT 0,
ADD COLUMN     "calculationPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "calculationPeriodEnd" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Bonus_calculationPeriodStart_calculationPeriodEnd_idx" ON "Bonus"("calculationPeriodStart", "calculationPeriodEnd");

-- CreateIndex
CREATE INDEX "Bonus_ponderedTaskCount_idx" ON "Bonus"("ponderedTaskCount");

-- CreateIndex
CREATE INDEX "Bonus_averageTasksPerUser_idx" ON "Bonus"("averageTasksPerUser");