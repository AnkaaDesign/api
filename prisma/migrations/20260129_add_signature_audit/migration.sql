-- AlterTable: Add in-app signature fields to PpeDelivery
ALTER TABLE "PpeDelivery" ADD COLUMN IF NOT EXISTS "signatureMethod" TEXT;
ALTER TABLE "PpeDelivery" ADD COLUMN IF NOT EXISTS "signatureTermsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "PpeDelivery" ADD COLUMN IF NOT EXISTS "signatureDeviceInfo" JSONB;
ALTER TABLE "PpeDelivery" ADD COLUMN IF NOT EXISTS "signatureIpAddress" TEXT;

-- CreateTable: SignatureAuditLog for tracking signature workflow events
CREATE TABLE IF NOT EXISTS "SignatureAuditLog" (
    "id" TEXT NOT NULL,
    "ppeDeliveryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "signatureMethod" TEXT NOT NULL,
    "deviceInfo" JSONB,
    "ipAddress" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Indexes for SignatureAuditLog
CREATE INDEX IF NOT EXISTS "SignatureAuditLog_ppeDeliveryId_idx" ON "SignatureAuditLog"("ppeDeliveryId");
CREATE INDEX IF NOT EXISTS "SignatureAuditLog_userId_idx" ON "SignatureAuditLog"("userId");
CREATE INDEX IF NOT EXISTS "SignatureAuditLog_action_idx" ON "SignatureAuditLog"("action");
CREATE INDEX IF NOT EXISTS "SignatureAuditLog_createdAt_idx" ON "SignatureAuditLog"("createdAt");

-- AddForeignKey: PpeDelivery relation
ALTER TABLE "SignatureAuditLog" ADD CONSTRAINT "SignatureAuditLog_ppeDeliveryId_fkey" FOREIGN KEY ("ppeDeliveryId") REFERENCES "PpeDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: User relation
ALTER TABLE "SignatureAuditLog" ADD CONSTRAINT "SignatureAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
