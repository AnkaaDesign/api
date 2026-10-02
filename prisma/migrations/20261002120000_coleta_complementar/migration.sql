-- COLETA COMPLEMENTAR — um responsável acrescentado DEPOIS da assinatura
-- concluída passa a poder assinar sem anular quem já assinou.
--
-- Até aqui um orçamento tinha, no máximo, UMA coleta viva ou concluída: emitir
-- sobre a concluída era recusado ("criaria um segundo contrato selado"). O
-- responsável que entrasse na tarefa depois não tinha como assinar.
--
-- A complementar é um envelope próprio (bytes, hashes, trilha e selo próprios)
-- que APONTA para a coleta concluída que complementa (`baseEnvelopeId`). Ela
-- não entra na corrente de versões (`previousEnvelopeId`, `version + 1`): não
-- substitui nada, acrescenta assinantes ao mesmo contrato.
--
-- Aditiva: toda coleta existente nasce `PRIMARY`, que é o que ela é.
CREATE TYPE "EnvelopeKind" AS ENUM ('PRIMARY', 'SUPPLEMENT');

ALTER TABLE "SignatureEnvelope"
  ADD COLUMN "kind" "EnvelopeKind" NOT NULL DEFAULT 'PRIMARY',
  ADD COLUMN "baseEnvelopeId" TEXT;

ALTER TABLE "SignatureEnvelope"
  ADD CONSTRAINT "SignatureEnvelope_baseEnvelopeId_fkey"
  FOREIGN KEY ("baseEnvelopeId") REFERENCES "SignatureEnvelope"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Complementar SEMPRE tem base; principal NUNCA tem.
ALTER TABLE "SignatureEnvelope"
  ADD CONSTRAINT "SignatureEnvelope_supplement_has_base"
  CHECK (("kind" = 'SUPPLEMENT') = ("baseEnvelopeId" IS NOT NULL));

CREATE INDEX "SignatureEnvelope_baseEnvelopeId_idx" ON "SignatureEnvelope"("baseEnvelopeId");

-- No máximo UMA coleta EM ANDAMENTO por orçamento, seja principal ou
-- complementar. Era regra só de código; com dois tipos de coleta convivendo,
-- dois cliques simultâneos são a forma mais barata de quebrá-la.
CREATE UNIQUE INDEX "SignatureEnvelope_one_running_per_quote"
  ON "SignatureEnvelope"("quoteId") WHERE "status" = 'RUNNING';
