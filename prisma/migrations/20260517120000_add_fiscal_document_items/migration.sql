-- Adds the FiscalDocumentItem table that stores the service/product lines of
-- a FiscalDocument. The bank reconciliation NF detail modal renders these so
-- users can see WHAT was billed without parsing raw XML on every request.
--
--   * NFe / NFCe -> one row per `infNFe.det[]` (cProd, xProd, qCom, uCom, vUnCom, vProd)
--   * NFSe (ABRASF v2.03) -> single row from `Servico` (ItemListaServico, Discriminacao, Valores.ValorServicos)
--   * NFSe (SEFIN Nacional DPS) -> single row from `serv` (cServ, discServ/xDescServ, valores.vServPrest)
--   * CTe -> synthesized single row (no product lines in the freight document)
--
-- Re-imports of the same XML delete-then-create items so the list stays
-- consistent if the parser improves later. Existing rows can be backfilled
-- via scripts/backfill-fiscal-document-items.ts.

-- CreateTable
CREATE TABLE "FiscalDocumentItem" (
    "id" TEXT NOT NULL,
    "fiscalDocumentId" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(15,4),
    "unit" TEXT,
    "unitValue" DECIMAL(15,4),
    "totalValue" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalDocumentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalDocumentItem_fiscalDocumentId_idx" ON "FiscalDocumentItem"("fiscalDocumentId");

-- AddForeignKey
ALTER TABLE "FiscalDocumentItem" ADD CONSTRAINT "FiscalDocumentItem_fiscalDocumentId_fkey" FOREIGN KEY ("fiscalDocumentId") REFERENCES "FiscalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
