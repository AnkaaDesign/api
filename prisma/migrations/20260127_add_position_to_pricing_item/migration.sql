-- AlterTable
ALTER TABLE "TaskPricingItem" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Set initial positions based on existing createdAt order
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "pricingId" ORDER BY "createdAt" ASC) - 1 AS pos
  FROM "TaskPricingItem"
)
UPDATE "TaskPricingItem" t
SET "position" = r.pos
FROM ranked r
WHERE t.id = r.id;
