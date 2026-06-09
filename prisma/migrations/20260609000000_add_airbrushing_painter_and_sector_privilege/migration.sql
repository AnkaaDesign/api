-- AlterEnum
ALTER TYPE "SectorPrivileges" ADD VALUE IF NOT EXISTS 'AIRBRUSHING';

-- AlterTable
ALTER TABLE "Airbrushing" ADD COLUMN IF NOT EXISTS "painterId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Airbrushing_painterId_idx" ON "Airbrushing"("painterId");

-- AddForeignKey
ALTER TABLE "Airbrushing" ADD CONSTRAINT "Airbrushing_painterId_fkey" FOREIGN KEY ("painterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
