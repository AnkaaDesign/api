-- Link SIEG-imported SAIDA (outgoing/emitted) FiscalDocuments to the
-- NfseDocument they were generated from, making the "vinculada" status
-- direction-aware: an emitted NFS-e can never get a bank ReconciliationMatch
-- (the matcher only considers ENTRADA docs), so its durable link is to the
-- billing record (NfseDocument → Invoice/Task), not a bank transaction.
--
-- One NfseDocument ⇄ one FiscalDocument (@unique). onDelete SET NULL so
-- removing the emission record never deletes the imported SIEG document.

-- AlterTable
ALTER TABLE "FiscalDocument" ADD COLUMN "nfseDocumentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_nfseDocumentId_key" ON "FiscalDocument"("nfseDocumentId");

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_nfseDocumentId_fkey" FOREIGN KEY ("nfseDocumentId") REFERENCES "NfseDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
