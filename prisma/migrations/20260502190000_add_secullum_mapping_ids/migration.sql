-- AlterTable: User
ALTER TABLE "User"
  ADD COLUMN "secullumEmployeeId"  INTEGER,
  ADD COLUMN "secullumSyncEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "User_secullumEmployeeId_key" ON "User"("secullumEmployeeId");

-- AlterTable: Sector
ALTER TABLE "Sector"
  ADD COLUMN "secullumDepartamentoId" INTEGER;

CREATE UNIQUE INDEX "Sector_secullumDepartamentoId_key" ON "Sector"("secullumDepartamentoId");
CREATE        INDEX "Sector_secullumDepartamentoId_idx" ON "Sector"("secullumDepartamentoId");

-- AlterTable: Position
ALTER TABLE "Position"
  ADD COLUMN "secullumFuncaoId" INTEGER;

CREATE UNIQUE INDEX "Position_secullumFuncaoId_key" ON "Position"("secullumFuncaoId");
CREATE        INDEX "Position_secullumFuncaoId_idx" ON "Position"("secullumFuncaoId");
