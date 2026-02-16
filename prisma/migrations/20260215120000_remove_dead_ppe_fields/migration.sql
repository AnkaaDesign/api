-- AlterTable: Remove dead fields from PpeDelivery
-- signatureBatchId: never written or read in application code
-- clicksignRequestKey: written but never read in application code

DROP INDEX IF EXISTS "PpeDelivery_signatureBatchId_idx";

ALTER TABLE "PpeDelivery" DROP COLUMN IF EXISTS "signatureBatchId";
ALTER TABLE "PpeDelivery" DROP COLUMN IF EXISTS "clicksignRequestKey";
