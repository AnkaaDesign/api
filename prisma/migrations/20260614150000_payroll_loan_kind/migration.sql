-- Loan modality (company loan vs payroll-consigned bank loan) + lender name.
-- Additive only: new enum + two nullable columns on PayrollDiscount.

-- CreateEnum
CREATE TYPE "LoanKind" AS ENUM ('COMPANY', 'PAYROLL_CONSIGNED');

-- AlterTable
ALTER TABLE "PayrollDiscount" ADD COLUMN "loanKind" "LoanKind";
ALTER TABLE "PayrollDiscount" ADD COLUMN "lenderName" TEXT;
