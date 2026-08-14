-- NFS-e do aerografista (prestador MEI) pelo Sistema Nacional / SEFIN.
--
-- Este bloco é o INVERSO do NfseDocument já existente. Lá a Ankaa é a prestadora,
-- o Customer é o tomador e a emissão sai pelo portal municipal da Elotech/Ibiporã.
-- Aqui o AEROGRAFISTA é o prestador, a Ankaa é a tomadora, e a emissão vai direto
-- à API nacional assinada com o certificado A1 do próprio pintor.
--
-- A API nacional serve qualquer pintor porque a Res. CGSN 169/2022 (art. 106-A),
-- em vigor desde 01/09/2023, obriga o MEI ao padrão nacional em TODOS os
-- municípios — as regras de recepção E0016/E0037/E0038/E0039 dispensam a checagem
-- de convênio "quando o emitente da DPS for MEI na data de competência". Por isso
-- não há caminho municipal de fallback a manter.

-- ─────────────────────────────────────────────────────────────────────────────
-- Changelog: não existia entity type para NFS-e nenhuma. Emissão automática move
-- dinheiro e é irreversível depois de autorizada, então precisa de trilha.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'AIRBRUSHING_NFSE';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'FISCAL_EMITTER_PROFILE';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'FISCAL_CERTIFICATE';

