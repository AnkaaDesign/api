/*
  Warnings:

  - You are about to drop the column `taskId` on the `TaskPricing` table. All the data in the column will be lost.

*/

-- CreateTable (create join table FIRST)
CREATE TABLE "_TaskPricings" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TaskPricings_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_TaskPricings_B_index" ON "_TaskPricings"("B");

-- Migrate existing data: Copy taskId relationships to the join table
-- A = Task ID, B = TaskPricing ID
INSERT INTO "_TaskPricings" ("A", "B")
SELECT "taskId", "id" FROM "TaskPricing" WHERE "taskId" IS NOT NULL;

-- Now drop the old foreign key and column
-- DropForeignKey
ALTER TABLE "TaskPricing" DROP CONSTRAINT "TaskPricing_taskId_fkey";

-- DropIndex
DROP INDEX "TaskPricing_taskId_idx";

-- DropIndex
DROP INDEX "TaskPricing_taskId_key";

-- AlterTable
ALTER TABLE "TaskPricing" DROP COLUMN "taskId";

-- AddForeignKey
ALTER TABLE "_TaskPricings" ADD CONSTRAINT "_TaskPricings_A_fkey" FOREIGN KEY ("A") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskPricings" ADD CONSTRAINT "_TaskPricings_B_fkey" FOREIGN KEY ("B") REFERENCES "TaskPricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
