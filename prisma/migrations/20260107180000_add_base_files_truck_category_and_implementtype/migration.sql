-- CreateEnum: TruckCategory
CREATE TYPE "TruckCategory" AS ENUM ('MINI', 'VUC', 'THREE_QUARTER', 'RIGID', 'TRUCK', 'SEMI_TRAILER', 'B_DOUBLE');

-- CreateEnum: ImplementType
CREATE TYPE "ImplementType" AS ENUM ('CORRUGATED', 'INSULATED', 'CURTAIN_SIDE', 'TANK', 'FLATBED');

-- AlterTable: Make Task.commission nullable
ALTER TABLE "Task" ALTER COLUMN "commission" DROP NOT NULL;

-- AlterTable: Add category and implementType to Truck
ALTER TABLE "Truck" ADD COLUMN "category" "TruckCategory",
ADD COLUMN "implementType" "ImplementType";

-- CreateTable: _TASK_BASE_FILES (many-to-many relation between Task and File)
CREATE TABLE "_TASK_BASE_FILES" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_TASK_BASE_FILES_AB_unique" ON "_TASK_BASE_FILES"("A", "B");

-- CreateIndex
CREATE INDEX "_TASK_BASE_FILES_B_index" ON "_TASK_BASE_FILES"("B");

-- AddForeignKey
ALTER TABLE "_TASK_BASE_FILES" ADD CONSTRAINT "_TASK_BASE_FILES_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TASK_BASE_FILES" ADD CONSTRAINT "_TASK_BASE_FILES_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
