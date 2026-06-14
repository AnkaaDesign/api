-- ============================================================================
-- ANDRESSA PIPELINE FOLLOW-UP: employee-anchored loans + in-app LGPD signing
-- ============================================================================
-- Hand-written (the `prisma migrate dev` shadow DB is broken by an older
-- migration). Scope is intentionally minimal and additive — it ONLY:
--   1) Makes PayrollDiscount.payrollId nullable + adds userId / startCompetence
--      so a loan (empréstimo) can be registered once per EMPLOYEE (master
--      discount, no payroll required) and auto-applied to future folhas.
--   2) Adds nullable in-app electronic-signature evidence columns to
--      AdmissionDocument so the LGPD_TERM document can be signed in the mobile
--      app, reusing the existing PPE signature pipeline (PAdES + audit).
-- It does NOT touch the Gratification table (already dropped by
-- 20260613130000_remove_gratification) and does NOT drop/recreate anything.
-- All statements are idempotent (IF [NOT] EXISTS) so they are safe to re-run.

-- ----------------------------------------------------------------------------
-- TASK 2 — Employee-anchored loan / master persistent discount
-- ----------------------------------------------------------------------------
ALTER TABLE "PayrollDiscount" ALTER COLUMN "payrollId" DROP NOT NULL;
ALTER TABLE "PayrollDiscount" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "PayrollDiscount" ADD COLUMN IF NOT EXISTS "startCompetence" TEXT;

CREATE INDEX IF NOT EXISTS "PayrollDiscount_userId_idx" ON "PayrollDiscount"("userId");

DO $$ BEGIN
  ALTER TABLE "PayrollDiscount"
    ADD CONSTRAINT "PayrollDiscount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- TASK 3 — In-app electronic signature for admission documents (LGPD_TERM)
-- ----------------------------------------------------------------------------
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "signedFileId" TEXT;
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "signedByUserId" TEXT;
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "signedAt" TIMESTAMP(3);
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "signatureEvidence" JSONB;
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "evidenceHash" TEXT;
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "hmacSignature" TEXT;
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "documentSha256" TEXT;
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "padesSealed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "padesSealedAt" TIMESTAMP(3);
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "certSubject" TEXT;
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "certIssuer" TEXT;
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "certSerialNumber" TEXT;
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "certCnpj" TEXT;
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "certNotAfter" TIMESTAMP(3);
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "legalBasis" TEXT;
ALTER TABLE "AdmissionDocument" ADD COLUMN IF NOT EXISTS "consentGiven" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "AdmissionDocument_signedFileId_idx" ON "AdmissionDocument"("signedFileId");
CREATE INDEX IF NOT EXISTS "AdmissionDocument_signedByUserId_idx" ON "AdmissionDocument"("signedByUserId");

DO $$ BEGIN
  ALTER TABLE "AdmissionDocument"
    ADD CONSTRAINT "AdmissionDocument_signedFileId_fkey"
    FOREIGN KEY ("signedFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AdmissionDocument"
    ADD CONSTRAINT "AdmissionDocument_signedByUserId_fkey"
    FOREIGN KEY ("signedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
