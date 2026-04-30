-- Per-period bonus calculation config. Stores the cumulative `adjustment`
-- (reajuste) applied to a given period's bonuses. Re-introduces the table
-- dropped in 20260429150000 — the prior "store on each bonus row" approach
-- broke applies for periods with no saved bonuses yet, and the live-bonus
-- path never read the saved snapshot, so live values silently ignored the
-- adjustment. Both issues are fixed by reading/writing this table.
--
-- `adjustment` is a fraction (0.05 = +5%). applyPeriodAdjustment ADDS the
-- input delta to the existing value, so repeated applies accumulate.
CREATE TABLE "BonusPeriodConfig" (
  "id"         TEXT NOT NULL,
  "year"       INTEGER NOT NULL,
  "month"      INTEGER NOT NULL,
  "adjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BonusPeriodConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BonusPeriodConfig_year_month_key"
  ON "BonusPeriodConfig"("year", "month");

CREATE INDEX "BonusPeriodConfig_year_month_idx"
  ON "BonusPeriodConfig"("year", "month");
