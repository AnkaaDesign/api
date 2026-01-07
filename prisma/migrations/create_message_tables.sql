-- Create Message table for announcements/messages
CREATE TABLE IF NOT EXISTS "Message" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" VARCHAR(200) NOT NULL,
  "contentBlocks" JSONB NOT NULL,
  "targetType" VARCHAR(50) NOT NULL CHECK ("targetType" IN ('ALL_USERS', 'SPECIFIC_USERS', 'SPECIFIC_ROLES')),
  "targetUserIds" TEXT[],
  "targetRoles" TEXT[],
  "priority" VARCHAR(20) NOT NULL DEFAULT 'NORMAL' CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMP,
  "endsAt" TIMESTAMP,
  "actionUrl" VARCHAR(500),
  "actionText" VARCHAR(100),
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "createdById" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE
);

-- Create MessageView table for tracking views
CREATE TABLE IF NOT EXISTS "MessageView" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "messageId" UUID NOT NULL REFERENCES "Message"(id) ON DELETE CASCADE,
  "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "viewedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE("messageId", "userId")
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "idx_message_targetType" ON "Message"("targetType");
CREATE INDEX IF NOT EXISTS "idx_message_isActive" ON "Message"("isActive");
CREATE INDEX IF NOT EXISTS "idx_message_priority" ON "Message"("priority");
CREATE INDEX IF NOT EXISTS "idx_message_createdAt" ON "Message"("createdAt");
CREATE INDEX IF NOT EXISTS "idx_message_startsAt" ON "Message"("startsAt");
CREATE INDEX IF NOT EXISTS "idx_message_endsAt" ON "Message"("endsAt");
CREATE INDEX IF NOT EXISTS "idx_message_createdById" ON "Message"("createdById");

CREATE INDEX IF NOT EXISTS "idx_messageview_messageId" ON "MessageView"("messageId");
CREATE INDEX IF NOT EXISTS "idx_messageview_userId" ON "MessageView"("userId");
CREATE INDEX IF NOT EXISTS "idx_messageview_viewedAt" ON "MessageView"("viewedAt");

-- Add comment for documentation
COMMENT ON TABLE "Message" IS 'Stores system messages and announcements with rich content and targeting options';
COMMENT ON TABLE "MessageView" IS 'Tracks which users have viewed which messages';
