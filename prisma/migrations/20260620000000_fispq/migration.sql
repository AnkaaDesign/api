-- CreateEnum
CREATE TYPE "GhsPictogram" AS ENUM ('GHS01_EXPLOSIVE', 'GHS02_FLAMMABLE', 'GHS03_OXIDIZING', 'GHS04_GAS_UNDER_PRESSURE', 'GHS05_CORROSIVE', 'GHS06_TOXIC', 'GHS07_HARMFUL', 'GHS08_HEALTH_HAZARD', 'GHS09_ENVIRONMENTAL');

-- CreateEnum
CREATE TYPE "GhsSignalWord" AS ENUM ('DANGER', 'WARNING');

-- CreateEnum
CREATE TYPE "FispqStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "ChangeLogEntityType" ADD VALUE 'FISPQ';

-- CreateTable
CREATE TABLE "Fispq" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "productName" TEXT,
    "manufacturer" TEXT,
    "supplierName" TEXT,
    "recommendedUse" TEXT,
    "emergencyPhone" TEXT,
    "ghsPictograms" "GhsPictogram"[] DEFAULT ARRAY[]::"GhsPictogram"[],
    "signalWord" "GhsSignalWord",
    "hazardStatements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "precautionStatements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "casNumber" TEXT,
    "onuNumber" TEXT,
    "unRiskClass" TEXT,
    "packingGroup" TEXT,
    "physicalState" TEXT,
    "color" TEXT,
    "odor" TEXT,
    "flashPoint" TEXT,
    "phValue" TEXT,
    "firstAidMeasures" TEXT,
    "fireFightingMeasures" TEXT,
    "accidentalRelease" TEXT,
    "handlingStorage" TEXT,
    "requiredPpeText" TEXT,
    "pdfFileId" TEXT,
    "revisionNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "revisionDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "status" "FispqStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fispq_pkey" PRIMARY KEY ("id")
);

-- CreateTable (implicit m2m Fispq.requiredPpeItems <-> Item.requiredByFispqs)
CREATE TABLE "_FISPQ_REQUIRED_PPE" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Fispq_itemId_key" ON "Fispq"("itemId");

-- CreateIndex
CREATE INDEX "Fispq_itemId_idx" ON "Fispq"("itemId");

-- CreateIndex
CREATE INDEX "Fispq_validUntil_idx" ON "Fispq"("validUntil");

-- CreateIndex
CREATE INDEX "Fispq_status_idx" ON "Fispq"("status");

-- CreateIndex
CREATE INDEX "Fispq_casNumber_idx" ON "Fispq"("casNumber");

-- CreateIndex
CREATE INDEX "Fispq_onuNumber_idx" ON "Fispq"("onuNumber");

-- CreateIndex
CREATE INDEX "Fispq_pdfFileId_idx" ON "Fispq"("pdfFileId");

-- CreateIndex
CREATE UNIQUE INDEX "_FISPQ_REQUIRED_PPE_AB_unique" ON "_FISPQ_REQUIRED_PPE"("A", "B");

-- CreateIndex
CREATE INDEX "_FISPQ_REQUIRED_PPE_B_index" ON "_FISPQ_REQUIRED_PPE"("B");

-- AddForeignKey
ALTER TABLE "Fispq" ADD CONSTRAINT "Fispq_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fispq" ADD CONSTRAINT "Fispq_pdfFileId_fkey" FOREIGN KEY ("pdfFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FISPQ_REQUIRED_PPE" ADD CONSTRAINT "_FISPQ_REQUIRED_PPE_A_fkey" FOREIGN KEY ("A") REFERENCES "Fispq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FISPQ_REQUIRED_PPE" ADD CONSTRAINT "_FISPQ_REQUIRED_PPE_B_fkey" FOREIGN KEY ("B") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
