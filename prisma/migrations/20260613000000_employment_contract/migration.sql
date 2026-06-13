-- EmploymentContract (vínculo) redesign.
--
-- Splits the overloaded `ContractKind` enum into three orthogonal concepts and moves the
-- employment relationship off `User` onto a first-class `EmploymentContract` (vínculo), so a
-- person can hold many bonds over time (readmissão / CLT→terceirizado). `User` keeps identity
-- + cross-domain pointers (position/sector/payrollNumber) and a synced cache of the CURRENT
-- contract. See ACCOUNTING_AREA / plan: linear-stirring-panda.
--
-- Applied LOCALLY via `prisma migrate deploy`. Prod: see RUNBOOK-PROD-employment-contract.md.
-- NEVER `prisma db push` / `migrate reset` (memory rule).

-- =====================================================================================
-- 1. New enums
-- =====================================================================================
CREATE TYPE "ContractType" AS ENUM (
  'EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2', 'EFFECTED', 'FIXED_TERM', 'INTERMITTENT', 'APPRENTICE', 'TEMPORARY'
);
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'DISMISSED');
CREATE TYPE "EmployeeType" AS ENUM ('CLT', 'INTERN', 'TERCEIRIZADO', 'PJ', 'AUTONOMOUS');

-- =====================================================================================
-- 2. EmploymentContract table
-- =====================================================================================
CREATE TABLE "EmploymentContract" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "sequence"        INTEGER NOT NULL,
  "matricula"       INTEGER,
  "payrollNumber"   INTEGER,
  "employeeType"    "EmployeeType" NOT NULL DEFAULT 'CLT',
  "contractType"    "ContractType",
  "status"          "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
  "statusOrder"     INTEGER NOT NULL DEFAULT 1,
  "positionId"      TEXT,
  "sectorId"        TEXT,
  "admissionDate"   TIMESTAMP(3),
  "exp1StartAt"     TIMESTAMP(3),
  "exp1EndAt"       TIMESTAMP(3),
  "exp2StartAt"     TIMESTAMP(3),
  "exp2EndAt"       TIMESTAMP(3),
  "effectedAt"      TIMESTAMP(3),
  "terminationDate" TIMESTAMP(3),
  "terminationType" "TerminationType",
  "providerName"    TEXT,
  "providerCnpj"    TEXT,
  "notes"           TEXT,
  "isCurrent"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmploymentContract_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmploymentContract_userId_sequence_key" ON "EmploymentContract"("userId", "sequence");
CREATE INDEX "EmploymentContract_userId_idx" ON "EmploymentContract"("userId");
CREATE INDEX "EmploymentContract_userId_isCurrent_idx" ON "EmploymentContract"("userId", "isCurrent");
CREATE INDEX "EmploymentContract_status_idx" ON "EmploymentContract"("status");
CREATE INDEX "EmploymentContract_employeeType_idx" ON "EmploymentContract"("employeeType");
CREATE INDEX "EmploymentContract_positionId_idx" ON "EmploymentContract"("positionId");
CREATE INDEX "EmploymentContract_sectorId_idx" ON "EmploymentContract"("sectorId");

ALTER TABLE "EmploymentContract" ADD CONSTRAINT "EmploymentContract_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmploymentContract" ADD CONSTRAINT "EmploymentContract_positionId_fkey"
  FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmploymentContract" ADD CONSTRAINT "EmploymentContract_sectorId_fkey"
  FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================================
-- 3. New FK columns on Admission / Termination / Payroll + User current-cache columns
-- =====================================================================================
-- Admission: one onboarding per vínculo. Drop the old one-admission-per-user unique.
DROP INDEX "Admission_userId_key";
ALTER TABLE "Admission" ADD COLUMN "contractId" TEXT;
CREATE UNIQUE INDEX "Admission_contractId_key" ON "Admission"("contractId");
CREATE INDEX "Admission_userId_idx" ON "Admission"("userId");
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "EmploymentContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Termination" ADD COLUMN "contractId" TEXT;
CREATE INDEX "Termination_contractId_idx" ON "Termination"("contractId");
ALTER TABLE "Termination" ADD CONSTRAINT "Termination_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "EmploymentContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payroll" ADD COLUMN "contractId" TEXT;
CREATE INDEX "Payroll_contractId_idx" ON "Payroll"("contractId");
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "EmploymentContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "currentContractId" TEXT;
ALTER TABLE "User" ADD COLUMN "currentContractType" "ContractType";
ALTER TABLE "User" ADD COLUMN "currentContractStatus" "ContractStatus" DEFAULT 'ACTIVE';
ALTER TABLE "User" ADD COLUMN "currentEmployeeType" "EmployeeType" DEFAULT 'CLT';

