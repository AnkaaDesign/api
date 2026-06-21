-- Reconciliation payable anchors: extend ReconciliationMatch so a DEBIT bank
-- transaction can confirm (clear) any payable type — order installments,
-- recurrent-payable occurrences, airbrushing, payroll — exactly like the
-- existing receivable anchors. Each anchor gets FITID-grade idempotency via a
-- @@unique([transactionId, <anchor>]). Also adds the missing
-- (transactionId, bankSlipId) unique (parity with the other anchors).

-- AlterTable: new optional payable anchor columns
ALTER TABLE "ReconciliationMatch"
  ADD COLUMN "orderInstallmentId" TEXT,
  ADD COLUMN "recurrentOccurrenceId" TEXT,
  ADD COLUMN "airbrushingId" TEXT,
  ADD COLUMN "payrollMonthSettlementId" TEXT;

-- CreateIndex: anchor lookups
CREATE INDEX "ReconciliationMatch_orderInstallmentId_idx" ON "ReconciliationMatch"("orderInstallmentId");
CREATE INDEX "ReconciliationMatch_recurrentOccurrenceId_idx" ON "ReconciliationMatch"("recurrentOccurrenceId");
CREATE INDEX "ReconciliationMatch_airbrushingId_idx" ON "ReconciliationMatch"("airbrushingId");
CREATE INDEX "ReconciliationMatch_payrollMonthSettlementId_idx" ON "ReconciliationMatch"("payrollMonthSettlementId");

-- CreateIndex: per-anchor idempotency (FITID-grade no-double-settle)
CREATE UNIQUE INDEX "ReconciliationMatch_transactionId_bankSlipId_key" ON "ReconciliationMatch"("transactionId", "bankSlipId");
CREATE UNIQUE INDEX "ReconciliationMatch_transactionId_orderInstallmentId_key" ON "ReconciliationMatch"("transactionId", "orderInstallmentId");
CREATE UNIQUE INDEX "ReconciliationMatch_transactionId_recurrentOccurrenceId_key" ON "ReconciliationMatch"("transactionId", "recurrentOccurrenceId");
CREATE UNIQUE INDEX "ReconciliationMatch_transactionId_airbrushingId_key" ON "ReconciliationMatch"("transactionId", "airbrushingId");
CREATE UNIQUE INDEX "ReconciliationMatch_transactionId_payrollMonthSettlementId_key" ON "ReconciliationMatch"("transactionId", "payrollMonthSettlementId");

-- AddForeignKey (onDelete: Restrict — consistent with fiscalDocument/installment)
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_orderInstallmentId_fkey" FOREIGN KEY ("orderInstallmentId") REFERENCES "OrderInstallment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_recurrentOccurrenceId_fkey" FOREIGN KEY ("recurrentOccurrenceId") REFERENCES "RecurrentPayableOccurrence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_airbrushingId_fkey" FOREIGN KEY ("airbrushingId") REFERENCES "Airbrushing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_payrollMonthSettlementId_fkey" FOREIGN KEY ("payrollMonthSettlementId") REFERENCES "PayrollMonthSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
