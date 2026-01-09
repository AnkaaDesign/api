-- AddMandatoryChannelsToNotificationPreferences
-- Add mandatoryChannels field to UserNotificationPreference to support channel-specific mandatory flags
-- This allows notifications to specify which channels (IN_APP, PUSH, WHATSAPP) must remain enabled
-- while allowing users to opt out of others (EMAIL)

-- Add the mandatoryChannels column as an array of NotificationChannel enum
ALTER TABLE "UserNotificationPreference" ADD COLUMN "mandatoryChannels" "NotificationChannel"[] DEFAULT ARRAY[]::"NotificationChannel"[];

-- For existing mandatory notifications (isMandatory = true), set mandatoryChannels to IN_APP, PUSH, WHATSAPP
-- This preserves the current behavior where mandatory notifications must be enabled
UPDATE "UserNotificationPreference"
SET "mandatoryChannels" = ARRAY['IN_APP', 'PUSH', 'WHATSAPP']::"NotificationChannel"[]
WHERE "isMandatory" = true;

-- Note: We keep isMandatory field for backwards compatibility
-- In the future it can be deprecated once all code uses mandatoryChannels
