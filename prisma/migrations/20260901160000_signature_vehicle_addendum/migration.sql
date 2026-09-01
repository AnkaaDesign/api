-- Aditivo de identificacao do veiculo.
--
-- POR QUE ELE PRECISA EXISTIR
--   A identidade do veiculo NUNCA cabe no orcamento assinado de um implemento
--   0 km, e isso e estrutural: a assinatura do orcamento E a aprovacao, o
--   caminhao so vem para a empresa depois de aprovado, e o chassi so se le com
--   ele no patio. O documento reserva o espaco ("a registrar") e o selo PAdES
--   congela os bytes na aprovacao — semanas antes de o dado existir.
--
--   Medido no envelope 81ZR-79SY-6EN5: selado 01/09 14:55:45, chassi cadastrado
--   15:10:01. Em producao real a distancia e de semanas, nao de minutos.
--
--   Nao ha como consertar por alteracao: mexer num byte quebra o A1. O aditivo
--   resolve por ACRESCIMO — uma folha propria, selada com o mesmo certificado,
--   que cita o hash do documento assinado e declara os campos que estavam
--   reservados, com o valor e a data em que foram registrados.

ALTER TABLE "SignatureEnvelope" ADD COLUMN "addendumFileId"     TEXT;
ALTER TABLE "SignatureEnvelope" ADD COLUMN "addendumSha256"     TEXT;
ALTER TABLE "SignatureEnvelope" ADD COLUMN "addendumSealedAt"   TIMESTAMP(3);
ALTER TABLE "SignatureEnvelope" ADD COLUMN "addendumPadesLevel" TEXT;

ALTER TABLE "SignatureEnvelope"
  ADD CONSTRAINT "SignatureEnvelope_addendumFileId_fkey"
  FOREIGN KEY ("addendumFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SignatureEnvelope_addendumFileId_idx" ON "SignatureEnvelope"("addendumFileId");

-- O evento da trilha. Append-only e encadeada por hash: a emissao do aditivo e
-- um fato do envelope e precisa entrar na cadeia como qualquer outro.
ALTER TYPE "SignatureEventType" ADD VALUE IF NOT EXISTS 'ADDENDUM_ISSUED';
