-- Add signatureBatchId field to PpeDelivery for grouping deliveries that share the same signature document
-- When multiple PPE deliveries are created for the same user (via schedule or batch), they share one signature

-- Add the signatureBatchId column
ALTER TABLE "PpeDelivery" ADD COLUMN "signatureBatchId" TEXT;

-- Create index for efficient batch lookups
CREATE INDEX "PpeDelivery_signatureBatchId_idx" ON "PpeDelivery"("signatureBatchId");
