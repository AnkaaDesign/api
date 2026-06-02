-- NFe infNFe/infAdic/infCpl — "Informações Complementares de Interesse do Contribuinte".
-- Populate existing rows by re-running: src/scripts/backfill-fiscal-xml.ts

ALTER TABLE "FiscalDocument"
    ADD COLUMN "infCpl" TEXT;
