-- AlterTable: Remove palette and paletteOrder fields from Paint table
ALTER TABLE "Paint" DROP COLUMN "palette";
ALTER TABLE "Paint" DROP COLUMN "paletteOrder";

-- DropIndex: Remove palette index
DROP INDEX IF EXISTS "Paint_palette_paletteOrder_idx";

-- DropEnum: Remove ColorPalette enum (only if not used elsewhere)
DROP TYPE IF EXISTS "ColorPalette";
