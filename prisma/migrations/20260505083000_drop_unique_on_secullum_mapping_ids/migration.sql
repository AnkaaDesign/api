-- Drop unique constraints so multiple Ankaa Sectors can map to the same
-- Secullum Departamento (e.g., Produção 1 / 2 / 3 → Produção), and multiple
-- Positions can share one Função. The plain @@index lines remain in place.

DROP INDEX IF EXISTS "Sector_secullumDepartamentoId_key";
DROP INDEX IF EXISTS "Position_secullumFuncaoId_key";
