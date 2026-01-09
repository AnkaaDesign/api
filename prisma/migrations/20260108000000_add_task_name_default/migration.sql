-- AlterTable: Add default value to Task.name field and update existing NULL values
-- This prevents tasks from having null names which causes "null" to appear in notifications

-- First, update any existing NULL names to the default value
UPDATE "Task" SET "name" = 'Tarefa Sem Nome' WHERE "name" IS NULL;

-- Then, add the default constraint for future inserts
ALTER TABLE "Task" ALTER COLUMN "name" SET DEFAULT 'Tarefa Sem Nome';
