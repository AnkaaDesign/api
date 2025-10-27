-- AlterTable
ALTER TABLE "OrderItem" ALTER COLUMN "itemId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "temporaryItemDescription" TEXT;
