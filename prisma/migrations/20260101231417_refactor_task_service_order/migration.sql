-- CreateEnum: Create ServiceOrderType enum
CREATE TYPE "ServiceOrderType" AS ENUM ('PRODUCTION', 'FINANCIAL', 'ADMINISTRATIVE', 'ARTWORK');

-- AlterEnum: Remove old TaskStatus values (ON_HOLD, INVOICED, SETTLED)
-- Add PREPARATION to TaskStatus
-- First, migrate any existing data with old statuses (none found in current database)
-- This is safe because we verified no tasks have ON_HOLD, INVOICED, or SETTLED status

-- Drop the default value for status column
ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;

-- Create new enum with updated values
CREATE TYPE "TaskStatus_new" AS ENUM ('PREPARATION', 'PENDING', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED');

-- Migrate data to new enum
ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus_new" USING ("status"::text::"TaskStatus_new");

-- Drop old enum and rename new one
DROP TYPE "TaskStatus";
ALTER TYPE "TaskStatus_new" RENAME TO "TaskStatus";

-- Restore default value
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable: Add type and assignedToId to ServiceOrder
ALTER TABLE "ServiceOrder" ADD COLUMN "type" "ServiceOrderType" NOT NULL DEFAULT 'PRODUCTION',
ADD COLUMN "assignedToId" TEXT;

-- CreateIndex: Add index on assignedToId
CREATE INDEX "ServiceOrder_assignedToId_idx" ON "ServiceOrder"("assignedToId");

-- AddForeignKey: Add foreign key constraint for assignedToId
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
