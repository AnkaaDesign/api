-- Add REGISTERING status to BankSlipStatus enum
-- This intermediate status prevents race conditions during Sicredi API registration
ALTER TYPE "BankSlipStatus" ADD VALUE IF NOT EXISTS 'REGISTERING' AFTER 'CREATING';

-- Add unique constraint on nDps to prevent duplicate DPS numbers
CREATE UNIQUE INDEX "NfseDocument_nDps_key" ON "NfseDocument"("nDps") WHERE "nDps" IS NOT NULL;

-- Create a sequence for atomic nDps generation
CREATE SEQUENCE IF NOT EXISTS nfse_ndps_seq;

-- Initialize the sequence to the current max nDps value
SELECT setval('nfse_ndps_seq', COALESCE(NULLIF((SELECT MAX("nDps") FROM "NfseDocument"), 0), 1), false);
