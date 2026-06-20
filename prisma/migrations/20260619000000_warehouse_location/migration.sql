-- CreateTable
CREATE TABLE "WarehouseLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "section" TEXT,
    "code" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Item" ADD COLUMN "warehouseLocationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_code_key" ON "WarehouseLocation"("code");

-- CreateIndex
CREATE INDEX "WarehouseLocation_name_idx" ON "WarehouseLocation"("name");

-- CreateIndex
CREATE INDEX "WarehouseLocation_section_idx" ON "WarehouseLocation"("section");

-- CreateIndex
CREATE INDEX "WarehouseLocation_isActive_idx" ON "WarehouseLocation"("isActive");

-- CreateIndex
CREATE INDEX "Item_warehouseLocationId_idx" ON "Item"("warehouseLocationId");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_warehouseLocationId_fkey" FOREIGN KEY ("warehouseLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
