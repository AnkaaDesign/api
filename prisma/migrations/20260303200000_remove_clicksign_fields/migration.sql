-- Remove ClickSign integration fields from PpeDelivery
DROP INDEX IF EXISTS "PpeDelivery_clicksignDocumentKey_idx";

ALTER TABLE "PpeDelivery" DROP COLUMN IF EXISTS "clicksignEnvelopeId";
ALTER TABLE "PpeDelivery" DROP COLUMN IF EXISTS "clicksignDocumentKey";
ALTER TABLE "PpeDelivery" DROP COLUMN IF EXISTS "clicksignSignerKey";
ALTER TABLE "PpeDelivery" DROP COLUMN IF EXISTS "clicksignSignedAt";
