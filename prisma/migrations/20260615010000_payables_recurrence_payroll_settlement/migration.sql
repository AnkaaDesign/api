-- Recurring categories: fixed vs variable + statutory due day.
CREATE TYPE "RecurrenceKind" AS ENUM ('FIXED', 'VARIABLE');

ALTER TABLE "TransactionCategory"
  ADD COLUMN "recurrenceKind" "RecurrenceKind" NOT NULL DEFAULT 'VARIABLE',
  ADD COLUMN "fixedAmount" DECIMAL(12,2),
  ADD COLUMN "dueDayOfMonth" INTEGER;

-- One settlement record per payroll competence month (folha is paid as a batch).
CREATE TABLE "PayrollMonthSettlement" (
  "id"        TEXT NOT NULL,
  "year"      INTEGER NOT NULL,
  "month"     INTEGER NOT NULL,
  "amount"    DECIMAL(12,2),
  "paidAt"    TIMESTAMP(3),
  "paidById"  TEXT,
  "notes"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollMonthSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollMonthSettlement_year_month_key" ON "PayrollMonthSettlement"("year", "month");
CREATE INDEX "PayrollMonthSettlement_year_month_idx" ON "PayrollMonthSettlement"("year", "month");
