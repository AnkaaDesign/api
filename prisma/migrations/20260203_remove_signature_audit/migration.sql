-- DropForeignKey
ALTER TABLE "SignatureAuditLog" DROP CONSTRAINT IF EXISTS "SignatureAuditLog_ppeDeliveryId_fkey";
ALTER TABLE "SignatureAuditLog" DROP CONSTRAINT IF EXISTS "SignatureAuditLog_userId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "SignatureAuditLog_action_idx";
DROP INDEX IF EXISTS "SignatureAuditLog_createdAt_idx";
DROP INDEX IF EXISTS "SignatureAuditLog_ppeDeliveryId_idx";
DROP INDEX IF EXISTS "SignatureAuditLog_userId_idx";

-- DropTable
DROP TABLE IF EXISTS "SignatureAuditLog";

-- AlterTable: Remove unused signature columns from PpeDelivery
ALTER TABLE "PpeDelivery" DROP COLUMN IF EXISTS "signatureMethod";
ALTER TABLE "PpeDelivery" DROP COLUMN IF EXISTS "signatureTermsAcceptedAt";
ALTER TABLE "PpeDelivery" DROP COLUMN IF EXISTS "signatureDeviceInfo";
ALTER TABLE "PpeDelivery" DROP COLUMN IF EXISTS "signatureIpAddress";
