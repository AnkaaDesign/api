-- AlterEnum: Add YARD_WAIT and YARD_EXIT to TRUCK_SPOT
ALTER TYPE "TRUCK_SPOT" ADD VALUE IF NOT EXISTS 'YARD_WAIT';
ALTER TYPE "TRUCK_SPOT" ADD VALUE IF NOT EXISTS 'YARD_EXIT';

-- Prisma: commit the enum changes before using them
-- https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/troubleshooting-development#enum-values
COMMIT;

-- Data migration: Update existing patio trucks (spot IS NULL with active task) to YARD_WAIT
UPDATE "Truck" SET "spot" = 'YARD_WAIT'
WHERE "spot" IS NULL
  AND "taskId" IN (
    SELECT tk."id" FROM "Task" tk
    WHERE tk."status" IN ('PREPARATION', 'WAITING_PRODUCTION', 'IN_PRODUCTION')
  );
