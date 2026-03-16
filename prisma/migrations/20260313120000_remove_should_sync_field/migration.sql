-- AlterTable: Remove shouldSync from ServiceOrder
ALTER TABLE "ServiceOrder" DROP COLUMN "shouldSync";

-- AlterTable: Remove shouldSync from TaskQuoteService
ALTER TABLE "TaskQuoteService" DROP COLUMN "shouldSync";
