-- Data migration: Update existing patio trucks (spot IS NULL with active task) to YARD_WAIT
UPDATE "Truck" SET "spot" = 'YARD_WAIT'
WHERE "spot" IS NULL
  AND "taskId" IN (
    SELECT tk."id" FROM "Task" tk
    WHERE tk."status" IN ('PREPARATION', 'WAITING_PRODUCTION', 'IN_PRODUCTION')
  );
