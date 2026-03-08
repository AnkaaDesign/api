-- AlterEnum: Rename OVERDUE to SETTLED in PaymentStatus
ALTER TYPE "PaymentStatus" RENAME VALUE 'OVERDUE' TO 'SETTLED';
