-- Per-user persisted configuration for the generic DataTable engine, stored as a
-- { [tableId]: config } JSON map on the existing Preferences row (same approach as
-- dashboardLayoutWeb). Validated client-side; no presets, so no separate table.

-- AlterTable
ALTER TABLE "Preferences" ADD COLUMN "tableConfigsWeb" JSONB;
