-- =============================================================================
-- Assinatura eletrônica do Orçamento — envelope, signatários, desafio OTP e
-- trilha de auditoria append-only.
--
-- HAND-WRITTEN. Os blocos DDL do Prisma abaixo foram EXTRAÍDOS de
-- `prisma migrate diff` e o restante do diff foi DESCARTADO de propósito: o
-- diff bruto também continha 96 ALTER TABLE das colunas geradas
-- (*Normalized), 16 DROP INDEX de índices trigram e 1 DROP CONSTRAINT — todos
-- objetos feitos à mão que o schema Prisma não representa. Aplicá-los
-- destruiria a busca acento-insensível do sistema inteiro.
--
-- NUNCA regenere este arquivo com `prisma migrate dev`.
-- =============================================================================

-- CreateEnum
CREATE TYPE "EnvelopeStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'REFUSED', 'EXPIRED', 'CANCELLED', 'INVALIDATED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "EnvelopeSignerStatus" AS ENUM ('PENDING', 'VIEWED', 'AUTHENTICATED', 'SIGNED', 'REFUSED', 'EXPIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "SignatureAuthMethod" AS ENUM ('WHATSAPP_OTP', 'SMS_OTP', 'INTERNAL_SESSION');

-- CreateEnum
CREATE TYPE "SigningChallengeStatus" AS ENUM ('PENDING', 'CONSUMED', 'LOCKED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "SignatureEventType" AS ENUM ('ENVELOPE_CREATED', 'DOCUMENT_FROZEN', 'INVITATION_SENT', 'INVITATION_FAILED', 'DOCUMENT_VIEWED', 'DOCUMENT_SCROLLED_END', 'CPF_SUBMITTED', 'CPF_MISMATCH', 'OTP_SENT', 'OTP_DELIVERY_FAILED', 'OTP_VERIFIED', 'OTP_FAILED', 'OTP_LOCKED', 'DECLARATIONS_ACCEPTED', 'SIGNATURE_APPLIED', 'SIGNATURE_REFUSED', 'SIGNER_VOIDED', 'CONTACT_CHANGED', 'ENVELOPE_INVALIDATED', 'ENVELOPE_EXPIRED', 'ENVELOPE_CANCELLED', 'DOCUMENT_ASSEMBLED', 'PADES_SEALED', 'PADES_FAILED', 'TSA_STAMPED', 'TSA_FAILED', 'DOCUMENT_FINALIZED', 'DOCUMENT_DOWNLOADED', 'VERIFICATION_VIEWED');

-- AlterTable
ALTER TABLE "TaskQuote" ADD COLUMN     "commercialUserId" TEXT;

-- CreateTable
CREATE TABLE "SignatureEnvelope" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "status" "EnvelopeStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousEnvelopeId" TEXT,
    "sequential" BOOLEAN NOT NULL DEFAULT true,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "originalFileId" TEXT NOT NULL,
    "originalSha256" TEXT NOT NULL,
    "anchors" JSONB NOT NULL,
    "quoteSnapshot" JSONB NOT NULL,
    "quoteSnapshotSha256" TEXT NOT NULL,
    "finalFileId" TEXT,
    "finalSha256" TEXT,
    "sealedAt" TIMESTAMP(3),
    "padesLevel" TEXT,
    "certSubject" TEXT,
    "certIssuer" TEXT,
    "certSerialNumber" TEXT,
    "certCnpj" TEXT,
    "certNotAfter" TIMESTAMP(3),
    "tsaUrl" TEXT,
    "tsaGenTime" TIMESTAMP(3),
    "verificationCode" TEXT NOT NULL,
    "legalBasis" TEXT NOT NULL DEFAULT 'MP 2.200-2/2001, art. 10, §2º',
    "acceptanceClause" TEXT NOT NULL,
    "invalidatedReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SignatureEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvelopeSigner" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "responsibleId" TEXT,
    "userId" TEXT,
    "orderGroup" INTEGER NOT NULL DEFAULT 0,
    "declaredName" TEXT NOT NULL,
    "declaredPhone" TEXT NOT NULL,
    "declaredCpf" TEXT,
    "declaredEmail" TEXT,
    "phoneSource" TEXT NOT NULL DEFAULT 'customer_registry',
    "informedCpf" TEXT,
    "informedCargo" TEXT,
    "cpfMatch" BOOLEAN,
    "cpfRfbStatus" TEXT,
    "qsaMatch" BOOLEAN,
    "status" "EnvelopeSignerStatus" NOT NULL DEFAULT 'PENDING',
    "authMethod" "SignatureAuthMethod" NOT NULL DEFAULT 'WHATSAPP_OTP',
    "accessToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "firstViewedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "timesViewed" INTEGER NOT NULL DEFAULT 0,
    "maxPageReached" INTEGER,
    "signedAt" TIMESTAMP(3),
    "clientSignedAt" TIMESTAMP(3),
    "refusedAt" TIMESTAMP(3),
    "refusalReason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "geoLat" DECIMAL(9,6),
    "geoLon" DECIMAL(9,6),
    "geoAccuracyM" INTEGER,
    "geoSource" TEXT,
    "declarations" JSONB,
    "evidenceJson" JSONB,
    "evidenceHash" TEXT,
    "hmacSignature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvelopeSigner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningChallenge" (
    "id" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destinationMask" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "status" "SigningChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "providerMessageId" TEXT,
    "providerStatus" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SigningChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureAuditEvent" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "eventType" "SignatureEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "documentHash" TEXT,
    "payload" JSONB,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "SignatureAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignatureEnvelope_previousEnvelopeId_key" ON "SignatureEnvelope"("previousEnvelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureEnvelope_verificationCode_key" ON "SignatureEnvelope"("verificationCode");

-- CreateIndex
CREATE INDEX "SignatureEnvelope_quoteId_idx" ON "SignatureEnvelope"("quoteId");

-- CreateIndex
CREATE INDEX "SignatureEnvelope_status_idx" ON "SignatureEnvelope"("status");

-- CreateIndex
CREATE INDEX "SignatureEnvelope_deadlineAt_idx" ON "SignatureEnvelope"("deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "EnvelopeSigner_accessToken_key" ON "EnvelopeSigner"("accessToken");

-- CreateIndex
CREATE INDEX "EnvelopeSigner_envelopeId_idx" ON "EnvelopeSigner"("envelopeId");

-- CreateIndex
CREATE INDEX "EnvelopeSigner_accessToken_idx" ON "EnvelopeSigner"("accessToken");

-- CreateIndex
CREATE INDEX "EnvelopeSigner_status_idx" ON "EnvelopeSigner"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EnvelopeSigner_envelopeId_responsibleId_key" ON "EnvelopeSigner"("envelopeId", "responsibleId");

-- CreateIndex
CREATE UNIQUE INDEX "EnvelopeSigner_envelopeId_userId_key" ON "EnvelopeSigner"("envelopeId", "userId");

-- CreateIndex
CREATE INDEX "SigningChallenge_signerId_status_idx" ON "SigningChallenge"("signerId", "status");

-- CreateIndex
CREATE INDEX "SigningChallenge_expiresAt_idx" ON "SigningChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureAuditEvent_hash_key" ON "SignatureAuditEvent"("hash");

-- CreateIndex
CREATE INDEX "SignatureAuditEvent_envelopeId_sequence_idx" ON "SignatureAuditEvent"("envelopeId", "sequence");

-- CreateIndex
CREATE INDEX "SignatureAuditEvent_occurredAt_idx" ON "SignatureAuditEvent"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureAuditEvent_envelopeId_sequence_key" ON "SignatureAuditEvent"("envelopeId", "sequence");

-- CreateIndex
CREATE INDEX "TaskQuote_commercialUserId_idx" ON "TaskQuote"("commercialUserId");

-- AddForeignKey
ALTER TABLE "TaskQuote" ADD CONSTRAINT "TaskQuote_commercialUserId_fkey" FOREIGN KEY ("commercialUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEnvelope" ADD CONSTRAINT "SignatureEnvelope_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "TaskQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEnvelope" ADD CONSTRAINT "SignatureEnvelope_originalFileId_fkey" FOREIGN KEY ("originalFileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEnvelope" ADD CONSTRAINT "SignatureEnvelope_finalFileId_fkey" FOREIGN KEY ("finalFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEnvelope" ADD CONSTRAINT "SignatureEnvelope_previousEnvelopeId_fkey" FOREIGN KEY ("previousEnvelopeId") REFERENCES "SignatureEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeSigner" ADD CONSTRAINT "EnvelopeSigner_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "SignatureEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeSigner" ADD CONSTRAINT "EnvelopeSigner_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "Representative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvelopeSigner" ADD CONSTRAINT "EnvelopeSigner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningChallenge" ADD CONSTRAINT "SigningChallenge_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "EnvelopeSigner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureAuditEvent" ADD CONSTRAINT "SignatureAuditEvent_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "SignatureEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- INTEGRIDADE DE DOMÍNIO
-- =============================================================================

-- Um signatário é OU um contato do cliente OU um usuário Ankaa, nunca ambos,
-- nunca nenhum. O código depende disso para decidir qual cerimônia aplicar.
ALTER TABLE "EnvelopeSigner"
  ADD CONSTRAINT "EnvelopeSigner_exactly_one_identity"
  CHECK (("responsibleId" IS NULL) <> ("userId" IS NULL));

ALTER TABLE "SignatureAuditEvent"
  ADD CONSTRAINT "SignatureAuditEvent_sequence_non_negative"
  CHECK ("sequence" >= 0);

ALTER TABLE "SigningChallenge"
  ADD CONSTRAINT "SigningChallenge_attempts_within_bounds"
  CHECK ("attempts" >= 0 AND "attempts" <= "maxAttempts");

-- =============================================================================
-- TRILHA DE AUDITORIA APPEND-ONLY
-- -----------------------------------------------------------------------------
-- UPDATE é bloqueado incondicionalmente: é o vetor de adulteração que importa
-- (editar UM evento para mudar a narrativa preservando o resto).
--
-- DELETE é bloqueado por padrão e só é liberado dentro de uma transação que
-- setou explicitamente `ankaa.allow_signature_audit_delete = 'on'`. Isso existe
-- para um único caso legítimo: apagar um orçamento cujo envelope nunca foi
-- assinado. O serviço que faz isso recusa a operação se qualquer signatário
-- estiver SIGNED ou o envelope estiver COMPLETED.
--
-- TETO HONESTO: um superusuário pode `ALTER TABLE ... DISABLE TRIGGER`. Nada
-- dentro do banco impede isso. O que torna a trilha crível é a CADEIA DE HASH
-- (torna adulteração demonstrável) somada à âncora externa. O trigger existe
-- para tornar a adulteração acidental impossível e a deliberada ruidosa.
-- =============================================================================

CREATE OR REPLACE FUNCTION signature_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    RAISE EXCEPTION
      'SignatureAuditEvent e append-only: UPDATE nao e permitido (evento %)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF (TG_OP = 'DELETE') THEN
    IF COALESCE(current_setting('ankaa.allow_signature_audit_delete', true), 'off') <> 'on' THEN
      RAISE EXCEPTION
        'SignatureAuditEvent e append-only: DELETE nao e permitido (evento %)', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "signature_audit_no_mutate" ON "SignatureAuditEvent";
CREATE TRIGGER "signature_audit_no_mutate"
  BEFORE UPDATE OR DELETE ON "SignatureAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION signature_audit_append_only();

-- Evidência assinada também não deve ser reescrita em silêncio: uma vez que um
-- signatário atingiu SIGNED, seu bloco probatório é imutável.
CREATE OR REPLACE FUNCTION envelope_signer_freeze_signed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'SIGNED' AND NEW."status" = 'SIGNED' THEN
    IF NEW."signedAt"      IS DISTINCT FROM OLD."signedAt"
    OR NEW."evidenceHash"  IS DISTINCT FROM OLD."evidenceHash"
    OR NEW."hmacSignature" IS DISTINCT FROM OLD."hmacSignature"
    OR NEW."informedCpf"   IS DISTINCT FROM OLD."informedCpf"
    OR NEW."declarations"::text IS DISTINCT FROM OLD."declarations"::text THEN
      RAISE EXCEPTION
        'Assinatura ja aplicada e imutavel (signatario %). Invalide o envelope e reemita.', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "envelope_signer_freeze_signed" ON "EnvelopeSigner";
CREATE TRIGGER "envelope_signer_freeze_signed"
  BEFORE UPDATE ON "EnvelopeSigner"
  FOR EACH ROW EXECUTE FUNCTION envelope_signer_freeze_signed();
