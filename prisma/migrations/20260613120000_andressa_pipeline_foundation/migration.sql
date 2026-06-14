-- ============================================================================
-- Área Andressa — Phase 1 Foundation migration (2026-06-13)
-- ============================================================================
-- HAND-WRITTEN (prisma migrate diff produced unrelated DB drift — sequences,
-- correction_log, index renames, FK drops — which are intentionally EXCLUDED).
-- This migration contains ONLY the Andressa-pipeline schema changes plus the
-- ContractType/ContractStatus enum redesign + data backfill.
--
-- Enum backfill mapping (Part A):
--   ContractType:  EXPERIENCE_PERIOD_1/2 -> FIXED_TERM ; EFFECTED -> INDETERMINATE
--   ContractStatus: EXPERIENCE_PERIOD_1/2 rows -> EXPERIENCE ; EFFECTED rows -> ACTIVE
--                   DISMISSED -> TERMINATED ; ACTIVE -> ACTIVE
-- The status backfill must read the OLD contractType to decide EXPERIENCE, so we
-- convert ContractType FIRST is NOT possible (we lose the EXPERIENCE_PERIOD_* signal).
-- Therefore we convert ContractStatus using BOTH old status and old contractType.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- New enums (additive types)
-- ----------------------------------------------------------------------------
CREATE TYPE "InsalubrityDegree" AS ENUM ('NONE', 'MIN', 'MED', 'MAX');
CREATE TYPE "StabilityType" AS ENUM ('ACCIDENT', 'PREGNANCY', 'UNION', 'CIPA', 'OTHER');
CREATE TYPE "InssBenefitSpecies" AS ENUM ('B31', 'B91', 'B32', 'B92', 'B80', 'B36', 'OTHER');
CREATE TYPE "VacationStatus" AS ENUM ('OPEN', 'SCHEDULED', 'IN_PROGRESS', 'PAID', 'EXPIRED');
CREATE TYPE "ThirteenthStatus" AS ENUM ('OPEN', 'FIRST_PAID', 'SECOND_PAID', 'PAID', 'CANCELLED');
CREATE TYPE "WorkAccidentReportType" AS ENUM ('INITIAL', 'REOPENING', 'DEATH');

-- ----------------------------------------------------------------------------
-- ContractStatus redesign (ACTIVE, DISMISSED) -> (EXPERIENCE, ACTIVE, NOTICE_PERIOD, ON_LEAVE, TERMINATED)
-- Backfill: rows whose contractType is an EXPERIENCE_PERIOD_* become EXPERIENCE,
--           DISMISSED -> TERMINATED, everything else (ACTIVE) -> ACTIVE.
-- Done BEFORE ContractType conversion so the EXPERIENCE_PERIOD_* signal is still readable.
-- ----------------------------------------------------------------------------
BEGIN;
CREATE TYPE "ContractStatus_new" AS ENUM ('EXPERIENCE', 'ACTIVE', 'NOTICE_PERIOD', 'ON_LEAVE', 'TERMINATED');

ALTER TABLE "EmploymentContract" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "currentContractStatus" DROP DEFAULT;

ALTER TABLE "EmploymentContract"
  ALTER COLUMN "status" TYPE "ContractStatus_new"
  USING (
    CASE
      WHEN "status"::text = 'DISMISSED' THEN 'TERMINATED'
      WHEN "contractType"::text IN ('EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2') THEN 'EXPERIENCE'
      ELSE 'ACTIVE'
    END
  )::"ContractStatus_new";

ALTER TABLE "User"
  ALTER COLUMN "currentContractStatus" TYPE "ContractStatus_new"
  USING (
    CASE
      WHEN "currentContractStatus"::text = 'DISMISSED' THEN 'TERMINATED'
      WHEN "currentContractType"::text IN ('EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2') THEN 'EXPERIENCE'
      WHEN "currentContractStatus" IS NULL THEN NULL
      ELSE 'ACTIVE'
    END
  )::"ContractStatus_new";

