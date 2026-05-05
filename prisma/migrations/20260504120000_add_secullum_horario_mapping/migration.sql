-- AlterTable: Sector — add default horario for sector
ALTER TABLE "Sector"
  ADD COLUMN "secullumHorarioId" INTEGER;

-- AlterTable: User — add per-user horario override
ALTER TABLE "User"
  ADD COLUMN "secullumHorarioId" INTEGER;
