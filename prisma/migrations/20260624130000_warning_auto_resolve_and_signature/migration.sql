-- Warning auto-resolution (decurso de prazo) + in-app signature/refusal subsystem
-- Mirrors the PPE delivery signature model (biometric evidence + HMAC + PAdES seal).

-- CreateEnum
CREATE TYPE "WarningSignatureEventType" AS ENUM ('WARNING_CREATED', 'DOCUMENT_VIEWED', 'BIOMETRIC_PROMPTED', 'BIOMETRIC_SUCCEEDED', 'BIOMETRIC_FAILED', 'SIGNATURE_SUBMITTED', 'SIGNATURE_REFUSED', 'HMAC_VALIDATED', 'HMAC_REJECTED', 'PADES_SEALED', 'PADES_FAILED', 'SIGNATURE_COMPLETED', 'SIGNATURE_FAILED', 'PDF_DOWNLOADED');

-- AlterTable
ALTER TABLE "Warning" ADD COLUMN     "autoResolve" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "autoResolved" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WarningSignature" (
    "id" TEXT NOT NULL,
    "warningId" TEXT NOT NULL,
    "signedByUserId" TEXT NOT NULL,
    "signedByCpf" TEXT NOT NULL,
    "refused" BOOLEAN NOT NULL DEFAULT false,
    "refusedReason" TEXT,
    "registeredById" TEXT,
    "biometricMethod" "BiometricMethod" NOT NULL DEFAULT 'NONE',
    "biometricSuccess" BOOLEAN NOT NULL DEFAULT false,
    "deviceBrand" TEXT,
    "deviceModel" TEXT,
    "deviceOs" TEXT,
    "deviceOsVersion" TEXT,
    "appVersion" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationAccuracy" DOUBLE PRECISION,
    "networkType" "NetworkType" NOT NULL DEFAULT 'UNKNOWN',
    "ipAddress" TEXT,
    "clientTimestamp" TIMESTAMP(3) NOT NULL,
    "serverTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceHash" TEXT NOT NULL,
    "hmacSignature" TEXT NOT NULL,
    "signedDocumentId" TEXT,
    "padesSealed" BOOLEAN NOT NULL DEFAULT false,
    "padesSealedAt" TIMESTAMP(3),
    "certSubject" TEXT,
    "certIssuer" TEXT,
    "certSerialNumber" TEXT,
    "certCnpj" TEXT,
    "certNotAfter" TIMESTAMP(3),
    "documentSha256" TEXT,
    "evidenceJson" JSONB NOT NULL,
    "legalBasis" TEXT NOT NULL DEFAULT 'CLT Art. 2 - Poder diretivo; ciência de medida disciplinar',
    "consentGiven" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarningSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarningSignatureEvent" (
    "id" TEXT NOT NULL,
    "warningId" TEXT NOT NULL,
    "signatureId" TEXT,
    "type" "WarningSignatureEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,

    CONSTRAINT "WarningSignatureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarningSignature_warningId_key" ON "WarningSignature"("warningId");

-- CreateIndex
CREATE INDEX "WarningSignature_signedByUserId_idx" ON "WarningSignature"("signedByUserId");

-- CreateIndex
CREATE INDEX "WarningSignature_warningId_idx" ON "WarningSignature"("warningId");

-- CreateIndex
CREATE INDEX "WarningSignatureEvent_warningId_idx" ON "WarningSignatureEvent"("warningId");

-- CreateIndex
CREATE INDEX "WarningSignatureEvent_signatureId_idx" ON "WarningSignatureEvent"("signatureId");

-- CreateIndex
CREATE INDEX "WarningSignatureEvent_type_idx" ON "WarningSignatureEvent"("type");

-- CreateIndex
CREATE INDEX "WarningSignatureEvent_occurredAt_idx" ON "WarningSignatureEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "Warning_isActive_autoResolve_followUpDate_idx" ON "Warning"("isActive", "autoResolve", "followUpDate");

-- AddForeignKey
ALTER TABLE "WarningSignature" ADD CONSTRAINT "WarningSignature_warningId_fkey" FOREIGN KEY ("warningId") REFERENCES "Warning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarningSignature" ADD CONSTRAINT "WarningSignature_signedByUserId_fkey" FOREIGN KEY ("signedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarningSignature" ADD CONSTRAINT "WarningSignature_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarningSignature" ADD CONSTRAINT "WarningSignature_signedDocumentId_fkey" FOREIGN KEY ("signedDocumentId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarningSignatureEvent" ADD CONSTRAINT "WarningSignatureEvent_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "WarningSignature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarningSignatureEvent" ADD CONSTRAINT "WarningSignatureEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
