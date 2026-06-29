-- Add per-user detail-page layout config (mirror of tableConfigsWeb).
--
-- `detailConfigsWeb` stores `{ [detailKey]: PersistedDetailConfig }` — the web
-- generic detail-page system's per-user layout (section order/visibility, field
-- visibility, collapsed, pinned sections). Nullable JSONB, no default, shape
-- validated client-side — identical approach to dashboardLayoutWeb / tableConfigsWeb.

-- AlterTable
ALTER TABLE "Preferences" ADD COLUMN "detailConfigsWeb" JSONB;
