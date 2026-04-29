-- Per-period bonus configuration. Stores admin-applied adjustments
-- ("reajuste") that the salary-based logistic algorithm bakes into the
-- bonus calculation for that specific period.
CREATE TABLE "BonusPeriodConfig" (
  "id"         TEXT NOT NULL,
  "year"       INTEGER NOT NULL,
  "month"      INTEGER NOT NULL,
  "adjustment" DECIMAL(5, 2) NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BonusPeriodConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BonusPeriodConfig_year_month_key"
  ON "BonusPeriodConfig"("year", "month");

CREATE INDEX "BonusPeriodConfig_year_month_idx"
  ON "BonusPeriodConfig"("year", "month");
