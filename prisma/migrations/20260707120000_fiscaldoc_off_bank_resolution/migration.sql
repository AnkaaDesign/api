-- Off-bank settlement for received fiscal documents (never match a bank line).
CREATE TYPE "FiscalDocOffBankResolution" AS ENUM ('BONIFICACAO', 'CARTAO_CREDITO', 'SEM_PAGAMENTO', 'OUTROS');

ALTER TABLE "FiscalDocument"
  ADD COLUMN "offBankResolution"       "FiscalDocOffBankResolution",
  ADD COLUMN "offBankResolvedAt"       TIMESTAMP(3),
  ADD COLUMN "offBankResolutionSource" "ReconciliationSource",
  ADD COLUMN "offBankResolvedById"     TEXT,
  ADD COLUMN "offBankResolutionNotes"  TEXT;

-- Partial index: candidate/pending queries filter on `offBankResolvedAt IS NULL`.
CREATE INDEX "FiscalDocument_offBankResolvedAt_idx" ON "FiscalDocument" ("offBankResolvedAt");
