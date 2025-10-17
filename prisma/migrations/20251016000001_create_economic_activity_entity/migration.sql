-- CreateTable
CREATE TABLE "EconomicActivity" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EconomicActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EconomicActivity_code_key" ON "EconomicActivity"("code");

-- CreateIndex
CREATE INDEX "EconomicActivity_code_idx" ON "EconomicActivity"("code");

-- CreateIndex
CREATE INDEX "EconomicActivity_description_idx" ON "EconomicActivity"("description");
