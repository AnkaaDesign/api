/*
  Warnings:

  - You are about to drop the `_TaskPricings` table. If the table is not empty, all the data it contains will be lost.
  - Migrating from many-to-many to one-to-many relationship
  - Each task will keep only the first pricing from the join table

*/
-- AlterTable: Add pricingId column to Task FIRST (before migrating data)
ALTER TABLE "Task" ADD COLUMN "pricingId" TEXT;

-- Migrate existing data from join table to new foreign key
-- For each task, take the FIRST pricing from the many-to-many relationship
-- Use a subquery with DISTINCT ON to select one pricing per task
UPDATE "Task"
SET "pricingId" = subquery.pricing_id
FROM (
  SELECT DISTINCT ON ("A") "A" as task_id, "B" as pricing_id
  FROM "_TaskPricings"
  ORDER BY "A", "B"
) AS subquery
WHERE "Task"."id" = subquery.task_id;

-- Now it's safe to drop the foreign keys and join table
-- DropForeignKey
ALTER TABLE "_TaskPricings" DROP CONSTRAINT "_TaskPricings_A_fkey";

-- DropForeignKey
ALTER TABLE "_TaskPricings" DROP CONSTRAINT "_TaskPricings_B_fkey";

-- DropTable
DROP TABLE "_TaskPricings";

-- CreateIndex
CREATE INDEX "Task_pricingId_idx" ON "Task"("pricingId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_pricingId_fkey" FOREIGN KEY ("pricingId") REFERENCES "TaskPricing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
