-- AlterEnum
ALTER TYPE "ChangeLogEntityType" ADD VALUE 'TASK_PRICING';

-- AlterTable
ALTER TABLE "_TaskPricingInvoiceTo" ADD CONSTRAINT "_TaskPricingInvoiceTo_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_TaskPricingInvoiceTo_AB_unique";
