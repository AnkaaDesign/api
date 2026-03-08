-- CreateEnum
CREATE TYPE "FinancialStatus" AS ENUM ('PENDING', 'AWAITING_APPROVAL', 'APPROVED', 'UPCOMING', 'PARTIAL', 'OVERDUE');

-- AlterTable: Task
ALTER TABLE "Task" ADD COLUMN "financialStatus" "FinancialStatus";
ALTER TABLE "Task" ADD COLUMN "financialStatusOrder" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: TaskPricingItem
ALTER TABLE "TaskPricingItem" ADD COLUMN "invoiceToCustomerId" TEXT;

-- CreateIndex
CREATE INDEX "Task_financialStatusOrder_idx" ON "Task"("financialStatusOrder");
CREATE INDEX "TaskPricingItem_invoiceToCustomerId_idx" ON "TaskPricingItem"("invoiceToCustomerId");

-- AddForeignKey
ALTER TABLE "TaskPricingItem" ADD CONSTRAINT "TaskPricingItem_invoiceToCustomerId_fkey" FOREIGN KEY ("invoiceToCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
