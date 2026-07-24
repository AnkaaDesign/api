-- Attention system — server-side acknowledge / cooldown state (cross-device).
-- Isolated by design: no FK to User. See api/docs/attention-server-side.md.
CREATE TABLE "AttentionAck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "snoozeUntil" TIMESTAMP(3),
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttentionAck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AttentionAck_userId_idx" ON "AttentionAck"("userId");

CREATE UNIQUE INDEX "AttentionAck_userId_ruleId_entityId_key" ON "AttentionAck"("userId", "ruleId", "entityId");
