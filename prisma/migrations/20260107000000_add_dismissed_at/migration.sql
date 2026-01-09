-- AlterTable
ALTER TABLE "MessageView" ADD COLUMN "dismissedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MessageView_dismissedAt_idx" ON "MessageView"("dismissedAt");