ALTER TYPE "ContractStatus" RENAME TO "ContractStatus_old";
ALTER TYPE "ContractStatus_new" RENAME TO "ContractStatus";
DROP TYPE "ContractStatus_old";

ALTER TABLE "EmploymentContract" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "User" ALTER COLUMN "currentContractStatus" SET DEFAULT 'ACTIVE';
COMMIT;

-- ----------------------------------------------------------------------------
-- ContractType redesign (drop EXPERIENCE_PERIOD_1/2, EFFECTED; add INDETERMINATE)
-- Backfill: EXPERIENCE_PERIOD_1/2 -> FIXED_TERM ; EFFECTED -> INDETERMINATE.
-- ----------------------------------------------------------------------------
BEGIN;
CREATE TYPE "ContractType_new" AS ENUM ('INDETERMINATE', 'FIXED_TERM', 'INTERMITTENT', 'APPRENTICE', 'TEMPORARY');

ALTER TABLE "EmploymentContract"
  ALTER COLUMN "contractType" TYPE "ContractType_new"
  USING (
    CASE
      WHEN "contractType"::text = 'EFFECTED' THEN 'INDETERMINATE'
      WHEN "contractType"::text IN ('EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2') THEN 'FIXED_TERM'
      WHEN "contractType" IS NULL THEN NULL
      ELSE "contractType"::text
    END
  )::"ContractType_new";

ALTER TABLE "User"
  ALTER COLUMN "currentContractType" TYPE "ContractType_new"
  USING (
    CASE
      WHEN "currentContractType"::text = 'EFFECTED' THEN 'INDETERMINATE'
      WHEN "currentContractType"::text IN ('EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2') THEN 'FIXED_TERM'
      WHEN "currentContractType" IS NULL THEN NULL
      ELSE "currentContractType"::text
    END
  )::"ContractType_new";

ALTER TYPE "ContractType" RENAME TO "ContractType_old";
ALTER TYPE "ContractType_new" RENAME TO "ContractType";
DROP TYPE "ContractType_old";
COMMIT;

-- ----------------------------------------------------------------------------
-- Set experiencePhase from the now-erased EXPERIENCE_PERIOD_* signal would require
-- the old value; instead Part-A logic derives phase from exp1*/exp2* dates. The
-- explicit column is left NULL (derivation default).
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Additive enum values (existing enums)
-- ----------------------------------------------------------------------------
ALTER TYPE "MedicalExamResult" ADD VALUE 'FIT_WITH_RESTRICTIONS';

ALTER TYPE "PayrollDiscountType" ADD VALUE 'FAMILY_ALLOWANCE';
ALTER TYPE "PayrollDiscountType" ADD VALUE 'INSALUBRIDADE';
ALTER TYPE "PayrollDiscountType" ADD VALUE 'PERICULOSIDADE';
ALTER TYPE "PayrollDiscountType" ADD VALUE 'HABITUAL_GRATIFICATION';

ALTER TYPE "TerminationStatus" ADD VALUE 'HOMOLOGATION';

ALTER TYPE "TerminationType" ADD VALUE 'FIXED_TERM_EARLY_EMPLOYEE';
ALTER TYPE "TerminationType" ADD VALUE 'INTERMITTENT_END';

ALTER TYPE "TerminationDocumentType" ADD VALUE 'WARNING_LETTER';
ALTER TYPE "TerminationDocumentType" ADD VALUE 'TERM_484A';
ALTER TYPE "TerminationDocumentType" ADD VALUE 'HOMOLOGATION_TERM';

-- ----------------------------------------------------------------------------
-- AlterTable: additive columns on existing models
-- ----------------------------------------------------------------------------
ALTER TABLE "EmploymentContract"
  ADD COLUMN "insalubrityDegreeOverride" "InsalubrityDegree",
  ADD COLUMN "hazardPayOverride" BOOLEAN,
  ADD COLUMN "experiencePhase" INTEGER,
  ADD COLUMN "hasArt481Clause" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stabilityType" "StabilityType",
  ADD COLUMN "stabilityStart" TIMESTAMP(3),
  ADD COLUMN "stabilityEnd" TIMESTAMP(3);

