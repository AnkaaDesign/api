-- Additive creation of the WasteCertificate table + enum.
-- Applied manually because the repo's migration history has pre-existing
-- drift (shadow-DB replay of 20260406000000_consolidated_schema_update fails).
-- This file documents exactly what was applied to the dev DB.

DO $$ BEGIN
  CREATE TYPE "WasteCertificateStatus" AS ENUM ('GENERATED', 'SIGNED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "WasteCertificate" (
  "id" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "volume" TEXT NOT NULL,
  "status" "WasteCertificateStatus" NOT NULL DEFAULT 'GENERATED',
  "pdfFileId" TEXT,
  "signedFileId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WasteCertificate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WasteCertificate_status_idx" ON "WasteCertificate"("status");
CREATE INDEX IF NOT EXISTS "WasteCertificate_createdAt_idx" ON "WasteCertificate"("createdAt");

DO $$ BEGIN
  ALTER TABLE "WasteCertificate"
    ADD CONSTRAINT "WasteCertificate_pdfFileId_fkey"
    FOREIGN KEY ("pdfFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "WasteCertificate"
    ADD CONSTRAINT "WasteCertificate_signedFileId_fkey"
    FOREIGN KEY ("signedFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
