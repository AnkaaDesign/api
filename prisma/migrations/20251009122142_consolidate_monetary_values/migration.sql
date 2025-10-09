-- Migrate data from Price table to MonetaryValue
INSERT INTO "MonetaryValue" (id, value, "createdAt", "updatedAt", "itemId", "current")
SELECT
  id,
  value,
  "createdAt",
  "updatedAt",
  "itemId",
  false
FROM "Price";

-- Migrate data from PositionRemuneration table to MonetaryValue
INSERT INTO "MonetaryValue" (id, value, "createdAt", "updatedAt", "positionId", "current")
SELECT
  id,
  value,
  "createdAt",
  "updatedAt",
  "positionId",
  false
FROM "PositionRemuneration";

-- DropForeignKey
ALTER TABLE "PositionRemuneration" DROP CONSTRAINT "PositionRemuneration_positionId_fkey";

-- DropForeignKey
ALTER TABLE "Price" DROP CONSTRAINT "Price_itemId_fkey";

-- DropTable
DROP TABLE "PositionRemuneration";

-- DropTable
DROP TABLE "Price";
