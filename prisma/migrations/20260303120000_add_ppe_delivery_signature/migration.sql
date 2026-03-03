-- CreateEnum: BiometricMethod
CREATE TYPE "BiometricMethod" AS ENUM ('FINGERPRINT', 'FACE_ID', 'IRIS', 'DEVICE_PIN', 'NONE');

-- CreateEnum: NetworkType
CREATE TYPE "NetworkType" AS ENUM ('WIFI', 'CELLULAR', 'ETHERNET', 'UNKNOWN');

-- CreateTable: PpeDeliverySignature
CREATE TABLE "PpeDeliverySignature" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "signedByUserId" TEXT NOT NULL,
    "signedByCpf" TEXT NOT NULL,
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
    "evidenceJson" JSONB NOT NULL,
    "legalBasis" TEXT NOT NULL DEFAULT 'NR-6/CLT Art. 166 - Comprovacao de entrega de EPI',
    "consentGiven" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PpeDeliverySignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PpeDeliverySignature_deliveryId_key" ON "PpeDeliverySignature"("deliveryId");
CREATE INDEX "PpeDeliverySignature_signedByUserId_idx" ON "PpeDeliverySignature"("signedByUserId");
CREATE INDEX "PpeDeliverySignature_deliveryId_idx" ON "PpeDeliverySignature"("deliveryId");

-- AddForeignKey
ALTER TABLE "PpeDeliverySignature" ADD CONSTRAINT "PpeDeliverySignature_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "PpeDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PpeDeliverySignature" ADD CONSTRAINT "PpeDeliverySignature_signedByUserId_fkey" FOREIGN KEY ("signedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PpeDeliverySignature" ADD CONSTRAINT "PpeDeliverySignature_signedDocumentId_fkey" FOREIGN KEY ("signedDocumentId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
