-- Update existing cuts with correct statusOrder based on their status
-- CUT_STATUS_ORDER: PENDING = 1, CUTTING = 2, COMPLETED = 3

UPDATE "Cut" SET "statusOrder" = 1 WHERE status = 'PENDING';
UPDATE "Cut" SET "statusOrder" = 2 WHERE status = 'CUTTING';
UPDATE "Cut" SET "statusOrder" = 3 WHERE status = 'COMPLETED';
