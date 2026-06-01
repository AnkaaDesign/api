-- Rich XML-derived fields for the reconciliation fiscal-document detail page.
-- Populate existing rows by running: src/scripts/backfill-fiscal-xml.ts

-- FiscalDocument: identification, protocol, parties, totals, NFSe fields
ALTER TABLE "FiscalDocument"
    ADD COLUMN "series"                    TEXT,
    ADD COLUMN "model"                     TEXT,
    ADD COLUMN "naturezaOperacao"          TEXT,
    ADD COLUMN "protocolNumber"            TEXT,
    ADD COLUMN "authorizationDate"         TIMESTAMP(3),
    ADD COLUMN "cStat"                     TEXT,
    ADD COLUMN "xMotivo"                   TEXT,
    ADD COLUMN "dateInferred"              BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "emitIE"                    TEXT,
    ADD COLUMN "emitAddress"               JSONB,
    ADD COLUMN "destIE"                    TEXT,
    ADD COLUMN "destEmail"                 TEXT,
    ADD COLUMN "destAddress"               JSONB,
    ADD COLUMN "totals"                    JSONB,
    ADD COLUMN "issValue"                  DECIMAL(14, 2),
    ADD COLUMN "issRetained"               BOOLEAN,
    ADD COLUMN "issRate"                   DECIMAL(7, 4),
    ADD COLUMN "baseCalculo"               DECIMAL(14, 2),
    ADD COLUMN "valorLiquido"              DECIMAL(14, 2),
    ADD COLUMN "valorServicos"             DECIMAL(14, 2),
    ADD COLUMN "codigoTributacaoMunicipio" TEXT,
    ADD COLUMN "municipioPrestacao"        TEXT,
    ADD COLUMN "itemListaServico"          TEXT;

-- FiscalDocumentItem: fiscal classification + per-item tax breakdown
ALTER TABLE "FiscalDocumentItem"
    ADD COLUMN "ncm"      TEXT,
    ADD COLUMN "cfop"     TEXT,
    ADD COLUMN "cest"     TEXT,
    ADD COLUMN "ean"      TEXT,
    ADD COLUMN "cst"      TEXT,
    ADD COLUMN "discount" DECIMAL(15, 2),
    ADD COLUMN "freight"  DECIMAL(15, 2),
    ADD COLUMN "taxes"    JSONB;
