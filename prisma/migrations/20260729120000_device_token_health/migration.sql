-- Device token health tracking.
--
-- Users accumulated 3-5 active tokens each (one live FCM token plus stale
-- ExponentPushToken rows from the retired Expo build). Nothing ever deactivated
-- them, so every push fanned out to tokens that could not deliver.

ALTER TABLE "DeviceToken"
  ADD COLUMN IF NOT EXISTS "deviceId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastRegisteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "lastSuccessAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastFailureAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deactivationReason" TEXT;

-- Seed liveness from the pre-existing updatedAt: until now the only writer to
-- these rows was the register endpoint, so updatedAt IS the last client check-in.
UPDATE "DeviceToken" SET "lastRegisteredAt" = "updatedAt";

CREATE INDEX IF NOT EXISTS "DeviceToken_userId_isActive_idx" ON "DeviceToken"("userId", "isActive");
CREATE INDEX IF NOT EXISTS "DeviceToken_deviceId_idx" ON "DeviceToken"("deviceId");

-- Push is FCM-only now: the Expo sending stack was removed. Tokens from the old
-- Expo build cannot be delivered to by anything, so they go rather than linger
-- as phantom "active devices". The register endpoint rejects new ones.
DELETE FROM "DeviceToken" WHERE "token" LIKE 'ExponentPushToken[%';
