-- Add billingApprovedAt to TaskQuote so the exact moment billing was approved is
-- recorded and used as the anchor for installment due date calculation.
ALTER TABLE "TaskQuote" ADD COLUMN "billingApprovedAt" TIMESTAMP(3);
