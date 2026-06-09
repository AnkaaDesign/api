-- Item ⇄ ItemBrand: single brand (Item.brandId) -> many-to-many (Item.brands).
--
-- Rationale: a physical item (e.g. "disco flap de corte") is stocked under several
-- interchangeable brands; the buyer purchases whichever brand is available, and an
-- order shows ALL of an item's brands so the supplier can quote what it has in stock.
-- We therefore drop the single-brand FK and model brands as an implicit Prisma M2M
-- (relation "ITEM_BRANDS" -> join table "_ITEM_BRANDS"), mirroring the existing
-- "_PAINT_BRAND_COMPONENT_ITEMS" relation. Column order (A=Item, B=ItemBrand) follows
-- Prisma's alphabetical model rule ("Item" < "ItemBrand").
--
-- Data is preserved: every existing Item.brandId becomes one row in the join table.

-- ----- Create the implicit M2M join table -----
CREATE TABLE IF NOT EXISTS "_ITEM_BRANDS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ITEM_BRANDS_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX IF NOT EXISTS "_ITEM_BRANDS_B_index" ON "_ITEM_BRANDS"("B");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_ITEM_BRANDS_A_fkey') THEN
    ALTER TABLE "_ITEM_BRANDS" ADD CONSTRAINT "_ITEM_BRANDS_A_fkey"
      FOREIGN KEY ("A") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_ITEM_BRANDS_B_fkey') THEN
    ALTER TABLE "_ITEM_BRANDS" ADD CONSTRAINT "_ITEM_BRANDS_B_fkey"
      FOREIGN KEY ("B") REFERENCES "ItemBrand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ----- Backfill: carry every existing single brand into the join table -----
INSERT INTO "_ITEM_BRANDS" ("A", "B")
SELECT "id", "brandId"
FROM "Item"
WHERE "brandId" IS NOT NULL
ON CONFLICT ("A","B") DO NOTHING;

-- ----- Drop the old single-brand FK, index and column -----
DROP INDEX IF EXISTS "Item_categoryId_brandId_idx";

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Item_brandId_fkey') THEN
    ALTER TABLE "Item" DROP CONSTRAINT "Item_brandId_fkey";
  END IF;
END $$;

ALTER TABLE "Item" DROP COLUMN IF EXISTS "brandId";

-- Replacement index for category lookups that previously rode on the composite index.
CREATE INDEX IF NOT EXISTS "Item_categoryId_idx" ON "Item"("categoryId");
