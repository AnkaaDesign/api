-- Remove any column defaults that might reference old enum values
-- and update any remaining data

-- First, let's update any remaining data that might have old enum values
-- For arrays, we need to handle them carefully

-- Force update all NotificationPreference records
UPDATE "NotificationPreference"
SET channels = ARRAY['IN_APP', 'PUSH', 'EMAIL', 'WHATSAPP']::"NotificationChannel"[]
WHERE channels IS NULL OR array_length(channels, 1) IS NULL;

-- Force remove old values from NotificationPreference
UPDATE "NotificationPreference"
SET channels = array_remove(array_remove(array_remove(channels::text[], 'MOBILE_PUSH'), 'DESKTOP_PUSH'), 'SMS')::"NotificationChannel"[]
WHERE channels IS NOT NULL;

-- Force remove old values from Notification.channel
UPDATE "Notification"
SET channel = array_remove(array_remove(array_remove(channel::text[], 'MOBILE_PUSH'), 'DESKTOP_PUSH'), 'SMS')::"NotificationChannel"[]
WHERE channel IS NOT NULL;

-- Force remove old values from Notification.deliveredChannels
UPDATE "Notification"
SET "deliveredChannels" = array_remove(array_remove(array_remove("deliveredChannels"::text[], 'MOBILE_PUSH'), 'DESKTOP_PUSH'), 'SMS')::"NotificationChannel"[]
WHERE "deliveredChannels" IS NOT NULL;

-- Force remove old values from Notification.failedChannels
UPDATE "Notification"
SET "failedChannels" = array_remove(array_remove(array_remove("failedChannels"::text[], 'MOBILE_PUSH'), 'DESKTOP_PUSH'), 'SMS')::"NotificationChannel"[]
WHERE "failedChannels" IS NOT NULL;

-- Force update NotificationDelivery
UPDATE "NotificationDelivery"
SET channel = 'PUSH'
WHERE channel::text IN ('MOBILE_PUSH', 'DESKTOP_PUSH', 'SMS');
