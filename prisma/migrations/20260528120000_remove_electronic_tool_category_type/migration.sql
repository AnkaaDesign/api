-- Remove the ELECTRONIC_TOOL value from ItemCategoryType.
--
-- The electronic-tool distinction existed only to give tools a different
-- auto-order threshold (electronic reordered at qty 0, regular at qty 1).
-- Both tool kinds now reorder only once stock hits 0, so the distinction is
-- gone. Existing electronic-tool categories are reassigned to TOOL.
--
-- PostgreSQL cannot drop a single enum value, so the type is recreated.

-- Reassign existing rows BEFORE the value is removed from the enum.
UPDATE "ItemCategory" SET "type" = 'TOOL' WHERE "type" = 'ELECTRONIC_TOOL';

-- AlterEnum
BEGIN;
CREATE TYPE "ItemCategoryType_new" AS ENUM ('REGULAR', 'TOOL', 'PPE');
ALTER TABLE "ItemCategory" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "ItemCategory" ALTER COLUMN "type" TYPE "ItemCategoryType_new" USING ("type"::text::"ItemCategoryType_new");
ALTER TYPE "ItemCategoryType" RENAME TO "ItemCategoryType_old";
ALTER TYPE "ItemCategoryType_new" RENAME TO "ItemCategoryType";
DROP TYPE "ItemCategoryType_old";
ALTER TABLE "ItemCategory" ALTER COLUMN "type" SET DEFAULT 'REGULAR';
COMMIT;
