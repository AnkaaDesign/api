-- Add ClickSign integration fields to PpeDelivery table
-- This migration adds fields to track ClickSign digital signature workflow

-- Add ClickSign fields to PpeDelivery
ALTER TABLE "PpeDelivery" ADD COLUMN IF NOT EXISTS "clicksignEnvelopeId" TEXT;
ALTER TABLE "PpeDelivery" ADD COLUMN IF NOT EXISTS "clicksignDocumentKey" TEXT;
ALTER TABLE "PpeDelivery" ADD COLUMN IF NOT EXISTS "clicksignRequestKey" TEXT;
ALTER TABLE "PpeDelivery" ADD COLUMN IF NOT EXISTS "clicksignSignerKey" TEXT;
ALTER TABLE "PpeDelivery" ADD COLUMN IF NOT EXISTS "clicksignSignedAt" TIMESTAMP(3);
ALTER TABLE "PpeDelivery" ADD COLUMN IF NOT EXISTS "deliveryDocumentId" TEXT;

-- Add foreign key for deliveryDocument
ALTER TABLE "PpeDelivery"
ADD CONSTRAINT "PpeDelivery_deliveryDocumentId_fkey"
FOREIGN KEY ("deliveryDocumentId") REFERENCES "File"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Add index for clicksignDocumentKey (used for webhook lookup)
CREATE INDEX IF NOT EXISTS "PpeDelivery_clicksignDocumentKey_idx" ON "PpeDelivery"("clicksignDocumentKey");
