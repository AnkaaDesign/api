-- Add generateBankSlip flag to TaskQuoteCustomerConfig.
-- Decouples bank slip (Sicredi boleto) generation from generateInvoice (NFSe) generation,
-- so users can emit NFSe without auto-creating boletos for clients that pay by other means.
-- Backfill default = true preserves existing behavior for all current configs.
ALTER TABLE "TaskQuoteCustomerConfig"
  ADD COLUMN "generateBankSlip" BOOLEAN NOT NULL DEFAULT true;
