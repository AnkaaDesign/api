-- Multi-shelf item locations: replace single (locationLevel, locationColumn) cell
-- with a JSON array of cells [{ level, column }].

-- 1) Add the new column.
ALTER TABLE "Item" ADD COLUMN "locationCells" JSONB;

-- 2) Backfill: a single existing position becomes a 1-element array.
UPDATE "Item"
SET "locationCells" = jsonb_build_array(
  jsonb_build_object('level', "locationLevel", 'column', "locationColumn")
)
WHERE "locationLevel" IS NOT NULL;

-- 3) Drop the legacy scalar columns.
ALTER TABLE "Item" DROP COLUMN "locationLevel";
ALTER TABLE "Item" DROP COLUMN "locationColumn";
