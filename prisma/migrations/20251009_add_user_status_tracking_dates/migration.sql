-- AlterTable
ALTER TABLE "User" ADD COLUMN "exp1StartAt" TIMESTAMP(3),
ADD COLUMN "exp1EndAt" TIMESTAMP(3),
ADD COLUMN "exp2StartAt" TIMESTAMP(3),
ADD COLUMN "exp2EndAt" TIMESTAMP(3),
ADD COLUMN "contractedAt" TIMESTAMP(3),
ADD COLUMN "dismissedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_exp1StartAt_idx" ON "User"("exp1StartAt");

-- CreateIndex
CREATE INDEX "User_exp1EndAt_idx" ON "User"("exp1EndAt");

-- CreateIndex
CREATE INDEX "User_exp2StartAt_idx" ON "User"("exp2StartAt");

-- CreateIndex
CREATE INDEX "User_exp2EndAt_idx" ON "User"("exp2EndAt");

-- CreateIndex
CREATE INDEX "User_contractedAt_idx" ON "User"("contractedAt");

-- CreateIndex
CREATE INDEX "User_dismissedAt_idx" ON "User"("dismissedAt");
