-- Bring PpeDeliverySignature in line with the Prisma schema:
--   1. PAdES seal columns + audit fields added to PpeDeliverySignature
--   2. PpeSignatureEventType enum
--   3. PpeDeliverySignatureEvent table (with FKs and indexes)
-- The consolidated migration created the base table without these fields, so
-- any Prisma include that selects the signature relation (e.g. ppeDelivery.create
-- with include: { signature: true } via the default include) currently fails
-- with "column PpeDeliverySignature.padesSealed does not exist".

ALTER TABLE "PpeDeliverySignature"
  ADD COLUMN "padesSealed"      BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN "padesSealedAt"    TIMESTAMP(3),
  ADD COLUMN "certSubject"      TEXT,
  ADD COLUMN "certIssuer"       TEXT,
  ADD COLUMN "certSerialNumber" TEXT,
  ADD COLUMN "certCnpj"         TEXT,
  ADD COLUMN "certNotAfter"     TIMESTAMP(3),
  ADD COLUMN "documentSha256"   TEXT;

CREATE TYPE "PpeSignatureEventType" AS ENUM (
  'DELIVERY_CREATED',
  'DELIVERY_APPROVED',
  'DELIVERY_REJECTED',
  'NOTIFICATION_SENT',
  'NOTIFICATION_FAILED',
  'DOCUMENT_VIEWED',
  'BIOMETRIC_PROMPTED',
  'BIOMETRIC_SUCCEEDED',
  'BIOMETRIC_FAILED',
  'SIGNATURE_SUBMITTED',
  'HMAC_VALIDATED',
  'HMAC_REJECTED',
  'PADES_SEALED',
  'PADES_FAILED',
  'SIGNATURE_COMPLETED',
  'SIGNATURE_FAILED',
  'PDF_DOWNLOADED'
);

CREATE TABLE "PpeDeliverySignatureEvent" (
  "id"          TEXT                    NOT NULL,
  "deliveryId"  TEXT                    NOT NULL,
  "signatureId" TEXT,
  "type"        "PpeSignatureEventType" NOT NULL,
  "occurredAt"  TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorUserId" TEXT,
  "ipAddress"   TEXT,
  "userAgent"   TEXT,
  "metadata"    JSONB,
  CONSTRAINT "PpeDeliverySignatureEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PpeDeliverySignatureEvent_deliveryId_idx"  ON "PpeDeliverySignatureEvent"("deliveryId");
CREATE INDEX "PpeDeliverySignatureEvent_signatureId_idx" ON "PpeDeliverySignatureEvent"("signatureId");
CREATE INDEX "PpeDeliverySignatureEvent_type_idx"        ON "PpeDeliverySignatureEvent"("type");
CREATE INDEX "PpeDeliverySignatureEvent_occurredAt_idx"  ON "PpeDeliverySignatureEvent"("occurredAt");

ALTER TABLE "PpeDeliverySignatureEvent"
  ADD CONSTRAINT "PpeDeliverySignatureEvent_signatureId_fkey"
  FOREIGN KEY ("signatureId") REFERENCES "PpeDeliverySignature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PpeDeliverySignatureEvent"
  ADD CONSTRAINT "PpeDeliverySignatureEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
