-- AlterTable
ALTER TABLE "TaskPricingCustomerConfig" ADD COLUMN "paymentCondition" TEXT;
ALTER TABLE "TaskPricingCustomerConfig" ADD COLUMN "downPaymentDate" TIMESTAMP(3);
