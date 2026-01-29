-- CreateTable: PpeScheduleItem - relational table for PPE schedule items
CREATE TABLE "PpeScheduleItem" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "ppeType" "PpeType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "itemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PpeScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Performance indexes
CREATE INDEX "PpeScheduleItem_scheduleId_idx" ON "PpeScheduleItem"("scheduleId");
CREATE INDEX "PpeScheduleItem_ppeType_idx" ON "PpeScheduleItem"("ppeType");
CREATE INDEX "PpeScheduleItem_itemId_idx" ON "PpeScheduleItem"("itemId");

-- CreateIndex: Unique constraint - one entry per (scheduleId, ppeType, itemId) combination
CREATE UNIQUE INDEX "PpeScheduleItem_scheduleId_ppeType_itemId_key" ON "PpeScheduleItem"("scheduleId", "ppeType", "itemId");

-- AddForeignKey: Reference to PpeDeliverySchedule (cascade delete)
ALTER TABLE "PpeScheduleItem" ADD CONSTRAINT "PpeScheduleItem_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "PpeDeliverySchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Reference to Item (set null on delete)
ALTER TABLE "PpeScheduleItem" ADD CONSTRAINT "PpeScheduleItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate existing JSON data to the new relation table
INSERT INTO "PpeScheduleItem" ("id", "scheduleId", "ppeType", "quantity", "itemId", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    s.id,
    (item->>'ppeType')::"PpeType",
    COALESCE((item->>'quantity')::integer, 1),
    NULLIF(item->>'itemId', ''),
    NOW(),
    NOW()
FROM "PpeDeliverySchedule" s,
     jsonb_array_elements(s."ppeItems"::jsonb) AS item
WHERE s."ppeItems" IS NOT NULL
  AND s."ppeItems"::text != '[]'
  AND s."ppeItems"::text != 'null';

-- Drop the legacy JSON column
ALTER TABLE "PpeDeliverySchedule" DROP COLUMN "ppeItems";
