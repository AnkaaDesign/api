-- Cut.priority: user-defined queue order WITHIN a status group (lower = higher in the list).
-- DOUBLE PRECISION (Prisma Float) so a drag-reorder can drop a cut between two neighbours by
-- writing a single midpoint value, instead of renumbering the whole queue. Existing rows default
-- to 0, so the pre-reorder order falls back to the (statusOrder, priority, createdAt) sort.

-- AlterTable
ALTER TABLE "Cut" ADD COLUMN "priority" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Cut_priority_idx" ON "Cut"("priority");
