-- Find all remaining old enum values

-- Check NotificationPreference
SELECT id, channels FROM "NotificationPreference" WHERE 'MOBILE_PUSH' = ANY(channels::text[]) OR 'DESKTOP_PUSH' = ANY(channels::text[]) OR 'SMS' = ANY(channels::text[]);

-- Check Notification
SELECT id, channel FROM "Notification" WHERE 'MOBILE_PUSH' = ANY(channel::text[]) OR 'DESKTOP_PUSH' = ANY(channel::text[]) OR 'SMS' = ANY(channel::text[]);

-- Check NotificationDelivery
SELECT id, channel FROM "NotificationDelivery" WHERE channel::text IN ('MOBILE_PUSH', 'DESKTOP_PUSH', 'SMS');