-- =====================================================================================
-- 4. Backfill — one contract (sequence 1) per existing user from the old User columns
-- =====================================================================================
INSERT INTO "EmploymentContract" (
  "id", "userId", "sequence", "matricula", "payrollNumber", "employeeType", "contractType",
  "status", "statusOrder", "positionId", "sectorId", "admissionDate",
  "exp1StartAt", "exp1EndAt", "exp2StartAt", "exp2EndAt", "effectedAt", "terminationDate",
  "isCurrent", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  u."id",
  1,
  u."payrollNumber",
  u."payrollNumber",
  'CLT'::"EmployeeType",
  CASE
    WHEN u."contractKind" = 'DISMISSED' THEN
      (CASE WHEN u."effectedAt" IS NOT NULL THEN 'EFFECTED' ELSE 'EXPERIENCE_PERIOD_1' END)::"ContractType"
    ELSE u."contractKind"::text::"ContractType"
  END,
  CASE WHEN u."dismissedAt" IS NOT NULL OR u."contractKind" = 'DISMISSED'
       THEN 'DISMISSED'::"ContractStatus" ELSE 'ACTIVE'::"ContractStatus" END,
  CASE WHEN u."dismissedAt" IS NOT NULL OR u."contractKind" = 'DISMISSED' THEN 2 ELSE 1 END,
  u."positionId",
  u."sectorId",
  COALESCE(u."exp1StartAt", u."effectedAt", u."createdAt"),
  u."exp1StartAt", u."exp1EndAt", u."exp2StartAt", u."exp2EndAt", u."effectedAt",
  u."dismissedAt",
  true,
  u."createdAt",
  CURRENT_TIMESTAMP
FROM "User" u;

-- Point each user at its (only) contract and mirror the current-state cache.
UPDATE "User" u SET
  "currentContractId"     = ec."id",
  "currentContractType"   = ec."contractType",
  "currentContractStatus" = ec."status",
  "currentEmployeeType"   = ec."employeeType"
FROM "EmploymentContract" ec
WHERE ec."userId" = u."id" AND ec."sequence" = 1;

-- Link any pre-existing Admission rows to the seq-1 contract.
UPDATE "Admission" a SET "contractId" = ec."id"
FROM "EmploymentContract" ec
WHERE ec."userId" = a."userId" AND ec."sequence" = 1 AND a."contractId" IS NULL;

-- =====================================================================================
-- 5. Special multi-vínculo cases (confirmed from live data)
-- =====================================================================================
-- Kennedy Campos: CLT 2019-11-28 → dismissed 2024-03-28 (seq 1, kept as-is), then re-engaged
-- as TERCEIRIZADO (seq 2, active, off-folha). The current vínculo flips to the terceirizado one.
UPDATE "EmploymentContract"
  SET "isCurrent" = false
  WHERE "userId" = '41fcb3fe-e1b6-43e9-bd72-41c072154100' AND "sequence" = 1;

INSERT INTO "EmploymentContract" (
  "id", "userId", "sequence", "employeeType", "contractType", "status", "statusOrder",
  "positionId", "sectorId", "admissionDate", "isCurrent", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  '41fcb3fe-e1b6-43e9-bd72-41c072154100',
  2,
  'TERCEIRIZADO'::"EmployeeType",
  NULL,
  'ACTIVE'::"ContractStatus",
  1,
  u."positionId",
  u."sectorId",
  TIMESTAMP '2024-04-01 03:00:00',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u WHERE u."id" = '41fcb3fe-e1b6-43e9-bd72-41c072154100';

UPDATE "User" u SET
  "currentContractId"     = ec."id",
  "currentContractType"   = NULL,
  "currentContractStatus" = 'ACTIVE'::"ContractStatus",
  "currentEmployeeType"   = 'TERCEIRIZADO'::"EmployeeType",
  "isActive"              = true
FROM "EmploymentContract" ec
WHERE ec."userId" = u."id" AND ec."sequence" = 2
  AND u."id" = '41fcb3fe-e1b6-43e9-bd72-41c072154100';

-- =====================================================================================
-- 6. Data-quality repair: dismissed users must not be flagged active.
--    (10 DISMISSED rows still had isActive=true. Kennedy already flipped to ACTIVE above.)
--    NOTE: not repaired here (no reliable source), only reported for follow-up:
--      - Pedro Antônio de Oliveira: effectedAt = 1922-06-01 (bogus)
--      - Flavio Rodrigues: exp1StartAt = 1970-01-01 (epoch placeholder)
-- =====================================================================================
UPDATE "User" SET "isActive" = false WHERE "currentContractStatus" = 'DISMISSED' AND "isActive" = true;

-- =====================================================================================
-- 7. Drop the now-migrated columns, their indexes, and the old enum.
-- =====================================================================================
DROP INDEX "User_contractKind_sectorId_idx";
DROP INDEX "User_contractKindOrder_idx";
DROP INDEX "User_exp1StartAt_idx";
DROP INDEX "User_exp1EndAt_idx";
DROP INDEX "User_exp2StartAt_idx";
DROP INDEX "User_exp2EndAt_idx";
DROP INDEX "User_effectedAt_idx";
DROP INDEX "User_dismissedAt_idx";

ALTER TABLE "User" DROP COLUMN "contractKind";
ALTER TABLE "User" DROP COLUMN "contractKindOrder";
ALTER TABLE "User" DROP COLUMN "effectedAt";
ALTER TABLE "User" DROP COLUMN "exp1StartAt";
ALTER TABLE "User" DROP COLUMN "exp1EndAt";
ALTER TABLE "User" DROP COLUMN "exp2StartAt";
ALTER TABLE "User" DROP COLUMN "exp2EndAt";
ALTER TABLE "User" DROP COLUMN "dismissedAt";

DROP TYPE "ContractKind";

-- New current-cache indexes on User (match schema.prisma).
CREATE INDEX "User_currentContractStatus_sectorId_idx" ON "User"("currentContractStatus", "sectorId");
CREATE INDEX "User_currentContractType_idx" ON "User"("currentContractType");
CREATE INDEX "User_currentEmployeeType_idx" ON "User"("currentEmployeeType");
CREATE UNIQUE INDEX "User_currentContractId_key" ON "User"("currentContractId");
ALTER TABLE "User" ADD CONSTRAINT "User_currentContractId_fkey"
  FOREIGN KEY ("currentContractId") REFERENCES "EmploymentContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
