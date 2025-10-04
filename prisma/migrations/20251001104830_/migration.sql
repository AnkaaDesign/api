/*
  Warnings:

  - You are about to drop the `Discount` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Discount" DROP CONSTRAINT "Discount_payrollId_fkey";

-- AlterTable
ALTER TABLE "Payroll" ADD COLUMN     "positionId" TEXT;

-- DropTable
DROP TABLE "Discount";

-- CreateTable
CREATE TABLE "PayrollDiscount" (
    "id" TEXT NOT NULL,
    "percentage" DECIMAL(5,2),
    "value" DECIMAL(10,2),
    "calculationOrder" INTEGER NOT NULL DEFAULT 1,
    "reference" TEXT NOT NULL,
    "payrollId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollDiscount_payrollId_idx" ON "PayrollDiscount"("payrollId");

-- CreateIndex
CREATE INDEX "PayrollDiscount_calculationOrder_idx" ON "PayrollDiscount"("calculationOrder");

-- CreateIndex
CREATE INDEX "Payroll_positionId_idx" ON "Payroll"("positionId");

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollDiscount" ADD CONSTRAINT "PayrollDiscount_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "Payroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
