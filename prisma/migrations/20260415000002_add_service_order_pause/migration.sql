-- AlterEnum
ALTER TYPE "ServiceOrderStatus" ADD VALUE 'PAUSED';

-- AlterTable
ALTER TABLE "ServiceOrder" ADD COLUMN "pausedAt" TIMESTAMP(3),
ADD COLUMN "pausedById" TEXT,
ADD COLUMN "lastStartedAt" TIMESTAMP(3),
ADD COLUMN "totalActiveTimeSeconds" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_pausedById_fkey" FOREIGN KEY ("pausedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ServiceOrder_pausedById_idx" ON "ServiceOrder"("pausedById");
