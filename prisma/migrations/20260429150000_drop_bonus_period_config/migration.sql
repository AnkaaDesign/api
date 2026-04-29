-- Drop BonusPeriodConfig — wasn't needed. The salary-based logistic algorithm
-- already has an `adjustment` config field, and each saved Bonus row already
-- snapshots it in `calculationParams.config.adjustment`. Reading/writing the
-- value directly on the bonus rows is enough; a separate table was redundant.
DROP TABLE IF EXISTS "BonusPeriodConfig";
