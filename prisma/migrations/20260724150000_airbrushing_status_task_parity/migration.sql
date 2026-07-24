-- Airbrushing lifecycle now mirrors TaskStatus:
--   PENDING -> PREPARATION ("Em Preparação")
--   + new WAITING_PRODUCTION ("Aguardando Produção"), reached via the
--     "Disponibilizar para Produção" action (admin/commercial only).
--   IN_PRODUCTION / COMPLETED / CANCELLED unchanged.
--
-- Only "Airbrushing"."status" depends on the type (verified via pg_attribute),
-- so no backup-table column needs to be cast to text before the DROP TYPE.

-- AlterEnum (recreate: an in-place RENAME VALUE cannot also reorder/add)
BEGIN;
CREATE TYPE "AirbrushingStatus_new" AS ENUM ('PREPARATION', 'WAITING_PRODUCTION', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED');
ALTER TABLE "Airbrushing" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Airbrushing" ALTER COLUMN "status" TYPE "AirbrushingStatus_new"
  USING (CASE WHEN "status"::text = 'PENDING' THEN 'PREPARATION' ELSE "status"::text END)::"AirbrushingStatus_new";
ALTER TYPE "AirbrushingStatus" RENAME TO "AirbrushingStatus_old";
ALTER TYPE "AirbrushingStatus_new" RENAME TO "AirbrushingStatus";
DROP TYPE "AirbrushingStatus_old";
ALTER TABLE "Airbrushing" ALTER COLUMN "status" SET DEFAULT 'PREPARATION';
COMMIT;

-- Realign statusOrder with the new AIRBRUSHING_STATUS_ORDER (mirrors TASK_STATUS_ORDER).
-- statusOrder drives the list's default sort, so every existing row must be re-stamped:
-- COMPLETED/CANCELLED shift by one now that WAITING_PRODUCTION occupies slot 2.
UPDATE "Airbrushing"
SET "statusOrder" = CASE "status"
  WHEN 'PREPARATION' THEN 1
  WHEN 'WAITING_PRODUCTION' THEN 2
  WHEN 'IN_PRODUCTION' THEN 3
  WHEN 'COMPLETED' THEN 4
  WHEN 'CANCELLED' THEN 5
END;
