-- Item capability fields: behavior gates move from ItemCategory.type to the item.
-- isBorrowable        -> borrow eligibility (was: category.type = TOOL, frontend-only)
-- stockModel          -> CONSUMPTION (demand forecast) | FIXED_TARGET (hold target qty)
-- fixedTargetQuantity -> target on hand when FIXED_TARGET (engine fallback: 1)
-- PPE identity is Item.ppeType != null (was: category.type = PPE).
-- ItemCategory.type stays as UI grouping + default-provider at item creation.

CREATE TYPE "StockModel" AS ENUM ('CONSUMPTION', 'FIXED_TARGET');

ALTER TABLE "Item"
  ADD COLUMN "isBorrowable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stockModel" "StockModel" NOT NULL DEFAULT 'CONSUMPTION',
  ADD COLUMN "fixedTargetQuantity" DOUBLE PRECISION;

-- Backfill: items in TOOL-type categories are borrowable fixed-target items
-- (mirrors today's behavior: TOOL target = 1).
UPDATE "Item" i
SET "isBorrowable" = true,
    "stockModel" = 'FIXED_TARGET',
    "fixedTargetQuantity" = 1
FROM "ItemCategory" c
WHERE c.id = i."categoryId"
  AND c.type::text IN ('TOOL', 'ELECTRONIC_TOOL');

-- Drop the unused ELECTRONIC_TOOL enum value (0 rows; removed from the TS enum
-- on 2026-05-28 but re-added to the DB type by 20260530120000). Postgres cannot
-- drop enum values directly, so recreate the type.
ALTER TYPE "ItemCategoryType" RENAME TO "ItemCategoryType_old";
CREATE TYPE "ItemCategoryType" AS ENUM ('REGULAR', 'TOOL', 'PPE');
ALTER TABLE "ItemCategory" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "ItemCategory"
  ALTER COLUMN "type" TYPE "ItemCategoryType"
  USING ("type"::text::"ItemCategoryType");
ALTER TABLE "ItemCategory" ALTER COLUMN "type" SET DEFAULT 'REGULAR';
DROP TYPE "ItemCategoryType_old";
