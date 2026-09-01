-- Assinatura diversificada: um envelope passa a congelar N RECORTES do orcamento.
--
-- Cada contato do cliente recebe o recorte que as funcoes dele pedem (o
-- financeiro sem o layout, o marketing so com a arte, e assim por diante). Cada
-- recorte e um PDF proprio, com hash proprio, ancoras proprias e selo PAdES
-- proprio. Contatos com o MESMO recorte compartilham o PDF, o que faz a coleta
-- comum — todo mundo recebendo tudo — continuar produzindo um unico arquivo,
-- byte a byte como antes deste recurso.
--
-- BACKFILL: todo envelope existente vira um recorte COMPLETO, copiado das
-- colunas do proprio envelope. Nenhum documento e re-renderizado: os bytes
-- assinados sao os que estao no disco, e sao esses que continuam valendo.

CREATE TABLE "EnvelopeDocument" (
  "id"               TEXT NOT NULL,
  "envelopeId"       TEXT NOT NULL,
  "sections"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "variantKey"       TEXT NOT NULL,
  "isFull"           BOOLEAN NOT NULL DEFAULT false,
  "originalFileId"   TEXT NOT NULL,
  "originalSha256"   TEXT NOT NULL,
  "anchors"          JSONB NOT NULL,
  "lateSlots"        JSONB,
  "contentPages"     INTEGER,
  "finalFileId"      TEXT,
  "finalSha256"      TEXT,
  "sealedAt"         TIMESTAMP(3),
  "padesLevel"       TEXT,
  "certSubject"      TEXT,
  "certIssuer"       TEXT,
  "certSerialNumber" TEXT,
  "certCnpj"         TEXT,
  "certNotAfter"     TIMESTAMP(3),
  "tsaUrl"           TEXT,
  "tsaGenTime"       TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EnvelopeDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EnvelopeDocument_envelopeId_variantKey_key"
  ON "EnvelopeDocument"("envelopeId", "variantKey");
CREATE INDEX "EnvelopeDocument_envelopeId_idx" ON "EnvelopeDocument"("envelopeId");
CREATE INDEX "EnvelopeDocument_finalFileId_idx" ON "EnvelopeDocument"("finalFileId");

ALTER TABLE "EnvelopeDocument"
  ADD CONSTRAINT "EnvelopeDocument_envelopeId_fkey"
  FOREIGN KEY ("envelopeId") REFERENCES "SignatureEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnvelopeDocument"
  ADD CONSTRAINT "EnvelopeDocument_originalFileId_fkey"
  FOREIGN KEY ("originalFileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnvelopeDocument"
  ADD CONSTRAINT "EnvelopeDocument_finalFileId_fkey"
  FOREIGN KEY ("finalFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exatamente um recorte completo por envelope. E ele que a Ankaa contra-assina;
-- sem ele o envelope nao teria instrumento inteiro nenhum.
CREATE UNIQUE INDEX "EnvelopeDocument_one_full_per_envelope"
  ON "EnvelopeDocument"("envelopeId") WHERE "isFull";

-- ---------------------------------------------------------------------------
-- Backfill: um recorte completo por envelope existente.
-- ---------------------------------------------------------------------------
-- A chave e a lista canonica de `QUOTE_SECTIONS` unida por "+" — o mesmo valor
-- que `variantKeyOf(FULL_SECTIONS)` produz no codigo. Divergir aqui faria a
-- proxima emissao criar um recorte completo DUPLICADO.
INSERT INTO "EnvelopeDocument" (
  "id", "envelopeId", "sections", "variantKey", "isFull",
  "originalFileId", "originalSha256", "anchors", "lateSlots",
  "finalFileId", "finalSha256", "sealedAt",
  "padesLevel", "certSubject", "certIssuer", "certSerialNumber", "certCnpj", "certNotAfter",
  "tsaUrl", "tsaGenTime", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  e."id",
  ARRAY['VEHICLE','SERVICES','PRICING','DELIVERY','PAYMENT','GUARANTEE','LAYOUT']::TEXT[],
  'VEHICLE+SERVICES+PRICING+DELIVERY+PAYMENT+GUARANTEE+LAYOUT',
  true,
  e."originalFileId", e."originalSha256", e."anchors", e."lateSlots",
  e."finalFileId", e."finalSha256", e."sealedAt",
  e."padesLevel", e."certSubject", e."certIssuer", e."certSerialNumber", e."certCnpj", e."certNotAfter",
  e."tsaUrl", e."tsaGenTime", e."createdAt", e."updatedAt"
FROM "SignatureEnvelope" e;

-- ---------------------------------------------------------------------------
-- EnvelopeSigner.documentId
-- ---------------------------------------------------------------------------
ALTER TABLE "EnvelopeSigner" ADD COLUMN "documentId" TEXT;

UPDATE "EnvelopeSigner" s
   SET "documentId" = d."id"
  FROM "EnvelopeDocument" d
 WHERE d."envelopeId" = s."envelopeId" AND d."isFull";

-- NOT NULL so DEPOIS do backfill: um signatario sem documento nao tem o que
-- assinar, e o codigo depende disso para resolver o hash que o OTP vincula.
ALTER TABLE "EnvelopeSigner" ALTER COLUMN "documentId" SET NOT NULL;

CREATE INDEX "EnvelopeSigner_documentId_idx" ON "EnvelopeSigner"("documentId");

ALTER TABLE "EnvelopeSigner"
  ADD CONSTRAINT "EnvelopeSigner_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "EnvelopeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
