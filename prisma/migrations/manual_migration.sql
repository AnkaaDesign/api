-- Manual Migration Script
-- Migrate old NotificationChannel enum values to new ones

-- Update NotificationPreference.channels
UPDATE "NotificationPreference"
SET channels = array_replace(channels::text[], 'MOBILE_PUSH', 'PUSH')::"NotificationChannel"[]
WHERE 'MOBILE_PUSH' = ANY(channels::text[]);

UPDATE "NotificationPreference"
SET channels = array_replace(channels::text[], 'DESKTOP_PUSH', 'IN_APP')::"NotificationChannel"[]
WHERE 'DESKTOP_PUSH' = ANY(channels::text[]);

UPDATE "NotificationPreference"
SET channels = array_replace(channels::text[], 'SMS', 'WHATSAPP')::"NotificationChannel"[]
WHERE 'SMS' = ANY(channels::text[]);

-- Update Notification.channel
UPDATE "Notification"
SET channel = array_replace(channel::text[], 'MOBILE_PUSH', 'PUSH')::"NotificationChannel"[]
WHERE 'MOBILE_PUSH' = ANY(channel::text[]);

UPDATE "Notification"
SET channel = array_replace(channel::text[], 'DESKTOP_PUSH', 'IN_APP')::"NotificationChannel"[]
WHERE 'DESKTOP_PUSH' = ANY(channel::text[]);

UPDATE "Notification"
SET channel = array_replace(channel::text[], 'SMS', 'WHATSAPP')::"NotificationChannel"[]
WHERE 'SMS' = ANY(channel::text[]);

-- Update Notification.deliveredChannels
UPDATE "Notification"
SET "deliveredChannels" = array_replace("deliveredChannels"::text[], 'MOBILE_PUSH', 'PUSH')::"NotificationChannel"[]
WHERE 'MOBILE_PUSH' = ANY("deliveredChannels"::text[]);

UPDATE "Notification"
SET "deliveredChannels" = array_replace("deliveredChannels"::text[], 'DESKTOP_PUSH', 'IN_APP')::"NotificationChannel"[]
WHERE 'DESKTOP_PUSH' = ANY("deliveredChannels"::text[]);

UPDATE "Notification"
SET "deliveredChannels" = array_replace("deliveredChannels"::text[], 'SMS', 'WHATSAPP')::"NotificationChannel"[]
WHERE 'SMS' = ANY("deliveredChannels"::text[]);

-- Update Notification.failedChannels
UPDATE "Notification"
SET "failedChannels" = array_replace("failedChannels"::text[], 'MOBILE_PUSH', 'PUSH')::"NotificationChannel"[]
WHERE 'MOBILE_PUSH' = ANY("failedChannels"::text[]);

UPDATE "Notification"
SET "failedChannels" = array_replace("failedChannels"::text[], 'DESKTOP_PUSH', 'IN_APP')::"NotificationChannel"[]
WHERE 'DESKTOP_PUSH' = ANY("failedChannels"::text[]);

UPDATE "Notification"
SET "failedChannels" = array_replace("failedChannels"::text[], 'SMS', 'WHATSAPP')::"NotificationChannel"[]
WHERE 'SMS' = ANY("failedChannels"::text[]);

-- Update NotificationDelivery.channel (single value, not array)
UPDATE "NotificationDelivery"
SET channel = 'PUSH'
WHERE channel::text = 'MOBILE_PUSH';

UPDATE "NotificationDelivery"
SET channel = 'IN_APP'
WHERE channel::text = 'DESKTOP_PUSH';

UPDATE "NotificationDelivery"
SET channel = 'WHATSAPP'
WHERE channel::text = 'SMS';
