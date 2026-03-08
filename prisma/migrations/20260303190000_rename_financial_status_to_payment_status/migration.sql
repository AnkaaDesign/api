-- Rename FinancialStatus enum to PaymentStatus
ALTER TYPE "FinancialStatus" RENAME TO "PaymentStatus";

-- Rename columns on Task table
ALTER TABLE "Task" RENAME COLUMN "financialStatus" TO "paymentStatus";
ALTER TABLE "Task" RENAME COLUMN "financialStatusOrder" TO "paymentStatusOrder";
