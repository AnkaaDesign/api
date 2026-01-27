-- AlterEnum
ALTER TYPE "ChangeLogTriggeredByType" ADD VALUE 'TASK_COPY_FROM_TASK';

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "isManualMaxQuantity" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isManualReorderPoint" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastAutoOrderDate" TIMESTAMP(3);

-- DropTable
DROP TABLE "Service";
