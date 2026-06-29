-- Warehouse location code should be unique per setor (section), not globally,
-- so the same code (e.g. "E1") can be reused across different setores.
DROP INDEX IF EXISTS "WarehouseLocation_code_key";

CREATE UNIQUE INDEX IF NOT EXISTS "WarehouseLocation_section_code_key"
  ON "WarehouseLocation"("section", "code");
