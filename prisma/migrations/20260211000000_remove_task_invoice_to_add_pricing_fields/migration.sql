-- CreateTable
CREATE TABLE "_TaskPricingInvoiceTo" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- AlterTable
ALTER TABLE "TaskPricing" ADD COLUMN     "discountReference" TEXT,
ADD COLUMN     "simultaneousTasks" INTEGER;

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_invoiceToId_fkey";

-- DropIndex
DROP INDEX "Task_invoiceToId_idx";

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "invoiceToId";

-- CreateIndex
CREATE UNIQUE INDEX "_TaskPricingInvoiceTo_AB_unique" ON "_TaskPricingInvoiceTo"("A", "B");

-- CreateIndex
CREATE INDEX "_TaskPricingInvoiceTo_B_index" ON "_TaskPricingInvoiceTo"("B");

-- AddForeignKey
ALTER TABLE "_TaskPricingInvoiceTo" ADD CONSTRAINT "_TaskPricingInvoiceTo_A_fkey" FOREIGN KEY ("A") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskPricingInvoiceTo" ADD CONSTRAINT "_TaskPricingInvoiceTo_B_fkey" FOREIGN KEY ("B") REFERENCES "TaskPricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
