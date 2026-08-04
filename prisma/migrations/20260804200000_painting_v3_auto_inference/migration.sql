-- Painting V3 — o orçamento vira automático: largura, teto, chassi, frames, portas
-- e Thermo King passam a ser INFERIDOS (regra IMPLEMENT_DEFAULTS + substrato), e a
-- pintura geral/cor final saem da própria arte. Só comprimento e altura são digitados.

-- AlterTable
ALTER TABLE "PaintingAnalysis" DROP COLUMN "chassisLengthCm",
DROP COLUMN "frameCount",
DROP COLUMN "framePerimeterCm",
DROP COLUMN "hasThermoKing",
DROP COLUMN "implementKind",
DROP COLUMN "paintsRoof",
DROP COLUMN "rearDoorCount",
DROP COLUMN "roofLengthCm",
DROP COLUMN "roofWidthCm",
DROP COLUMN "widthCm";

-- DropEnum
DROP TYPE "PaintingImplementKind";
