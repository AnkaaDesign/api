-- SimplifyNfseDocument: Remove duplicate data, keep only Elotech reference ID
-- Allow multiple NFSes per invoice

-- Drop the unique constraint on invoiceId
ALTER TABLE "NfseDocument" DROP CONSTRAINT IF EXISTS "NfseDocument_invoiceId_key";

-- Drop the unique constraint on nDps
ALTER TABLE "NfseDocument" DROP CONSTRAINT IF EXISTS "NfseDocument_nDps_key";

-- Drop indexes for columns being removed
DROP INDEX IF EXISTS "NfseDocument_nfseNumber_idx";
DROP INDEX IF EXISTS "NfseDocument_chaveAcesso_idx";

-- Add new column
ALTER TABLE "NfseDocument" ADD COLUMN "elotechNfseId" INTEGER;

-- Migrate existing data: copy chaveAcesso (string) to elotechNfseId (int)
UPDATE "NfseDocument" SET "elotechNfseId" = CAST("chaveAcesso" AS INTEGER) WHERE "chaveAcesso" IS NOT NULL AND "chaveAcesso" ~ '^\d+$';

-- Drop removed columns
ALTER TABLE "NfseDocument" DROP COLUMN IF EXISTS "nfseNumber";
ALTER TABLE "NfseDocument" DROP COLUMN IF EXISTS "chaveAcesso";
ALTER TABLE "NfseDocument" DROP COLUMN IF EXISTS "verificationCode";
ALTER TABLE "NfseDocument" DROP COLUMN IF EXISTS "nDps";
ALTER TABLE "NfseDocument" DROP COLUMN IF EXISTS "xml";
ALTER TABLE "NfseDocument" DROP COLUMN IF EXISTS "issuedAt";
ALTER TABLE "NfseDocument" DROP COLUMN IF EXISTS "cancelledAt";
ALTER TABLE "NfseDocument" DROP COLUMN IF EXISTS "municipalServiceCode";
ALTER TABLE "NfseDocument" DROP COLUMN IF EXISTS "description";
ALTER TABLE "NfseDocument" DROP COLUMN IF EXISTS "totalAmount";
ALTER TABLE "NfseDocument" DROP COLUMN IF EXISTS "issRate";
ALTER TABLE "NfseDocument" DROP COLUMN IF EXISTS "issAmount";
ALTER TABLE "NfseDocument" DROP COLUMN IF EXISTS "pdfFileId";

-- Drop the nDps sequence (no longer needed)
DROP SEQUENCE IF EXISTS "nfse_ndps_seq";

-- Create new index
CREATE INDEX "NfseDocument_elotechNfseId_idx" ON "NfseDocument"("elotechNfseId");
