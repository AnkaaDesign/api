-- CreateEnum
CREATE TYPE "PaintingAnalysisStatus" AS ENUM ('DRAFT', 'PROCESSING', 'REVIEW', 'APPROVED', 'ARCHIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaintingServiceContext" AS ENUM ('NEW_IMPLEMENT', 'REFORM');

-- CreateEnum
CREATE TYPE "PaintingSubstrate" AS ENUM ('CHAPA_FRISOS', 'ISOPLASTIC', 'SIDER_LONA', 'OUTRO');

-- CreateEnum
CREATE TYPE "PaintingFaceView" AS ENUM ('LEFT_SIDE', 'RIGHT_SIDE', 'BACK', 'FRONT', 'ROOF');

-- CreateEnum
CREATE TYPE "PaintingBackgroundMode" AS ENUM ('WHITE_PLATE', 'GENERAL_PAINT', 'SIDER_CANVAS');

-- CreateEnum
CREATE TYPE "PaintingRegionKind" AS ENUM ('CHAPADA', 'DEGRADE', 'FOTOGRAFICO', 'MICRO', 'TEXTURA', 'RESERVA');

-- CreateEnum
CREATE TYPE "PaintingStrategy" AS ENUM ('ADESIVO_RECORTE', 'FITA_CORTE', 'FITA_FLEXIVEL', 'STENCIL', 'CURA_ADESIVO', 'AEROGRAFIA', 'AEROGRAFIA_ARTISTICA', 'NENHUMA');

-- CreateEnum
CREATE TYPE "PaintingBoundaryKind" AS ENUM ('PAINT_PAINT', 'WITH_BACKGROUND', 'KEYLINE');

-- CreateEnum
CREATE TYPE "PaintingBoundaryResolution" AS ENUM ('FITA_CORTE', 'FITA_FLEXIVEL', 'CURA_ADESIVO', 'NENHUMA');

-- CreateEnum
CREATE TYPE "PaintingValueSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaintingStepKind" AS ENUM ('REMOCAO_ADESIVO_ANTIGO', 'REMOCAO_REFLETIVA', 'LAVAGEM', 'VEDACAO_PU', 'EMPAPELAMENTO', 'MASCARAMENTO_LIQUIDO', 'LIXAMENTO', 'FUNDO', 'PINTURA', 'VERNIZ', 'ADESIVO_PLOTAGEM', 'ADESIVO_DEPILACAO', 'ADESIVO_APLICACAO', 'FITA', 'CORTE', 'STENCIL', 'CURA', 'REMOCAO_MASCARA', 'AEROGRAFIA', 'APLICACAO_REFLETIVA', 'LIMPEZA', 'INSPECAO');

-- CreateEnum
CREATE TYPE "PaintingRateMode" AS ENUM ('M2_PER_MIN', 'M_PER_MIN', 'CM_PER_MIN', 'MIN_FIXED', 'MIN_PER_UNIT');

-- CreateEnum
CREATE TYPE "PaintingIndirectMode" AS ENUM ('FIXED', 'PER_HOUR', 'PER_M2', 'PCT_COST', 'PCT_PRICE');

-- CreateTable
CREATE TABLE "PaintingAnalysis" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PaintingAnalysisStatus" NOT NULL DEFAULT 'DRAFT',
    "engineVersion" TEXT,
    "serviceContext" "PaintingServiceContext" NOT NULL DEFAULT 'NEW_IMPLEMENT',
    "substrate" "PaintingSubstrate" NOT NULL DEFAULT 'CHAPA_FRISOS',
    "substrateSource" "PaintingValueSource" NOT NULL DEFAULT 'AUTO',
    "alreadyPrepared" BOOLEAN NOT NULL DEFAULT false,
    "taskId" TEXT,
    "implementMeasureId" TEXT,
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintingAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintingAnalysisFace" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "view" "PaintingFaceView" NOT NULL,
    "fileId" TEXT NOT NULL,
    "overlayFileId" TEXT,
    "referenceKind" TEXT NOT NULL,
    "referenceValueCm" DOUBLE PRECISION NOT NULL,
    "pxPerCm" DOUBLE PRECISION,
    "widthCm" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "areaM2" DOUBLE PRECISION,
    "backgroundMode" "PaintingBackgroundMode",
    "backgroundModeSource" "PaintingValueSource" NOT NULL DEFAULT 'AUTO',
    "backgroundHex" TEXT,
    "backgroundPaintId" TEXT,
    "engineArtifact" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintingAnalysisFace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintingRegion" (
    "id" TEXT NOT NULL,
    "faceId" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "colorHex" TEXT NOT NULL,
    "paintId" TEXT,
    "paintSource" "PaintingValueSource" NOT NULL DEFAULT 'AUTO',
    "kind" "PaintingRegionKind" NOT NULL,
    "kindSource" "PaintingValueSource" NOT NULL DEFAULT 'AUTO',
    "strategy" "PaintingStrategy",
    "strategySource" "PaintingValueSource" NOT NULL DEFAULT 'AUTO',
    "areaM2" DOUBLE PRECISION NOT NULL,
    "perimeterM" DOUBLE PRECISION NOT NULL,
    "islands" INTEGER NOT NULL DEFAULT 0,
    "minStrokeMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bboxWidthCm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bboxHeightCm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "geometry" JSONB,
    "gradient" JSONB,
    "autoSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintingRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintingBoundary" (
    "id" TEXT NOT NULL,
    "faceId" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "regionAId" TEXT NOT NULL,
    "regionBId" TEXT,
    "kind" "PaintingBoundaryKind" NOT NULL,
    "lengthM" DOUBLE PRECISION NOT NULL,
    "dominantCurve" TEXT,
    "curveHist" JSONB,
    "corners" INTEGER NOT NULL DEFAULT 0,
    "resolution" "PaintingBoundaryResolution",
    "resolutionSource" "PaintingValueSource" NOT NULL DEFAULT 'AUTO',
    "cutLengthM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tapeLengthM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "samplePath" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintingBoundary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintingAnalysisAlert" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaintingAnalysisAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintingProductionPlan" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "totalMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalWaitMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDays" INTEGER NOT NULL DEFAULT 0,
    "materialCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "laborCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "indirectCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "profitMarginPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "suggestedPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "laborRatePerHour" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "priceSnapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintingProductionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintingProductionStep" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "day" INTEGER NOT NULL DEFAULT 1,
    "session" INTEGER NOT NULL DEFAULT 0,
    "kind" "PaintingStepKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "faceId" TEXT,
    "regionIds" JSONB,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityUnit" TEXT,
    "rateUsed" DOUBLE PRECISION,
    "minutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minutesSource" "PaintingValueSource" NOT NULL DEFAULT 'AUTO',
    "waitMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "laborCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "materialCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "actualMinutes" DOUBLE PRECISION,
    "actualNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintingProductionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintingStepMaterial" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "itemId" TEXT,
    "paintId" TEXT,
    "label" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPriceSnapshot" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "source" "PaintingValueSource" NOT NULL DEFAULT 'AUTO',

    CONSTRAINT "PaintingStepMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintingProductivityRate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mode" "PaintingRateMode" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "complexityFactorMedium" DOUBLE PRECISION NOT NULL DEFAULT 1.3,
    "complexityFactorHigh" DOUBLE PRECISION NOT NULL DEFAULT 1.8,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintingProductivityRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintingIndirectCost" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mode" "PaintingIndirectMode" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintingIndirectCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintingStrategyRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintingStrategyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaintingProcessParameter" (
    "id" TEXT NOT NULL,
    "paintTypeId" TEXT,
    "coatsDefault" INTEGER NOT NULL DEFAULT 2,
    "coverageM2PerL" DOUBLE PRECISION NOT NULL DEFAULT 6,
    "sprayLossPct" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "prepLossPct" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "cureMinutes" DOUBLE PRECISION NOT NULL DEFAULT 180,
    "needsClearCoat" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaintingProcessParameter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaintingAnalysis_taskId_idx" ON "PaintingAnalysis"("taskId");

-- CreateIndex
CREATE INDEX "PaintingAnalysis_status_idx" ON "PaintingAnalysis"("status");

-- CreateIndex
CREATE INDEX "PaintingAnalysisFace_analysisId_idx" ON "PaintingAnalysisFace"("analysisId");

-- CreateIndex
CREATE UNIQUE INDEX "PaintingAnalysisFace_analysisId_view_key" ON "PaintingAnalysisFace"("analysisId", "view");

-- CreateIndex
CREATE INDEX "PaintingRegion_faceId_idx" ON "PaintingRegion"("faceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaintingRegion_faceId_engineId_key" ON "PaintingRegion"("faceId", "engineId");

-- CreateIndex
CREATE INDEX "PaintingBoundary_faceId_idx" ON "PaintingBoundary"("faceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaintingBoundary_faceId_engineId_key" ON "PaintingBoundary"("faceId", "engineId");

-- CreateIndex
CREATE INDEX "PaintingAnalysisAlert_analysisId_idx" ON "PaintingAnalysisAlert"("analysisId");

-- CreateIndex
CREATE UNIQUE INDEX "PaintingProductionPlan_analysisId_key" ON "PaintingProductionPlan"("analysisId");

-- CreateIndex
CREATE INDEX "PaintingProductionStep_planId_position_idx" ON "PaintingProductionStep"("planId", "position");

-- CreateIndex
CREATE INDEX "PaintingStepMaterial_stepId_idx" ON "PaintingStepMaterial"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "PaintingProductivityRate_key_key" ON "PaintingProductivityRate"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PaintingIndirectCost_key_key" ON "PaintingIndirectCost"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PaintingStrategyRule_key_key" ON "PaintingStrategyRule"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PaintingProcessParameter_paintTypeId_key" ON "PaintingProcessParameter"("paintTypeId");

-- AddForeignKey
ALTER TABLE "PaintingAnalysis" ADD CONSTRAINT "PaintingAnalysis_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingAnalysis" ADD CONSTRAINT "PaintingAnalysis_implementMeasureId_fkey" FOREIGN KEY ("implementMeasureId") REFERENCES "ImplementMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingAnalysisFace" ADD CONSTRAINT "PaintingAnalysisFace_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "PaintingAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingAnalysisFace" ADD CONSTRAINT "PaintingAnalysisFace_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingAnalysisFace" ADD CONSTRAINT "PaintingAnalysisFace_overlayFileId_fkey" FOREIGN KEY ("overlayFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingAnalysisFace" ADD CONSTRAINT "PaintingAnalysisFace_backgroundPaintId_fkey" FOREIGN KEY ("backgroundPaintId") REFERENCES "Paint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingRegion" ADD CONSTRAINT "PaintingRegion_faceId_fkey" FOREIGN KEY ("faceId") REFERENCES "PaintingAnalysisFace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingRegion" ADD CONSTRAINT "PaintingRegion_paintId_fkey" FOREIGN KEY ("paintId") REFERENCES "Paint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingBoundary" ADD CONSTRAINT "PaintingBoundary_faceId_fkey" FOREIGN KEY ("faceId") REFERENCES "PaintingAnalysisFace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingAnalysisAlert" ADD CONSTRAINT "PaintingAnalysisAlert_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "PaintingAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingProductionPlan" ADD CONSTRAINT "PaintingProductionPlan_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "PaintingAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingProductionStep" ADD CONSTRAINT "PaintingProductionStep_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PaintingProductionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingStepMaterial" ADD CONSTRAINT "PaintingStepMaterial_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PaintingProductionStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingStepMaterial" ADD CONSTRAINT "PaintingStepMaterial_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingStepMaterial" ADD CONSTRAINT "PaintingStepMaterial_paintId_fkey" FOREIGN KEY ("paintId") REFERENCES "Paint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaintingProcessParameter" ADD CONSTRAINT "PaintingProcessParameter_paintTypeId_fkey" FOREIGN KEY ("paintTypeId") REFERENCES "PaintType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
