-- RecurrentPayable: support sub-monthly (weekly / N-times-per-week) cadences.
--   * daysOfWeek: weekdays a weekly bill is due (0=Sun … 6=Sat, SP time).
--   * dueDayOfMonth becomes nullable (weekly bills don't have a day-of-month).
-- RecurrentPayableOccurrence: a weekly bill has >1 occurrence per month, so the
-- uniqueness key moves from (recurrentPayableId, competence) to
-- (recurrentPayableId, dueDate). `competence` (YYYY-MM) is kept for grouping and
-- gains a plain composite index for the per-month dashboard lookups.

-- RecurrentPayable
ALTER TABLE "RecurrentPayable"
  ADD COLUMN "daysOfWeek" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

ALTER TABLE "RecurrentPayable"
  ALTER COLUMN "dueDayOfMonth" DROP NOT NULL;

-- RecurrentPayableOccurrence: swap the uniqueness key competence -> dueDate.
-- Existing data is safe: each payable had at most one occurrence per competence,
-- and each competence resolves to a distinct dueDate, so (payableId, dueDate) is
-- already unique across current rows.
DROP INDEX IF EXISTS "RecurrentPayableOccurrence_recurrentPayableId_competence_key";

CREATE UNIQUE INDEX "RecurrentPayableOccurrence_recurrentPayableId_dueDate_key"
  ON "RecurrentPayableOccurrence"("recurrentPayableId", "dueDate");

CREATE INDEX "RecurrentPayableOccurrence_recurrentPayableId_competence_idx"
  ON "RecurrentPayableOccurrence"("recurrentPayableId", "competence");
