-- Stock-management refactor, Phase 1 — schema groundwork.
-- Drops two dead Item flags (isManualReorderPoint has zero users; the 95 isManualMaxQuantity
-- rows are absorbed by the new PPE formula). Adds ordersLast12Months for the nightly
-- target-stock-days lookup, and a NotificationCooldown table for the 24h supplier-event throttle.

DROP INDEX IF EXISTS "Item_isManualMaxQuantity_idx";
DROP INDEX IF EXISTS "Item_isManualReorderPoint_idx";

ALTER TABLE "Item" DROP COLUMN IF EXISTS "isManualMaxQuantity";
ALTER TABLE "Item" DROP COLUMN IF EXISTS "isManualReorderPoint";

ALTER TABLE "Item" ADD COLUMN "ordersLast12Months" INTEGER;

CREATE TABLE "NotificationCooldown" (
    "id" TEXT NOT NULL,
    "cooldownKey" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationCooldown_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationCooldown_cooldownKey_key" ON "NotificationCooldown"("cooldownKey");
CREATE INDEX "NotificationCooldown_lastSentAt_idx" ON "NotificationCooldown"("lastSentAt");
