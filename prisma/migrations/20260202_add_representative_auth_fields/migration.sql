-- Add authentication fields to Representative table
ALTER TABLE "Representative" ADD COLUMN IF NOT EXISTS "verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Representative" ADD COLUMN IF NOT EXISTS "verificationCode" TEXT;
ALTER TABLE "Representative" ADD COLUMN IF NOT EXISTS "verificationExpiresAt" TIMESTAMP(3);
ALTER TABLE "Representative" ADD COLUMN IF NOT EXISTS "sessionToken" TEXT;
ALTER TABLE "Representative" ADD COLUMN IF NOT EXISTS "resetToken" TEXT;
ALTER TABLE "Representative" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP(3);

-- Rename lastLogin to lastLoginAt if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Representative' AND column_name = 'lastLogin') THEN
        ALTER TABLE "Representative" RENAME COLUMN "lastLogin" TO "lastLoginAt";
    END IF;
END $$;

-- Add unique constraints for tokens
CREATE UNIQUE INDEX IF NOT EXISTS "Representative_sessionToken_key" ON "Representative"("sessionToken");
CREATE UNIQUE INDEX IF NOT EXISTS "Representative_resetToken_key" ON "Representative"("resetToken");

-- Update default for id to match schema
ALTER TABLE "Representative" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
