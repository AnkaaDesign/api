-- AlterTable
ALTER TABLE "Position" ADD COLUMN "hierarchy" INTEGER;

-- CreateIndex
CREATE INDEX "Position_hierarchy_idx" ON "Position"("hierarchy");
