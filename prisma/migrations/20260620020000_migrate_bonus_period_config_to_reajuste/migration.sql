-- Unify the bonus adjustment system: convert the parallel
-- BonusPeriodConfig.adjustment (cumulative fraction per period) into first-class
-- SalaryAdjustment(BONUS) reajuste rows, then drop the redundant table.
--
-- BonusPeriodConfig stored a CUMULATIVE value per period (carry-forward
-- semantics). The unified model stores a DELTA per reajuste and the bonus engine
-- sums the deltas in force for a period. So we recover each period's delta as
-- the difference from the previous period's cumulative value (LAG), and emit a
-- reajuste row dated to the first day of that period's reference month.
-- effectiveDate = day 1 keeps the row inside the period's bonus cycle (26th of
-- the previous month → 25th), so the engine's "<= cycle end (day 25)" sum picks
-- it up for that period and every later one.
INSERT INTO "SalaryAdjustment" (id, type, percentage, "effectiveDate", note, "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  'BONUS'::"SalaryAdjustmentType",
  ROUND(((d.adjustment - d.prev) * 100)::numeric, 2)::double precision,
  make_date(d.year, d.month, 1)::timestamp,
  'Reajuste de bônus do período ' || d.month || '/' || d.year || ' (migrado de BonusPeriodConfig)',
  now(),
  now()
FROM (
  SELECT
    year,
    month,
    adjustment,
    COALESCE(LAG(adjustment) OVER (ORDER BY year, month), 0) AS prev
  FROM "BonusPeriodConfig"
) d
WHERE ROUND(((d.adjustment - d.prev) * 100)::numeric, 2) <> 0;

DROP TABLE "BonusPeriodConfig";
