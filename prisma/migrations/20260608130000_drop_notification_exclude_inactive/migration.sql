-- Inactive users must never receive notifications. The per-rule opt-out is removed:
-- exclusion is now unconditional in the dispatch pipeline, so the column is dropped.
ALTER TABLE "NotificationTargetRule" DROP COLUMN IF EXISTS "excludeInactive";