ALTER TABLE "Position"
  ADD COLUMN "insalubrityDegree" "InsalubrityDegree" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "hazardPay" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "salaryFloor" DECIMAL(10,2),
  ADD COLUMN "examPeriodicityMonths" INTEGER;

ALTER TABLE "MonetaryValue"
  ADD COLUMN "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Backfill effectiveDate from createdAt so historical salary resolution is correct.
UPDATE "MonetaryValue" SET "effectiveDate" = "createdAt";

ALTER TABLE "MedicalExam"
  ADD COLUMN "restrictions" TEXT,
  ADD COLUMN "periodicityMonths" INTEGER;

ALTER TABLE "Leave"
  ADD COLUMN "inssBenefitSpecies" "InssBenefitSpecies";

ALTER TABLE "Item"
  ADD COLUMN "ppeCAIssueDate" TIMESTAMP(3),
  ADD COLUMN "ppeCAExpiry" TIMESTAMP(3);

ALTER TABLE "Warning"
  ADD COLUMN "suspensionDays" INTEGER,
  ADD COLUMN "terminationId" TEXT;

ALTER TABLE "Dependent"
  ADD COLUMN "healthPlanBenefitId" TEXT,
  ADD COLUMN "healthPlanValue" DECIMAL(10,2);

ALTER TABLE "UserBenefit"
  ADD COLUMN "totalInstallments" INTEGER,
  ADD COLUMN "currentInstallment" INTEGER;

-- ----------------------------------------------------------------------------
-- CreateTable: new models
-- ----------------------------------------------------------------------------
CREATE TABLE "Vacation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractId" TEXT,
    "acquisitiveStart" TIMESTAMP(3) NOT NULL,
    "acquisitiveEnd" TIMESTAMP(3) NOT NULL,
    "concessiveEnd" TIMESTAMP(3),
    "unjustifiedAbsencesInPeriod" INTEGER NOT NULL DEFAULT 0,
    "entitledDays" INTEGER NOT NULL DEFAULT 30,
    "status" "VacationStatus" NOT NULL DEFAULT 'OPEN',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "abonoPecuniarioDays" INTEGER NOT NULL DEFAULT 0,
    "soldThird" BOOLEAN NOT NULL DEFAULT false,
    "baseRemuneration" DECIMAL(10,2),
    "oneThird" DECIMAL(10,2),
    "abonoAmount" DECIMAL(10,2),
    "inss" DECIMAL(10,2),
    "irrf" DECIMAL(10,2),
    "isDouble" BOOLEAN NOT NULL DEFAULT false,
    "paymentDueDate" TIMESTAMP(3),
    "paymentDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vacation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VacationPeriod" (
    "id" TEXT NOT NULL,
    "vacationId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VacationPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Thirteenth" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractId" TEXT,
    "year" INTEGER NOT NULL,
    "avos" INTEGER NOT NULL DEFAULT 0,
    "baseRemuneration" DECIMAL(10,2),
    "firstInstallment" DECIMAL(10,2),
    "firstInstallmentDate" TIMESTAMP(3),
    "secondInstallment" DECIMAL(10,2),
    "secondInstallmentDate" TIMESTAMP(3),
    "inss" DECIMAL(10,2),
    "irrf" DECIMAL(10,2),
    "status" "ThirteenthStatus" NOT NULL DEFAULT 'OPEN',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Thirteenth_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Gratification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractId" TEXT,
    "reference" TEXT NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "isHabitual" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Gratification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkAccidentReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaveId" TEXT,
    "type" "WorkAccidentReportType" NOT NULL DEFAULT 'INITIAL',
    "catNumber" TEXT,
    "emissionDate" TIMESTAMP(3),
    "accidentDate" TIMESTAMP(3),
    "description" TEXT,
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkAccidentReport_pkey" PRIMARY KEY ("id")
);