-- ─────────────────────────────────────────────────────────────────────────────
-- Identidade fiscal do prestador.
--
-- Tabela separada em vez de colunas em "User": são ~12 campos que só fazem sentido
-- para quem é prestador, e User já tem 140 colunas mais a convenção de colunas
-- *Normalized geradas. O CNPJ aqui é a fonte da verdade da EMISSÃO;
-- EmploymentContract."providerCnpj" continua sendo o dado do vínculo/pagamento.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "FiscalEmitterProfile" (
  "id"                    TEXT         NOT NULL,
  "userId"                TEXT         NOT NULL,
  "cnpj"                  TEXT         NOT NULL,
  "corporateName"         TEXT         NOT NULL,
  "tradeName"             TEXT,
  -- IM é opcional no layout: E0116 só a exige quando o município mantém registro
  -- complementar do contribuinte no CNC. MEI comum não tem, e nesse caso o
  -- elemento precisa ser OMITIDO da DPS, nunca enviado vazio.
  "municipalRegistration" TEXT,
  -- Vira cLocEmi. E0041: para MEI tem de ser o município do cadastro CNPJ, não
  -- onde o serviço foi executado.
  "municipalityIbgeCode"  TEXT         NOT NULL,
  -- prest/regTrib/opSimpNac: 1=Não optante, 2=Optante MEI, 3=Optante ME/EPP.
  "opSimpNac"             INTEGER      NOT NULL DEFAULT 2,
  -- prest/regTrib/regEspTrib: E0174 obriga 0 (Nenhum) para MEI. regApTribSN é
  -- proibido para MEI (E0162) e por isso nem existe como coluna.
  "regEspTrib"            INTEGER      NOT NULL DEFAULT 0,
  -- 140501 = "restauração, ..., PINTURA, ... de objetos quaisquer" (LC 116, 14.05).
  "cTribNac"              TEXT         NOT NULL DEFAULT '140501',
  "cTribMun"              TEXT,
  "serviceDescription"    TEXT         NOT NULL DEFAULT 'Serviço de aerografia e pintura artística',
  "serie"                 TEXT         NOT NULL DEFAULT '00001',
  "environment"           INTEGER      NOT NULL DEFAULT 2,
  "emissionEnabled"       BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FiscalEmitterProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalEmitterProfile_userId_key" ON "FiscalEmitterProfile"("userId");
CREATE UNIQUE INDEX "FiscalEmitterProfile_cnpj_key"   ON "FiscalEmitterProfile"("cnpj");
CREATE INDEX        "FiscalEmitterProfile_cnpj_idx"   ON "FiscalEmitterProfile"("cnpj");

ALTER TABLE "FiscalEmitterProfile"
  ADD CONSTRAINT "FiscalEmitterProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CNPJ sem máscara, 14 dígitos: é o que vai em prest/CNPJ e o que precisa bater
-- com o CNPJ de dentro do certificado A1 (senão a SEFIN rejeita com E1209).
ALTER TABLE "FiscalEmitterProfile"
  ADD CONSTRAINT "FiscalEmitterProfile_cnpj_format" CHECK ("cnpj" ~ '^[0-9]{14}$');

ALTER TABLE "FiscalEmitterProfile"
  ADD CONSTRAINT "FiscalEmitterProfile_municipalityIbgeCode_format"
  CHECK ("municipalityIbgeCode" ~ '^[0-9]{7}$');

-- TSCodTribNac é exatamente 6 dígitos numéricos.
ALTER TABLE "FiscalEmitterProfile"
  ADD CONSTRAINT "FiscalEmitterProfile_cTribNac_format" CHECK ("cTribNac" ~ '^[0-9]{6}$');

-- TSSerie aceita até 5 dígitos. A faixa 80000-89999 é reservada pela SEFIN à
-- transcrição manual de número/série e não pode ser usada em emissão normal.
ALTER TABLE "FiscalEmitterProfile"
  ADD CONSTRAINT "FiscalEmitterProfile_serie_format"
  CHECK ("serie" ~ '^[0-9]{1,5}$' AND ("serie")::integer NOT BETWEEN 80000 AND 89999);

ALTER TABLE "FiscalEmitterProfile"
  ADD CONSTRAINT "FiscalEmitterProfile_environment_range" CHECK ("environment" IN (1, 2));

ALTER TABLE "FiscalEmitterProfile"
  ADD CONSTRAINT "FiscalEmitterProfile_opSimpNac_range" CHECK ("opSimpNac" IN (1, 2, 3));

-- ─────────────────────────────────────────────────────────────────────────────
-- Certificado A1 cifrado.
--
-- Deliberadamente NÃO é um File: GET /files/serve/:id serve qualquer arquivo por
-- id com Access-Control-Allow-Origin *, então uma chave privada modelada como
-- File seria baixável por quem adivinhasse o uuid.
--
-- Envelope: DEK aleatória por certificado (AES-256-GCM) cifra o PFX e a senha
-- separadamente; a DEK é embrulhada por uma KEK derivada de FISCAL_CERT_KEK.
-- "kekVersion" permite rotacionar a KEK re-embrulhando só as DEKs.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "FiscalCertificate" (
  "id"                 TEXT         NOT NULL,
  "profileId"          TEXT         NOT NULL,
  -- Lido de DENTRO do certificado (SAN otherName OID 2.16.76.1.3.3), com
  -- fallback para a convenção ICP-Brasil de CN "RAZAO SOCIAL:CNPJ".
  "holderDocument"     TEXT         NOT NULL,
  "subjectCommonName"  TEXT         NOT NULL,
  "issuer"             TEXT         NOT NULL,
  "serialNumber"       TEXT         NOT NULL,
  "notBefore"          TIMESTAMP(3) NOT NULL,
  "notAfter"           TIMESTAMP(3) NOT NULL,
  "fingerprint"        TEXT         NOT NULL,
  "kekVersion"         INTEGER      NOT NULL DEFAULT 1,
  "wrappedDek"         TEXT         NOT NULL,
  "pfxCiphertext"      BYTEA        NOT NULL,
  "pfxIv"              TEXT         NOT NULL,
  "pfxAuthTag"         TEXT         NOT NULL,
  "passwordCiphertext" TEXT         NOT NULL,
  "passwordIv"         TEXT         NOT NULL,
  "passwordAuthTag"    TEXT         NOT NULL,
  "isActive"           BOOLEAN      NOT NULL DEFAULT true,
  "revokedAt"          TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FiscalCertificate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalCertificate_fingerprint_key" ON "FiscalCertificate"("fingerprint");
CREATE INDEX "FiscalCertificate_profileId_isActive_idx" ON "FiscalCertificate"("profileId", "isActive");
CREATE INDEX "FiscalCertificate_notAfter_idx" ON "FiscalCertificate"("notAfter");

-- Um único certificado ativo por perfil. Índice PARCIAL: o Prisma não sabe
-- declarar isso, então vive só aqui — sem ele, dois uploads concorrentes deixam
-- dois certificados ativos e a escolha de qual assina vira sorteio.
CREATE UNIQUE INDEX "FiscalCertificate_one_active_per_profile"
  ON "FiscalCertificate"("profileId") WHERE "isActive";

ALTER TABLE "FiscalCertificate"
  ADD CONSTRAINT "FiscalCertificate_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "FiscalEmitterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sequência de nDPS por (emitente, série).
--
-- O layout exige nDPS crescente e o idDps (município+inscrição+série+nDPS) é a
-- chave de deduplicação da SEFIN. Por isso o contador é durável e incrementado
-- transacionalmente — derivar de count() reaproveitaria número após um cancelamento.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "FiscalDpsSequence" (
  "id"         TEXT         NOT NULL,
  "profileId"  TEXT         NOT NULL,
  "serie"      TEXT         NOT NULL,
  "lastNumber" BIGINT       NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FiscalDpsSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalDpsSequence_profileId_serie_key" ON "FiscalDpsSequence"("profileId", "serie");

ALTER TABLE "FiscalDpsSequence"
  ADD CONSTRAINT "FiscalDpsSequence_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "FiscalEmitterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- nDPS válido é [1-9][0-9]{0,14} — 0 só existe como estado inicial do contador.
ALTER TABLE "FiscalDpsSequence"
  ADD CONSTRAINT "FiscalDpsSequence_lastNumber_range"
  CHECK ("lastNumber" >= 0 AND "lastNumber" <= 999999999999999);

-- ─────────────────────────────────────────────────────────────────────────────
-- A nota em si.
--
-- "airbrushingId" é UNIQUE de propósito: esta linha É a trava de idempotência.
-- Sete caminhos levam uma aerografia a COMPLETED (update, batchUpdate, create,
-- batchCreate, dois writes crus dentro de TaskService, e a reabertura
-- COMPLETED→IN_PRODUCTION→COMPLETED) e nenhum pode gerar uma segunda nota.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "AirbrushingNfse" (
  "id"               TEXT         NOT NULL,
  "airbrushingId"    TEXT         NOT NULL,
  -- Nulo quando o pintor ainda não tem perfil fiscal: a intenção é registrada
  -- mesmo assim, em ERROR, para a falha ficar visível em vez de silenciosa.
  "profileId"        TEXT,
  "painterId"        TEXT,
  "certificateId"    TEXT,
  "status"           "NfseStatus" NOT NULL DEFAULT 'PENDING',
  "environment"      INTEGER      NOT NULL DEFAULT 2,
  -- "DPS" + 42 dígitos (cLocEmi 7 + tpInscr 1 + inscrição 14 + série 5 + nDPS 15).
  "dpsId"            TEXT,
  "serie"            TEXT,
  "nDps"             BIGINT,
  -- chaveAcesso tem exatamente 50 dígitos.
  "accessKey"        TEXT,
  "nfseNumber"       TEXT,
  "issuedAt"         TIMESTAMP(3),
  "competence"       TIMESTAMP(3),
  "serviceAmount"    DECIMAL(15,2),
  -- dpsXml é o que foi assinado e transmitido BYTE A BYTE: reserializar invalida
  -- a assinatura, então é o único registro fiel do que a SEFIN validou.
  "dpsXml"           TEXT,
  "nfseXml"          TEXT,
  "alerts"           JSONB,
  "errorMessage"     TEXT,
  "errorCode"        TEXT,
  "errorCount"       INTEGER      NOT NULL DEFAULT 0,
  "retryAfter"       TIMESTAMP(3),
  "lastAttemptAt"    TIMESTAMP(3),
  "cancelledAt"      TIMESTAMP(3),
  "cancelReasonCode" INTEGER,
  "cancelReason"     TEXT,
  "cancelEventXml"   TEXT,
  "pdfFileId"        TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AirbrushingNfse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AirbrushingNfse_airbrushingId_key" ON "AirbrushingNfse"("airbrushingId");
CREATE UNIQUE INDEX "AirbrushingNfse_dpsId_key"         ON "AirbrushingNfse"("dpsId");
CREATE UNIQUE INDEX "AirbrushingNfse_accessKey_key"     ON "AirbrushingNfse"("accessKey");
CREATE INDEX "AirbrushingNfse_status_retryAfter_idx"    ON "AirbrushingNfse"("status", "retryAfter");
CREATE INDEX "AirbrushingNfse_profileId_idx"            ON "AirbrushingNfse"("profileId");
CREATE INDEX "AirbrushingNfse_painterId_idx"            ON "AirbrushingNfse"("painterId");

ALTER TABLE "AirbrushingNfse"
  ADD CONSTRAINT "AirbrushingNfse_airbrushingId_fkey"
  FOREIGN KEY ("airbrushingId") REFERENCES "Airbrushing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull e não Cascade: a nota é documento fiscal e sobrevive ao sumiço do
-- perfil, do pintor ou do certificado. Só a aerografia (acima) a cascateia.
ALTER TABLE "AirbrushingNfse"
  ADD CONSTRAINT "AirbrushingNfse_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "FiscalEmitterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AirbrushingNfse"
  ADD CONSTRAINT "AirbrushingNfse_painterId_fkey"
  FOREIGN KEY ("painterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AirbrushingNfse"
  ADD CONSTRAINT "AirbrushingNfse_certificateId_fkey"
  FOREIGN KEY ("certificateId") REFERENCES "FiscalCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AirbrushingNfse"
  ADD CONSTRAINT "AirbrushingNfse_pdfFileId_fkey"
  FOREIGN KEY ("pdfFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AirbrushingNfse"
  ADD CONSTRAINT "AirbrushingNfse_environment_range" CHECK ("environment" IN (1, 2));

ALTER TABLE "AirbrushingNfse"
  ADD CONSTRAINT "AirbrushingNfse_accessKey_format"
  CHECK ("accessKey" IS NULL OR "accessKey" ~ '^[0-9]{50}$');

ALTER TABLE "AirbrushingNfse"
  ADD CONSTRAINT "AirbrushingNfse_dpsId_format"
  CHECK ("dpsId" IS NULL OR "dpsId" ~ '^DPS[0-9]{42}$');

-- Motivos de cancelamento do evento e101101: 1=Erro na emissão, 2=Serviço não
-- prestado, 9=Outros.
ALTER TABLE "AirbrushingNfse"
  ADD CONSTRAINT "AirbrushingNfse_cancelReasonCode_range"
  CHECK ("cancelReasonCode" IS NULL OR "cancelReasonCode" IN (1, 2, 9));
