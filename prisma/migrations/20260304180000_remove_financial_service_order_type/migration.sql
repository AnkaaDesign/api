-- Remove FINANCIAL service order type entirely
--
-- 1. Delete all service orders with type FINANCIAL
-- 2. Remove FINANCIAL from ServiceOrderType enum

-- Delete all FINANCIAL service orders
DELETE FROM "ServiceOrder" WHERE "type" = 'FINANCIAL';

-- Remove FINANCIAL from the ServiceOrderType enum
ALTER TYPE "ServiceOrderType" RENAME TO "ServiceOrderType_old";
CREATE TYPE "ServiceOrderType" AS ENUM ('PRODUCTION', 'COMMERCIAL', 'ARTWORK', 'LOGISTIC');
ALTER TABLE "ServiceOrder" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "ServiceOrder" ALTER COLUMN "type" TYPE "ServiceOrderType" USING ("type"::text::"ServiceOrderType");
ALTER TABLE "ServiceOrder" ALTER COLUMN "type" SET DEFAULT 'PRODUCTION';
DROP TYPE "ServiceOrderType_old";