-- ----------------------------------------------------------------------------
-- CreateIndex
-- ----------------------------------------------------------------------------
CREATE INDEX "Vacation_userId_idx" ON "Vacation"("userId");
CREATE INDEX "Vacation_contractId_idx" ON "Vacation"("contractId");
CREATE INDEX "Vacation_status_idx" ON "Vacation"("status");
CREATE INDEX "Vacation_statusOrder_idx" ON "Vacation"("statusOrder");
CREATE INDEX "Vacation_acquisitiveEnd_idx" ON "Vacation"("acquisitiveEnd");
CREATE INDEX "Vacation_concessiveEnd_idx" ON "Vacation"("concessiveEnd");

CREATE INDEX "VacationPeriod_vacationId_idx" ON "VacationPeriod"("vacationId");
CREATE INDEX "VacationPeriod_startDate_idx" ON "VacationPeriod"("startDate");

CREATE INDEX "Thirteenth_userId_idx" ON "Thirteenth"("userId");
CREATE INDEX "Thirteenth_contractId_idx" ON "Thirteenth"("contractId");
CREATE INDEX "Thirteenth_year_idx" ON "Thirteenth"("year");
CREATE INDEX "Thirteenth_status_idx" ON "Thirteenth"("status");
CREATE INDEX "Thirteenth_statusOrder_idx" ON "Thirteenth"("statusOrder");
CREATE UNIQUE INDEX "Thirteenth_userId_year_contractId_key" ON "Thirteenth"("userId", "year", "contractId");

CREATE INDEX "Gratification_userId_idx" ON "Gratification"("userId");
CREATE INDEX "Gratification_contractId_idx" ON "Gratification"("contractId");
CREATE INDEX "Gratification_isActive_idx" ON "Gratification"("isActive");
CREATE INDEX "Gratification_isHabitual_idx" ON "Gratification"("isHabitual");

CREATE INDEX "WorkAccidentReport_userId_idx" ON "WorkAccidentReport"("userId");
CREATE INDEX "WorkAccidentReport_leaveId_idx" ON "WorkAccidentReport"("leaveId");
CREATE INDEX "WorkAccidentReport_fileId_idx" ON "WorkAccidentReport"("fileId");
CREATE INDEX "WorkAccidentReport_emissionDate_idx" ON "WorkAccidentReport"("emissionDate");

CREATE INDEX "Dependent_healthPlanBenefitId_idx" ON "Dependent"("healthPlanBenefitId");
CREATE INDEX "MonetaryValue_positionId_effectiveDate_idx" ON "MonetaryValue"("positionId", "effectiveDate");
CREATE INDEX "Warning_terminationId_idx" ON "Warning"("terminationId");

-- ----------------------------------------------------------------------------
-- AddForeignKey
-- ----------------------------------------------------------------------------
ALTER TABLE "Warning" ADD CONSTRAINT "Warning_terminationId_fkey" FOREIGN KEY ("terminationId") REFERENCES "Termination"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Dependent" ADD CONSTRAINT "Dependent_healthPlanBenefitId_fkey" FOREIGN KEY ("healthPlanBenefitId") REFERENCES "UserBenefit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Vacation" ADD CONSTRAINT "Vacation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vacation" ADD CONSTRAINT "Vacation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "EmploymentContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VacationPeriod" ADD CONSTRAINT "VacationPeriod_vacationId_fkey" FOREIGN KEY ("vacationId") REFERENCES "Vacation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Thirteenth" ADD CONSTRAINT "Thirteenth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Thirteenth" ADD CONSTRAINT "Thirteenth_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "EmploymentContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Gratification" ADD CONSTRAINT "Gratification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Gratification" ADD CONSTRAINT "Gratification_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "EmploymentContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkAccidentReport" ADD CONSTRAINT "WorkAccidentReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkAccidentReport" ADD CONSTRAINT "WorkAccidentReport_leaveId_fkey" FOREIGN KEY ("leaveId") REFERENCES "Leave"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkAccidentReport" ADD CONSTRAINT "WorkAccidentReport_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
