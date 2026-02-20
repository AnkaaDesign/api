-- AlterTable
ALTER TABLE "TaskPricing" ADD COLUMN "responsibleId" TEXT;

-- CreateIndex
CREATE INDEX "TaskPricing_responsibleId_idx" ON "TaskPricing"("responsibleId");

-- AddForeignKey
ALTER TABLE "TaskPricing" ADD CONSTRAINT "TaskPricing_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "Representative"("id") ON DELETE SET NULL ON UPDATE CASCADE;
