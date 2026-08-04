-- Dossie congelado no selamento.
--
-- Ate aqui o dossie era remontado a cada download. Enquanto o envelope esta aberto isso
-- e o comportamento CERTO -- o documento muda a cada assinatura coletada, e um arquivo
-- salvo no meio do caminho seria uma foto desatualizada. Quando o envelope conclui, o
-- conteudo para de mudar: e nesse instante que ele vira artefato, ao lado do PDF selado.
--
-- A coluna existe para que o arquivo tenha DONO. Um File sem referencia nao tem pasta
-- canonica (o organizador nao sabe onde arquiva-lo) e nao tem quem o proteja -- foi
-- exatamente assim que 32 layouts de orcamento viraram "orfaos" em 2026-06-07.
-- ON DELETE SET NULL: apagar o arquivo nao pode derrubar o envelope; e o gatilho
-- file_no_delete_when_referenced ja impede apagar enquanto esta referenciado.
ALTER TABLE "SignatureEnvelope" ADD COLUMN IF NOT EXISTS "dossierFileId" TEXT;

ALTER TABLE "SignatureEnvelope"
  DROP CONSTRAINT IF EXISTS "SignatureEnvelope_dossierFileId_fkey";
ALTER TABLE "SignatureEnvelope"
  ADD CONSTRAINT "SignatureEnvelope_dossierFileId_fkey"
  FOREIGN KEY ("dossierFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "SignatureEnvelope_dossierFileId_idx"
  ON "SignatureEnvelope"("dossierFileId");
