-- Artefatos da NFS-e do aerografista: DANFSe, XML e documento fiscal.
--
-- Três ligações novas em AirbrushingNfse:
--
--   pdfFileId  — já existia; passa a ser efetivamente usado. O DANFSe é gerado
--                POR NÓS a partir do XML autorizado, porque a API nacional de
--                DANFSe foi desativada (comprovado em 14/08/2026: HTTP 404 em
--                todas as rotas do ADN e HTTP 501 Not Implemented na SEFIN).
--
--   xmlFileId  — o XML autorizado gravado em "Notas Fiscais/XML", que é onde
--                vivem os demais XMLs do sistema.
--
--   fiscalDocumentId — o XML também passa pelo MESMO ingestor do SIEG
--                (SiegXmlParserService + SiegIngestionService), que já entende o
--                layout nacional (parseSefinNFSe) e classifica a nota como
--                ENTRADA quando o emitente não é a Ankaa — exatamente o caso
--                aqui, já que quem presta o serviço é o pintor.

ALTER TABLE "AirbrushingNfse"
  ADD COLUMN "xmlFileId"        TEXT,
  ADD COLUMN "fiscalDocumentId" TEXT;

CREATE INDEX "AirbrushingNfse_fiscalDocumentId_idx" ON "AirbrushingNfse"("fiscalDocumentId");

-- SetNull em todas: a nota é documento fiscal e não pode sumir porque um arquivo
-- foi removido ou o documento fiscal foi reimportado.
ALTER TABLE "AirbrushingNfse"
  ADD CONSTRAINT "AirbrushingNfse_xmlFileId_fkey"
  FOREIGN KEY ("xmlFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AirbrushingNfse"
  ADD CONSTRAINT "AirbrushingNfse_fiscalDocumentId_fkey"
  FOREIGN KEY ("fiscalDocumentId") REFERENCES "FiscalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
