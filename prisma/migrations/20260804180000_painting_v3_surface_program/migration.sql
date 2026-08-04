-- Painting V3 — programa de superfície (pintura geral), sistemas de pintura com
-- catálise/diluição, sub-tarefas de passo e elementos por face.
-- Ver api/PAINTING_V3_WORKFLOW_SPEC.md

-- CreateEnum
CREATE TYPE "PaintingImplementKind" AS ENUM ('CARRETA', 'CARRETA_FRIGORIFICA', 'TRUCK', 'BAU', 'OUTRO');

-- CreateEnum
CREATE TYPE "PaintingCostLineKind" AS ENUM ('MATERIAL', 'MAO_DE_OBRA', 'SERVICO', 'EQUIPAMENTO');

-- CreateEnum
CREATE TYPE "PaintingMeasureBasis" AS ENUM ('AREA', 'LINEAR', 'VOLUME', 'UNIT', 'TIME');

-- CreateEnum
CREATE TYPE "PaintingCoatRole" AS ENUM ('GROUND', 'COLOR', 'CLEAR');

-- AlterEnum
ALTER TYPE "PaintingStepKind" ADD VALUE 'DESMONTAGEM';
ALTER TYPE "PaintingStepKind" ADD VALUE 'REMONTAGEM';
ALTER TYPE "PaintingStepKind" ADD VALUE 'PREPARACAO';
ALTER TYPE "PaintingStepKind" ADD VALUE 'SECAGEM';
ALTER TYPE "PaintingStepKind" ADD VALUE 'MASCARAMENTO';
ALTER TYPE "PaintingStepKind" ADD VALUE 'LIMPEZA_TETO';
ALTER TYPE "PaintingStepKind" ADD VALUE 'PINTURA_TETO';

-- AlterTable
ALTER TABLE "PaintingAnalysis" ADD COLUMN     "chassisLengthCm" DOUBLE PRECISION,
ADD COLUMN     "frameCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "framePerimeterCm" DOUBLE PRECISION,
ADD COLUMN     "generalPaint" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasThermoKing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "heightCm" DOUBLE PRECISION,
ADD COLUMN     "implementKind" "PaintingImplementKind" NOT NULL DEFAULT 'CARRETA',
ADD COLUMN     "lengthCm" DOUBLE PRECISION,
ADD COLUMN     "paintSystemKey" TEXT,
ADD COLUMN     "paintsRoof" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rearDoorCount" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "roofLengthCm" DOUBLE PRECISION,
ADD COLUMN     "roofWidthCm" DOUBLE PRECISION,
ADD COLUMN     "targetPaintId" TEXT,
ADD COLUMN     "widthCm" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "PaintingProductivityRate" ADD COLUMN     "crewSize" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PaintingStepMaterial" ADD COLUMN     "basis" "PaintingMeasureBasis" NOT NULL DEFAULT 'AREA',
ADD COLUMN     "crewSize" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "kind" "PaintingCostLineKind" NOT NULL DEFAULT 'MATERIAL',
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaintingStepTask" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "rateKey" TEXT,
    "basisQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "basisUnit" TEXT,
    "minutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minutesSource" "PaintingValueSource" NOT NULL DEFAULT 'AUTO',
    "crewSize" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintingStepTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintingPaintSystem" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "paintTypeId" TEXT,
    "coatsSchedule" JSONB NOT NULL,
    "mixBase" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "mixCatalyst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mixThinner" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "catalystItemId" TEXT,
    "thinnerItemId" TEXT,
    "coverageM2PerL" DOUBLE PRECISION NOT NULL DEFAULT 6,
    "sprayLossPct" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "prepLossPct" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "minBatchL" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "cureMinutes" DOUBLE PRECISION NOT NULL DEFAULT 180,
    "needsConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintingPaintSystem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintingElement" (
    "id" TEXT NOT NULL,
    "faceId" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "label" TEXT,
    "labelSource" "PaintingValueSource" NOT NULL DEFAULT 'AUTO',
    "xCm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "yCm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wCm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hCm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "areaM2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adhesiveAreaM2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paperAreaM2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "regionIds" JSONB,
    "colorIndexes" JSONB,
    "geometry" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintingElement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaintingStepTask_stepId_position_idx" ON "PaintingStepTask"("stepId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PaintingPaintSystem_key_key" ON "PaintingPaintSystem"("key");

-- CreateIndex
CREATE INDEX "PaintingElement_faceId_idx" ON "PaintingElement"("faceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaintingElement_faceId_engineId_key" ON "PaintingElement"("faceId", "engineId");

-- AddForeignKey
ALTER TABLE "PaintingAnalysis" ADD CONSTRAINT "PaintingAnalysis_targetPaintId_fkey" FOREIGN KEY ("targetPaintId") REFERENCES "Paint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingAnalysis" ADD CONSTRAINT "PaintingAnalysis_paintSystemKey_fkey" FOREIGN KEY ("paintSystemKey") REFERENCES "PaintingPaintSystem"("key") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingStepTask" ADD CONSTRAINT "PaintingStepTask_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PaintingProductionStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingPaintSystem" ADD CONSTRAINT "PaintingPaintSystem_paintTypeId_fkey" FOREIGN KEY ("paintTypeId") REFERENCES "PaintType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingPaintSystem" ADD CONSTRAINT "PaintingPaintSystem_catalystItemId_fkey" FOREIGN KEY ("catalystItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingPaintSystem" ADD CONSTRAINT "PaintingPaintSystem_thinnerItemId_fkey" FOREIGN KEY ("thinnerItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingElement" ADD CONSTRAINT "PaintingElement_faceId_fkey" FOREIGN KEY ("faceId") REFERENCES "PaintingAnalysisFace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
