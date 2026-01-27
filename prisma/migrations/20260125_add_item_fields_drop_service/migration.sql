-- AlterEnum (idempotent: skip if value already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'TASK_COPY_FROM_TASK'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ChangeLogTriggeredByType')
  ) THEN
    ALTER TYPE "ChangeLogTriggeredByType" ADD VALUE 'TASK_COPY_FROM_TASK';
  END IF;
END
$$;

-- AlterTable (idempotent: skip columns that already exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Item' AND column_name = 'isManualMaxQuantity') THEN
    ALTER TABLE "Item" ADD COLUMN "isManualMaxQuantity" BOOLEAN NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Item' AND column_name = 'isManualReorderPoint') THEN
    ALTER TABLE "Item" ADD COLUMN "isManualReorderPoint" BOOLEAN NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Item' AND column_name = 'lastAutoOrderDate') THEN
    ALTER TABLE "Item" ADD COLUMN "lastAutoOrderDate" TIMESTAMP(3);
  END IF;
END
$$;

-- DropTable (idempotent: skip if table doesn't exist)
DROP TABLE IF EXISTS "Service";
