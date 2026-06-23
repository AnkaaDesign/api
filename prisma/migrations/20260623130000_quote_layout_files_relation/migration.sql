-- Convert TaskQuote single layout file (scalar layoutFileId) into a one-to-many
-- relation: the FK now lives on File.quoteLayoutId (a quote can have multiple
-- layout files; app/Zod enforce max 2).

-- 1. Add the FK column on File
ALTER TABLE "File" ADD COLUMN "quoteLayoutId" TEXT;

-- 2. Index it
CREATE INDEX "File_quoteLayoutId_idx" ON "File"("quoteLayoutId");

-- 3. Add the FK constraint (File -> TaskQuote)
ALTER TABLE "File" ADD CONSTRAINT "File_quoteLayoutId_fkey" FOREIGN KEY ("quoteLayoutId") REFERENCES "TaskQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Data migration: preserve every existing single layout file into the relation
UPDATE "File" f
SET "quoteLayoutId" = q."id"
FROM "TaskQuote" q
WHERE q."layoutFileId" = f."id";

-- 5. Drop the now-obsolete TaskQuote.layoutFileId FK constraint, index and column
ALTER TABLE "TaskQuote" DROP CONSTRAINT "TaskQuote_layoutFileId_fkey";
DROP INDEX "TaskQuote_layoutFileId_idx";
ALTER TABLE "TaskQuote" DROP COLUMN "layoutFileId";
