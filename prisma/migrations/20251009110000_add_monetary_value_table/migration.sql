-- CreateTable
CREATE TABLE IF NOT EXISTS "MonetaryValue" (
    "id" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "itemId" TEXT,
    "positionId" TEXT,

    CONSTRAINT "MonetaryValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MonetaryValue_current_idx" ON "MonetaryValue"("current");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MonetaryValue_itemId_idx" ON "MonetaryValue"("itemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MonetaryValue_positionId_idx" ON "MonetaryValue"("positionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MonetaryValue_itemId_current_idx" ON "MonetaryValue"("itemId", "current");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MonetaryValue_positionId_current_idx" ON "MonetaryValue"("positionId", "current");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MonetaryValue_itemId_fkey'
  ) THEN
    ALTER TABLE "MonetaryValue" ADD CONSTRAINT "MonetaryValue_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MonetaryValue_positionId_fkey'
  ) THEN
    ALTER TABLE "MonetaryValue" ADD CONSTRAINT "MonetaryValue_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
