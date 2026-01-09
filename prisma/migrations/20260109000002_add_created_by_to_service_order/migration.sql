-- AddCreatedByToServiceOrder
-- Add createdById field to ServiceOrder to track who created the service order
-- This is needed for proper completion notifications (notify the creator when service order is completed)

-- Step 1: Add the column as nullable first (since existing records won't have a value)
ALTER TABLE "ServiceOrder" ADD COLUMN "createdById" TEXT;

-- Step 2: For existing service orders, set createdById to the task creator
-- This is a reasonable default since service orders are created in the context of a task
UPDATE "ServiceOrder" so
SET "createdById" = (
  SELECT t."createdById"
  FROM "Task" t
  WHERE t.id = so."taskId"
  LIMIT 1
)
WHERE so."createdById" IS NULL
  AND EXISTS (
    SELECT 1 FROM "Task" t
    WHERE t.id = so."taskId" AND t."createdById" IS NOT NULL
  );

-- Step 3: For any remaining service orders without a createdById (orphaned or task without creator),
-- set to the first active ADMIN user as a fallback
UPDATE "ServiceOrder" so
SET "createdById" = (
  SELECT u.id
  FROM "User" u
  JOIN "Sector" s ON u."sectorId" = s.id
  WHERE s."privileges" = 'ADMIN'
    AND u."isActive" = true
  LIMIT 1
)
WHERE so."createdById" IS NULL;

-- Step 4: Make the column NOT NULL
ALTER TABLE "ServiceOrder" ALTER COLUMN "createdById" SET NOT NULL;

-- Step 5: Create index for performance
CREATE INDEX "ServiceOrder_createdById_idx" ON "ServiceOrder"("createdById");

-- Step 6: Add foreign key constraint
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
