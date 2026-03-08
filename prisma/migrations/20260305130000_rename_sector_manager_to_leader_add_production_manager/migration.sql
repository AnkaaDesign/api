-- DropForeignKey
ALTER TABLE "Sector" DROP CONSTRAINT IF EXISTS "Sector_managerId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Sector_managerId_idx";

-- DropIndex
DROP INDEX IF EXISTS "Sector_managerId_key";

-- RenameColumn
ALTER TABLE "Sector" RENAME COLUMN "managerId" TO "leaderId";

-- CreateIndex
CREATE UNIQUE INDEX "Sector_leaderId_key" ON "Sector"("leaderId");

-- CreateIndex
CREATE INDEX "Sector_leaderId_idx" ON "Sector"("leaderId");

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "SectorPrivileges" ADD VALUE 'PRODUCTION_MANAGER';
