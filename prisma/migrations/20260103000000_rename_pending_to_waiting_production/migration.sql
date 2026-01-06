-- Rename PENDING to WAITING_PRODUCTION in TaskStatus enum
-- This migration safely converts all existing PENDING tasks to WAITING_PRODUCTION

-- Step 1: Create new enum with WAITING_PRODUCTION instead of PENDING
CREATE TYPE "TaskStatus_new" AS ENUM ('PREPARATION', 'WAITING_PRODUCTION', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED');

-- Step 2: Migrate existing data - convert all PENDING to WAITING_PRODUCTION
ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus_new"
  USING (
    CASE
      WHEN "status"::text = 'PENDING' THEN 'WAITING_PRODUCTION'::text
      ELSE "status"::text
    END
  )::"TaskStatus_new";

-- Step 3: Drop old enum and rename new one
DROP TYPE "TaskStatus";
ALTER TYPE "TaskStatus_new" RENAME TO "TaskStatus";

-- Step 4: Restore default value
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'PREPARATION';

-- Step 5: Update statusOrder for all WAITING_PRODUCTION tasks (should be order 2)
UPDATE "Task" SET "statusOrder" = 2 WHERE "status" = 'WAITING_PRODUCTION';
