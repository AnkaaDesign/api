-- Entrada conciliation: a bank CREDIT (inflow) can now match a receivable
-- Installment directly (PIX/TED/cash receipts), not only a Sicredi BankSlip.
-- One of fiscalDocument / bankSlip / installment is set per match row.

-- AlterTable
ALTER TABLE "ReconciliationMatch" ADD COLUMN "installmentId" TEXT;

-- CreateIndex
CREATE INDEX "ReconciliationMatch_installmentId_idx" ON "ReconciliationMatch"("installmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationMatch_transactionId_installmentId_key" ON "ReconciliationMatch"("transactionId", "installmentId");

-- AddForeignKey
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
