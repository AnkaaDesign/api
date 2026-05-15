-- CreateEnum
CREATE TYPE "GoalMetric" AS ENUM ('TASKS_COMPLETED', 'INVOICES_PAID', 'COLLABORATORS_PER_SECTOR');

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "metric" "GoalMetric" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "targetValue" DECIMAL(15,2) NOT NULL,
    "sectorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Goal_metric_year_month_idx" ON "Goal"("metric", "year", "month");

-- CreateIndex
CREATE INDEX "Goal_year_month_idx" ON "Goal"("year", "month");

-- CreateIndex
CREATE INDEX "Goal_sectorId_idx" ON "Goal"("sectorId");

-- Partial unique index: enforces one goal per (metric, year, month) when sectorId IS NULL.
-- Sector-keyed metrics get their own uniqueness from the constraint below.
CREATE UNIQUE INDEX "Goal_metric_year_month_null_sector_unique" ON "Goal"("metric", "year", "month") WHERE "sectorId" IS NULL;

-- CreateIndex (sector-scoped uniqueness)
CREATE UNIQUE INDEX "Goal_metric_year_month_sectorId_key" ON "Goal"("metric", "year", "month", "sectorId");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
