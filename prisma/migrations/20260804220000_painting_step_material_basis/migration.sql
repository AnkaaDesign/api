-- Base de consumo por linha de custo: permite mostrar o RENDIMENTO na tabela do
-- passo (quanto de chapa aquele material cobre) em vez de só a quantidade final.
ALTER TABLE "PaintingStepMaterial" ADD COLUMN     "basisQuantity" DOUBLE PRECISION,
ADD COLUMN     "basisUnit" TEXT;
