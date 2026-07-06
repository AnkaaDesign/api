-- Airbrushing go-live cleanup:
--   * Remove PARTIALLY_PAID from AirbrushingPaymentStatus (now PENDING, PAID)
--   * Drop unused file-category join tables: budgets, invoiceReimbursements, reimbursements
-- Feature never used in production => affected join tables are empty (data-safe).

-- AlterEnum
BEGIN;
CREATE TYPE "AirbrushingPaymentStatus_new" AS ENUM ('PENDING', 'PAID');
ALTER TABLE "Airbrushing" ALTER COLUMN "paymentStatus" DROP DEFAULT;
ALTER TABLE "Airbrushing" ALTER COLUMN "paymentStatus" TYPE "AirbrushingPaymentStatus_new" USING ("paymentStatus"::text::"AirbrushingPaymentStatus_new");
ALTER TYPE "AirbrushingPaymentStatus" RENAME TO "AirbrushingPaymentStatus_old";
ALTER TYPE "AirbrushingPaymentStatus_new" RENAME TO "AirbrushingPaymentStatus";
DROP TYPE "AirbrushingPaymentStatus_old";
ALTER TABLE "Airbrushing" ALTER COLUMN "paymentStatus" SET DEFAULT 'PENDING';
COMMIT;

-- DropForeignKey
ALTER TABLE "_AIRBRUSHING_BUDGETS" DROP CONSTRAINT "_AIRBRUSHING_BUDGETS_A_fkey";

-- DropForeignKey
ALTER TABLE "_AIRBRUSHING_BUDGETS" DROP CONSTRAINT "_AIRBRUSHING_BUDGETS_B_fkey";

-- DropForeignKey
ALTER TABLE "_AIRBRUSHING_INVOICE_REIMBURSEMENTS" DROP CONSTRAINT "_AIRBRUSHING_INVOICE_REIMBURSEMENTS_A_fkey";

-- DropForeignKey
ALTER TABLE "_AIRBRUSHING_INVOICE_REIMBURSEMENTS" DROP CONSTRAINT "_AIRBRUSHING_INVOICE_REIMBURSEMENTS_B_fkey";

-- DropForeignKey
ALTER TABLE "_AIRBRUSHING_REIMBURSEMENTS" DROP CONSTRAINT "_AIRBRUSHING_REIMBURSEMENTS_A_fkey";

-- DropForeignKey
ALTER TABLE "_AIRBRUSHING_REIMBURSEMENTS" DROP CONSTRAINT "_AIRBRUSHING_REIMBURSEMENTS_B_fkey";

-- DropTable
DROP TABLE "_AIRBRUSHING_BUDGETS";

-- DropTable
DROP TABLE "_AIRBRUSHING_INVOICE_REIMBURSEMENTS";

-- DropTable
DROP TABLE "_AIRBRUSHING_REIMBURSEMENTS";

