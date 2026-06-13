-- CreateEnum
CREATE TYPE "SalaryAdjustmentType" AS ENUM ('DISSIDIO_CCT', 'MERIT', 'PROMOTION', 'EQUALIZATION', 'REFRAME', 'OTHER');

-- CreateEnum
CREATE TYPE "PositionChangeReason" AS ENUM ('ADMISSION', 'PROMOTION', 'TRANSFER', 'DEMOTION', 'ADJUSTMENT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "BenefitKind" AS ENUM ('TRANSPORT_VOUCHER', 'MEAL_VOUCHER', 'FOOD_VOUCHER', 'HEALTH_PLAN', 'DENTAL_PLAN', 'PHARMACY_AGREEMENT', 'PARTNERSHIP', 'LIFE_INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "BenefitEnrollmentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'OPTED_OUT', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('DOCS_PENDING', 'MEDICAL_EXAM', 'CONTRACT', 'REGISTRATION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdmissionDocumentType" AS ENUM ('CPF', 'RG', 'CTPS', 'PROOF_OF_RESIDENCE', 'VOTER_ID', 'MILITARY_CERTIFICATE', 'BIRTH_MARRIAGE_CERTIFICATE', 'PHOTO', 'PIS', 'ADMISSION_EXAM', 'TRANSPORT_VOUCHER_DECLARATION', 'FAMILY_SALARY_FORM', 'EMPLOYMENT_CONTRACT', 'TIME_BANK_AGREEMENT', 'LGPD_TERM', 'DRIVER_LICENSE', 'OTHER');

-- CreateEnum
CREATE TYPE "AdmissionDocumentStatus" AS ENUM ('PENDING', 'RECEIVED', 'SIGNED', 'WAIVED');

-- CreateEnum
CREATE TYPE "TerminationType" AS ENUM ('WITHOUT_CAUSE', 'WITH_CAUSE', 'RESIGNATION', 'MUTUAL_AGREEMENT', 'EXPERIENCE_END', 'EXPERIENCE_EARLY_EMPLOYER', 'EXPERIENCE_EARLY_EMPLOYEE', 'INDIRECT', 'DEATH');

-- CreateEnum
CREATE TYPE "TerminationStatus" AS ENUM ('INITIATED', 'NOTICE_PERIOD', 'DOCUMENTS', 'MEDICAL_EXAM', 'CALCULATION', 'PAYMENT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NoticeType" AS ENUM ('WORKED', 'INDEMNIFIED', 'WAIVED');

-- CreateEnum
CREATE TYPE "NoticeReduction" AS ENUM ('NONE', 'TWO_HOURS_PER_DAY', 'SEVEN_DAYS_OFF');

-- CreateEnum
CREATE TYPE "TerminationItemType" AS ENUM ('SALARY_BALANCE', 'NOTICE_INDEMNIFIED', 'NOTICE_DISCOUNT', 'THIRTEENTH_PROPORTIONAL', 'ACCRUED_VACATION', 'PROPORTIONAL_VACATION', 'ART479_INDEMNITY', 'FGTS_FINE', 'ART477_FINE', 'INSS_DISCOUNT', 'IRRF_DISCOUNT', 'ADVANCE_DISCOUNT', 'BENEFIT_DISCOUNT', 'OTHER_EARNING', 'OTHER_DISCOUNT');

-- CreateEnum
CREATE TYPE "TerminationDocumentType" AS ENUM ('NOTICE_LETTER', 'TRCT', 'FGTS_GUIDE', 'FGTS_STATEMENT', 'UNEMPLOYMENT_INSURANCE_FORM', 'DISMISSAL_EXAM', 'PAYMENT_RECEIPT', 'DOCUMENT_DELIVERY_RECEIPT', 'MUTUAL_AGREEMENT_TERM', 'OTHER');

-- CreateEnum
CREATE TYPE "TerminationDocumentStatus" AS ENUM ('PENDING', 'GENERATED', 'SIGNED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "MedicalExamType" AS ENUM ('ADMISSION', 'PERIODIC', 'RETURN_TO_WORK', 'RISK_CHANGE', 'DISMISSAL');

-- CreateEnum
CREATE TYPE "MedicalExamResult" AS ENUM ('PENDING', 'FIT', 'UNFIT');

-- CreateEnum
CREATE TYPE "MedicalExamStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ILLNESS_UP_TO_15', 'ILLNESS_INSS', 'WORK_ACCIDENT', 'MATERNITY', 'PATERNITY', 'MARRIAGE', 'BEREAVEMENT', 'BLOOD_DONATION', 'MILITARY', 'COURT_ATTENDANCE', 'UNPAID', 'SUSPENSION', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'AWAITING_PAYMENT', 'PAID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'ADMISSION';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'BENEFIT';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'LEAVE';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'MEDICAL_EXAM';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'SALARY_ADJUSTMENT';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'TERMINATION';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'USER_BENEFIT';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'USER_POSITION_HISTORY';

-- AlterEnum
ALTER TYPE "SectorPrivileges" ADD VALUE IF NOT EXISTS 'ACCOUNTING';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentRequestedAt" TIMESTAMP(3),
ADD COLUMN     "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
ADD COLUMN     "paymentStatusOrder" INTEGER NOT NULL DEFAULT 1;
-- CreateTable
CREATE TABLE "SalaryAdjustment" (
    "id" TEXT NOT NULL,
    "type" "SalaryAdjustmentType" NOT NULL DEFAULT 'OTHER',
    "percentage" DOUBLE PRECISION,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "appliedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryAdjustmentItem" (
    "id" TEXT NOT NULL,
    "salaryAdjustmentId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "previousValue" DOUBLE PRECISION NOT NULL,
    "newValue" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryAdjustmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPositionHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT,
    "previousPositionId" TEXT,
    "reason" "PositionChangeReason" NOT NULL DEFAULT 'ADJUSTMENT',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "note" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPositionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Benefit" (
    "id" TEXT NOT NULL,
    "kind" "BenefitKind" NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "defaultValue" DOUBLE PRECISION,
    "defaultEmployeeDiscountPercent" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Benefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBenefit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "status" "BenefitEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "monthlyValue" DOUBLE PRECISION NOT NULL,
    "employeeDiscountValue" DOUBLE PRECISION,
    "employeeDiscountPercent" DOUBLE PRECISION,
    "dailyTickets" INTEGER,
    "declarationFileId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'DOCS_PENDING',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "hireDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionDocument" (
    "id" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "type" "AdmissionDocumentType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "AdmissionDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "fileId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Termination" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TerminationType" NOT NULL,
    "status" "TerminationStatus" NOT NULL DEFAULT 'INITIATED',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "noticeType" "NoticeType",
    "noticeReduction" "NoticeReduction" NOT NULL DEFAULT 'NONE',
    "noticeDays" INTEGER,
    "noticeStartDate" TIMESTAMP(3),
    "lastWorkingDate" TIMESTAMP(3),
    "terminationDate" TIMESTAMP(3),
    "projectedEndDate" TIMESTAMP(3),
    "paymentDueDate" TIMESTAMP(3),
    "paymentDate" TIMESTAMP(3),
    "paidAmount" DOUBLE PRECISION,
    "baseRemuneration" DOUBLE PRECISION,
    "fgtsBalance" DOUBLE PRECISION,
    "accruedVacationPeriods" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "justCauseArticle" TEXT,
    "initiatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Termination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerminationItem" (
    "id" TEXT NOT NULL,
    "terminationId" TEXT NOT NULL,
    "type" "TerminationItemType" NOT NULL,
    "description" TEXT,
    "referenceQuantity" DOUBLE PRECISION,
    "baseValue" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION NOT NULL,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerminationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerminationDocument" (
    "id" TEXT NOT NULL,
    "terminationId" TEXT NOT NULL,
    "type" "TerminationDocumentType" NOT NULL,
    "status" "TerminationDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "fileId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerminationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalExam" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "MedicalExamType" NOT NULL,
    "status" "MedicalExamStatus" NOT NULL DEFAULT 'SCHEDULED',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "result" "MedicalExamResult" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3),
    "examDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "physicianName" TEXT,
    "crm" TEXT,
    "clinic" TEXT,
    "notes" TEXT,
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalExam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Leave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'SCHEDULED',
    "statusOrder" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "expectedEndDate" TIMESTAMP(3),
    "actualEndDate" TIMESTAMP(3),
    "cid" TEXT,
    "inssBenefitNumber" TEXT,
    "returnExamRequired" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Leave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_FileToLeave" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FileToLeave_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "SalaryAdjustment_appliedById_idx" ON "SalaryAdjustment"("appliedById");

-- CreateIndex
CREATE INDEX "SalaryAdjustment_effectiveDate_idx" ON "SalaryAdjustment"("effectiveDate");

-- CreateIndex
CREATE INDEX "SalaryAdjustmentItem_salaryAdjustmentId_idx" ON "SalaryAdjustmentItem"("salaryAdjustmentId");

-- CreateIndex
CREATE INDEX "SalaryAdjustmentItem_positionId_idx" ON "SalaryAdjustmentItem"("positionId");

-- CreateIndex
CREATE INDEX "UserPositionHistory_userId_idx" ON "UserPositionHistory"("userId");

-- CreateIndex
CREATE INDEX "UserPositionHistory_positionId_idx" ON "UserPositionHistory"("positionId");

-- CreateIndex
CREATE INDEX "UserPositionHistory_previousPositionId_idx" ON "UserPositionHistory"("previousPositionId");

-- CreateIndex
CREATE INDEX "UserPositionHistory_changedById_idx" ON "UserPositionHistory"("changedById");

-- CreateIndex
CREATE INDEX "UserPositionHistory_endedAt_idx" ON "UserPositionHistory"("endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Benefit_name_key" ON "Benefit"("name");

-- CreateIndex
CREATE INDEX "Benefit_kind_idx" ON "Benefit"("kind");

-- CreateIndex
CREATE INDEX "Benefit_isActive_idx" ON "Benefit"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserBenefit_declarationFileId_key" ON "UserBenefit"("declarationFileId");

-- CreateIndex
CREATE INDEX "UserBenefit_userId_idx" ON "UserBenefit"("userId");

-- CreateIndex
CREATE INDEX "UserBenefit_benefitId_idx" ON "UserBenefit"("benefitId");

-- CreateIndex
CREATE INDEX "UserBenefit_statusOrder_idx" ON "UserBenefit"("statusOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Admission_userId_key" ON "Admission"("userId");

-- CreateIndex
CREATE INDEX "Admission_statusOrder_idx" ON "Admission"("statusOrder");

-- CreateIndex
CREATE INDEX "Admission_createdById_idx" ON "Admission"("createdById");

-- CreateIndex
CREATE INDEX "AdmissionDocument_admissionId_idx" ON "AdmissionDocument"("admissionId");

-- CreateIndex
CREATE INDEX "AdmissionDocument_fileId_idx" ON "AdmissionDocument"("fileId");

-- CreateIndex
CREATE INDEX "AdmissionDocument_status_idx" ON "AdmissionDocument"("status");

-- CreateIndex
CREATE INDEX "Termination_userId_idx" ON "Termination"("userId");

-- CreateIndex
CREATE INDEX "Termination_statusOrder_idx" ON "Termination"("statusOrder");

-- CreateIndex
CREATE INDEX "Termination_initiatedById_idx" ON "Termination"("initiatedById");

-- CreateIndex
CREATE INDEX "Termination_terminationDate_idx" ON "Termination"("terminationDate");

-- CreateIndex
CREATE INDEX "TerminationItem_terminationId_idx" ON "TerminationItem"("terminationId");

-- CreateIndex
CREATE INDEX "TerminationDocument_terminationId_idx" ON "TerminationDocument"("terminationId");

-- CreateIndex
CREATE INDEX "TerminationDocument_fileId_idx" ON "TerminationDocument"("fileId");

-- CreateIndex
CREATE INDEX "MedicalExam_userId_idx" ON "MedicalExam"("userId");

-- CreateIndex
CREATE INDEX "MedicalExam_statusOrder_idx" ON "MedicalExam"("statusOrder");

-- CreateIndex
CREATE INDEX "MedicalExam_expiresAt_idx" ON "MedicalExam"("expiresAt");

-- CreateIndex
CREATE INDEX "MedicalExam_fileId_idx" ON "MedicalExam"("fileId");

-- CreateIndex
CREATE INDEX "Leave_userId_idx" ON "Leave"("userId");

-- CreateIndex
CREATE INDEX "Leave_statusOrder_idx" ON "Leave"("statusOrder");

-- CreateIndex
CREATE INDEX "Leave_startDate_idx" ON "Leave"("startDate");

-- CreateIndex
CREATE INDEX "_FileToLeave_B_index" ON "_FileToLeave"("B");

-- CreateIndex
CREATE INDEX "Order_paymentStatus_idx" ON "Order"("paymentStatus");

-- CreateIndex
CREATE INDEX "Order_paymentStatusOrder_idx" ON "Order"("paymentStatusOrder");

-- AddForeignKey
ALTER TABLE "SalaryAdjustment" ADD CONSTRAINT "SalaryAdjustment_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdjustmentItem" ADD CONSTRAINT "SalaryAdjustmentItem_salaryAdjustmentId_fkey" FOREIGN KEY ("salaryAdjustmentId") REFERENCES "SalaryAdjustment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdjustmentItem" ADD CONSTRAINT "SalaryAdjustmentItem_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPositionHistory" ADD CONSTRAINT "UserPositionHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPositionHistory" ADD CONSTRAINT "UserPositionHistory_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPositionHistory" ADD CONSTRAINT "UserPositionHistory_previousPositionId_fkey" FOREIGN KEY ("previousPositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPositionHistory" ADD CONSTRAINT "UserPositionHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBenefit" ADD CONSTRAINT "UserBenefit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBenefit" ADD CONSTRAINT "UserBenefit_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "Benefit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBenefit" ADD CONSTRAINT "UserBenefit_declarationFileId_fkey" FOREIGN KEY ("declarationFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDocument" ADD CONSTRAINT "AdmissionDocument_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDocument" ADD CONSTRAINT "AdmissionDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Termination" ADD CONSTRAINT "Termination_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Termination" ADD CONSTRAINT "Termination_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminationItem" ADD CONSTRAINT "TerminationItem_terminationId_fkey" FOREIGN KEY ("terminationId") REFERENCES "Termination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminationDocument" ADD CONSTRAINT "TerminationDocument_terminationId_fkey" FOREIGN KEY ("terminationId") REFERENCES "Termination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminationDocument" ADD CONSTRAINT "TerminationDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalExam" ADD CONSTRAINT "MedicalExam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalExam" ADD CONSTRAINT "MedicalExam_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FileToLeave" ADD CONSTRAINT "_FileToLeave_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FileToLeave" ADD CONSTRAINT "_FileToLeave_B_fkey" FOREIGN KEY ("B") REFERENCES "Leave"("id") ON DELETE CASCADE ON UPDATE CASCADE;

