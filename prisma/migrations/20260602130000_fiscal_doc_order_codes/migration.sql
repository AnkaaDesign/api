-- Purchase-order codes ("#Ped:" tokens) extracted from FiscalDocument.infCpl.
-- Many-to-many: one NF may list several order codes; one order spans several NFs.
-- Populate existing rows by running: src/scripts/backfill-fiscal-order-codes.ts

CREATE TABLE "FiscalDocumentOrderCode" (
    "id"               TEXT NOT NULL,
    "fiscalDocumentId" TEXT NOT NULL,
    "code"             TEXT NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalDocumentOrderCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalDocumentOrderCode_fiscalDocumentId_code_key"
    ON "FiscalDocumentOrderCode" ("fiscalDocumentId", "code");
CREATE INDEX "FiscalDocumentOrderCode_code_idx"
    ON "FiscalDocumentOrderCode" ("code");
CREATE INDEX "FiscalDocumentOrderCode_fiscalDocumentId_idx"
    ON "FiscalDocumentOrderCode" ("fiscalDocumentId");

ALTER TABLE "FiscalDocumentOrderCode"
    ADD CONSTRAINT "FiscalDocumentOrderCode_fiscalDocumentId_fkey"
    FOREIGN KEY ("fiscalDocumentId") REFERENCES "FiscalDocument"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
