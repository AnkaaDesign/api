-- Per-user Flutter-mobile layout persistence (column/section order + visibility).
-- Separate from the *Web configs because mobile has different columns/widths.
ALTER TABLE "Preferences" ADD COLUMN IF NOT EXISTS "tableConfigsMobile" JSONB;
ALTER TABLE "Preferences" ADD COLUMN IF NOT EXISTS "detailConfigsMobile" JSONB;
