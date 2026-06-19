-- Recurrent payables: first-class monthly obligations (rent, internet, energy,
-- water…). RecurrentPayable is the contract/template; RecurrentPayableOccurrence
-- is the materialized per-month "conta a pagar" row (single source of truth for
-- the month, carrying the estimate, the real paid amount, and post-payment NF /
-- bank-transaction links).

-- CreateEnum
CREATE TYPE "RecurrentPayableStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateTable
CREATE TABLE "RecurrentPayable" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "supplierId" TEXT,
    "payeeName" TEXT,
    "categoryId" TEXT NOT NULL,
    "amountKind" "RecurrenceKind" NOT NULL DEFAULT 'VARIABLE',
    "fixedAmount" DECIMAL(12,2),
    "estimatedAmount" DECIMAL(12,2),
    "frequency" "ScheduleFrequency" NOT NULL DEFAULT 'MONTHLY',
    "frequencyCount" INTEGER NOT NULL DEFAULT 1,
    "dueDayOfMonth" INTEGER NOT NULL,
    "paymentMethod" "PaymentMethod",
    "expectsNf" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "nextRun" TIMESTAMP(3),
    "lastRun" TIMESTAMP(3),
    "lastFiredAt" TIMESTAMP(3),
    "lastRunStatus" "ScheduleRunStatus",
    "lastRunError" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurrentPayable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurrentPayableOccurrence" (
    "id" TEXT NOT NULL,
    "recurrentPayableId" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "estimatedAmount" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2),
    "status" "RecurrentPayableStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "paymentMethod" "PaymentMethod",
    "expectsNf" BOOLEAN NOT NULL DEFAULT false,
    "fiscalDocumentId" TEXT,
    "bankTransactionId" TEXT,
    "nfLinkedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurrentPayableOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurrentPayable_nextRun_idx" ON "RecurrentPayable"("nextRun");

-- CreateIndex
CREATE INDEX "RecurrentPayable_isActive_idx" ON "RecurrentPayable"("isActive");

-- CreateIndex
CREATE INDEX "RecurrentPayable_categoryId_idx" ON "RecurrentPayable"("categoryId");

-- CreateIndex
CREATE INDEX "RecurrentPayable_supplierId_idx" ON "RecurrentPayable"("supplierId");

-- CreateIndex
CREATE INDEX "RecurrentPayableOccurrence_recurrentPayableId_idx" ON "RecurrentPayableOccurrence"("recurrentPayableId");

-- CreateIndex
CREATE INDEX "RecurrentPayableOccurrence_status_idx" ON "RecurrentPayableOccurrence"("status");

-- CreateIndex
CREATE INDEX "RecurrentPayableOccurrence_dueDate_idx" ON "RecurrentPayableOccurrence"("dueDate");

-- CreateIndex
CREATE INDEX "RecurrentPayableOccurrence_competence_idx" ON "RecurrentPayableOccurrence"("competence");

-- CreateIndex
CREATE INDEX "RecurrentPayableOccurrence_bankTransactionId_idx" ON "RecurrentPayableOccurrence"("bankTransactionId");

-- CreateIndex
CREATE INDEX "RecurrentPayableOccurrence_fiscalDocumentId_idx" ON "RecurrentPayableOccurrence"("fiscalDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurrentPayableOccurrence_recurrentPayableId_competence_key" ON "RecurrentPayableOccurrence"("recurrentPayableId", "competence");

-- AddForeignKey
ALTER TABLE "RecurrentPayable" ADD CONSTRAINT "RecurrentPayable_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurrentPayable" ADD CONSTRAINT "RecurrentPayable_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurrentPayableOccurrence" ADD CONSTRAINT "RecurrentPayableOccurrence_recurrentPayableId_fkey" FOREIGN KEY ("recurrentPayableId") REFERENCES "RecurrentPayable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
