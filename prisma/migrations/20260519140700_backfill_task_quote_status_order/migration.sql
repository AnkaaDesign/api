-- Backfill TaskQuote.statusOrder so it matches TASK_QUOTE_STATUS_ORDER in
-- api/src/constants/sortOrders.ts. Legacy rows were left at the schema's
-- @default(1), which collides with DUE=1 and causes PENDING quotes to sort
-- before BUDGET_APPROVED when ordering by statusOrder ASC.

UPDATE "TaskQuote" SET "statusOrder" = CASE "status"
  WHEN 'DUE' THEN 1
  WHEN 'COMMERCIAL_APPROVED' THEN 2
  WHEN 'BUDGET_APPROVED' THEN 3
  WHEN 'BILLING_APPROVED' THEN 4
  WHEN 'UPCOMING' THEN 5
  WHEN 'PARTIAL' THEN 6
  WHEN 'SETTLED' THEN 7
  WHEN 'PENDING' THEN 8
  ELSE "statusOrder"
END;
