-- Vacation status collapse: OPEN/IN_PROGRESS → SCHEDULED; drop statusOrder.
--
-- The VacationStatus enum is recreated as ('SCHEDULED','PAID','EXPIRED').
-- "Em gozo" is now a COMPUTED display state derived from dates, never stored.
--
-- Strategy: backfill data → rename old enum → create new enum → alter columns
-- via a text cast → set defaults → drop the old enum → drop statusOrder columns
-- and their indexes.

-- 1. Backfill the soon-to-be-dropped enum values onto SCHEDULED so the USING
--    text cast below resolves cleanly to a value that exists in the new enum.
UPDATE "Vacation"
   SET "status" = 'SCHEDULED'
 WHERE "status" IN ('OPEN', 'IN_PROGRESS');

UPDATE "VacationGroup"
   SET "status" = 'SCHEDULED'
 WHERE "status" IN ('OPEN', 'IN_PROGRESS');

-- 2. Recreate the Postgres enum with only the collapsed values.
ALTER TYPE "VacationStatus" RENAME TO "VacationStatus_old";

CREATE TYPE "VacationStatus" AS ENUM ('SCHEDULED', 'PAID', 'EXPIRED');

-- Drop the defaults that still reference the old type before altering columns.
ALTER TABLE "Vacation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "VacationGroup" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Vacation"
  ALTER COLUMN "status" TYPE "VacationStatus"
  USING ("status"::text::"VacationStatus");

ALTER TABLE "VacationGroup"
  ALTER COLUMN "status" TYPE "VacationStatus"
  USING ("status"::text::"VacationStatus");

-- 3. New default is SCHEDULED (vacations are created scheduled now).
ALTER TABLE "Vacation" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';
ALTER TABLE "VacationGroup" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';

DROP TYPE "VacationStatus_old";

-- 4. Drop the statusOrder columns and their indexes (status sorting is now
--    handled in-app via VACATION_STATUS_LABELS / status enum only).
DROP INDEX IF EXISTS "Vacation_statusOrder_idx";
DROP INDEX IF EXISTS "VacationGroup_status_statusOrder_idx";

ALTER TABLE "Vacation" DROP COLUMN "statusOrder";
ALTER TABLE "VacationGroup" DROP COLUMN "statusOrder";

-- 5. Recreate the VacationGroup status index without statusOrder (matches schema).
CREATE INDEX IF NOT EXISTS "VacationGroup_status_idx" ON "VacationGroup"("status");
