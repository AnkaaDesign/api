-- Notification read-state performance indexes.
--
-- 1) Notification(userId, createdAt): the notification center and every
--    per-user list query filter on userId and ORDER BY "createdAt" DESC. The
--    pre-existing single-column index on userId cannot serve the sort, so
--    Postgres had to sort the whole per-user partition on every page.
--
-- 2) SeenNotification(notificationId): the read-state probes
--    (`seenBy: { none: { userId } }`, `some: { userId }`) and the ON DELETE
--    CASCADE from Notification all look rows up by notificationId. The existing
--    unique index is (userId, notificationId), so notificationId is the
--    trailing column and is not usable on its own.
--
-- CONCURRENTLY is intentionally NOT used: prisma migrate runs each migration
-- inside a transaction, and CREATE INDEX CONCURRENTLY cannot run there. Both
-- tables are small enough (tens of thousands of rows) that the brief write lock
-- is acceptable. If the tables have grown, run these two statements manually
-- with CONCURRENTLY first — IF NOT EXISTS then makes this migration a no-op.

CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "SeenNotification_notificationId_idx" ON "SeenNotification"("notificationId");
