-- AlterTable
ALTER TABLE "TaskPricingCustomerConfig" ADD COLUMN "responsibleId" TEXT;

-- CreateIndex
CREATE INDEX "TaskPricingCustomerConfig_responsibleId_idx" ON "TaskPricingCustomerConfig"("responsibleId");

-- AddForeignKey
ALTER TABLE "TaskPricingCustomerConfig" ADD CONSTRAINT "TaskPricingCustomerConfig_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "Responsible"("id") ON DELETE SET NULL ON UPDATE CASCADE;
