-- Férias COLETIVAS + robustez das férias.
--
-- 1) VacationGroup / VacationGroupPeriod (férias coletivas, CLT art. 139-141).
-- 2) Vacation: groupId, deletedAt (soft-delete), userId nullable + FK SET NULL,
--    índice único PARCIAL do período aquisitivo (corrida) e novos índices.

-- =====================
-- Enum
-- =====================
CREATE TYPE "VacationGroupType" AS ENUM ('ALL', 'SECTOR', 'POSITION');

-- =====================
-- VacationGroup
-- =====================
CREATE TABLE "VacationGroup" (
  "id"               TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "type"             "VacationGroupType" NOT NULL,
  "acquisitiveStart" TIMESTAMP(3) NOT NULL,
  "acquisitiveEnd"   TIMESTAMP(3) NOT NULL,
  "concessiveEnd"    TIMESTAMP(3),
  "status"           "VacationStatus" NOT NULL DEFAULT 'OPEN',
  "statusOrder"      INTEGER NOT NULL DEFAULT 1,
  "sectorIds"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "positionIds"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"            TEXT,
  "deletedAt"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VacationGroup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VacationGroup_status_statusOrder_idx" ON "VacationGroup" ("status", "statusOrder");
CREATE INDEX "VacationGroup_acquisitiveEnd_idx" ON "VacationGroup" ("acquisitiveEnd");
CREATE INDEX "VacationGroup_deletedAt_idx" ON "VacationGroup" ("deletedAt");

-- =====================
-- VacationGroupPeriod (template periods)
-- =====================
CREATE TABLE "VacationGroupPeriod" (
  "id"        TEXT NOT NULL,
  "groupId"   TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "days"      INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VacationGroupPeriod_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VacationGroupPeriod_groupId_idx" ON "VacationGroupPeriod" ("groupId");
ALTER TABLE "VacationGroupPeriod"
  ADD CONSTRAINT "VacationGroupPeriod_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "VacationGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================
-- Vacation: new columns
-- =====================
ALTER TABLE "Vacation"
  ADD COLUMN "groupId"   TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

-- userId nullable + FK ON DELETE SET NULL (preserva passivo ao demitir).
ALTER TABLE "Vacation" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Vacation" DROP CONSTRAINT "Vacation_userId_fkey";
ALTER TABLE "Vacation"
  ADD CONSTRAINT "Vacation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- groupId FK ON DELETE SET NULL.
ALTER TABLE "Vacation"
  ADD CONSTRAINT "Vacation_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "VacationGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Vacation_groupId_idx" ON "Vacation" ("groupId");
CREATE INDEX "Vacation_deletedAt_idx" ON "Vacation" ("deletedAt");

-- Índice único PARCIAL: um período aquisitivo por colaborador, ignorando
-- registros soft-deleted (permite recriar) e órfãos (userId NULL). Garante
-- atomicidade contra criações concorrentes (P2002).
CREATE UNIQUE INDEX "Vacation_userId_acquisitive_unique"
  ON "Vacation" ("userId", "acquisitiveStart", "acquisitiveEnd")
  WHERE "deletedAt" IS NULL AND "userId" IS NOT NULL;
