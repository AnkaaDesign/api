-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "economicActivityId" TEXT,
ADD COLUMN "situacaoCadastral" "RegistrationStatus",
ADD COLUMN "inscricaoEstadual" TEXT,
ADD COLUMN "logradouroType" TEXT;

-- CreateIndex
CREATE INDEX "Customer_economicActivityId_idx" ON "Customer"("economicActivityId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_economicActivityId_fkey" FOREIGN KEY ("economicActivityId") REFERENCES "EconomicActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
