-- CreateEnum
CREATE TYPE "WarehouseLocationType" AS ENUM ('ESTANTE', 'ESTANTE_KANBAN', 'PAINEL', 'PALETE');

-- AlterTable
ALTER TABLE "WarehouseLocation"
    ADD COLUMN "type" "WarehouseLocationType" NOT NULL DEFAULT 'ESTANTE',
    ADD COLUMN "positionX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "positionY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "width" DOUBLE PRECISION NOT NULL DEFAULT 80,
    ADD COLUMN "height" DOUBLE PRECISION NOT NULL DEFAULT 40,
    ADD COLUMN "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "levels" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "columns" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Item"
    ADD COLUMN "locationLevel" INTEGER,
    ADD COLUMN "locationColumn" INTEGER;

-- CreateIndex
CREATE INDEX "WarehouseLocation_type_idx" ON "WarehouseLocation"("type");
