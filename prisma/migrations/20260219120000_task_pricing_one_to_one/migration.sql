-- TaskPricing: One-to-Many → One-to-One Migration
-- Each Task gets its own unique TaskPricing. Shared pricings are duplicated.

-- Step 1: Orphan TaskPricings (no task pointing to them) are kept as-is.
-- They preserve budget number history and the unique constraint on Task.pricingId
-- won't conflict since orphan pricings have no task rows.

-- Step 2: Duplicate shared pricings so each task has its own copy.
DO $$
DECLARE
  rec RECORD;
  new_pricing_id UUID;
  next_budget_number INT;
  new_item_id UUID;
  item_rec RECORD;
  join_rec RECORD;
BEGIN
  -- Loop over tasks that share a pricingId with another task (rn > 1 keeps original for first task)
  FOR rec IN
    SELECT t."id" AS task_id, t."pricingId" AS old_pricing_id
    FROM (
      SELECT "id", "pricingId",
             ROW_NUMBER() OVER (PARTITION BY "pricingId" ORDER BY "createdAt") AS rn
      FROM "Task"
      WHERE "pricingId" IS NOT NULL
    ) t
    WHERE t.rn > 1
  LOOP
    -- Generate new UUID for the duplicated pricing
    new_pricing_id := gen_random_uuid();

    -- Get next sequential budgetNumber
    SELECT COALESCE(MAX("budgetNumber"), 0) + 1 INTO next_budget_number FROM "TaskPricing";

    -- Copy the TaskPricing row
    INSERT INTO "TaskPricing" (
      "id", "budgetNumber", "subtotal", "discountType", "discountValue",
      "total", "expiresAt", "status", "paymentCondition", "downPaymentDate",
      "customPaymentText", "guaranteeYears", "customGuaranteeText",
      "layoutFileId", "createdAt", "updatedAt", "customerSignatureId",
      "customForecastDays", "simultaneousTasks", "discountReference"
    )
    SELECT
      new_pricing_id, next_budget_number, "subtotal", "discountType", "discountValue",
      "total", "expiresAt", "status", "paymentCondition", "downPaymentDate",
      "customPaymentText", "guaranteeYears", "customGuaranteeText",
      "layoutFileId", NOW(), NOW(), "customerSignatureId",
      "customForecastDays", "simultaneousTasks", "discountReference"
    FROM "TaskPricing"
    WHERE "id" = rec.old_pricing_id;

    -- Copy all TaskPricingItem rows
    FOR item_rec IN
      SELECT * FROM "TaskPricingItem" WHERE "pricingId" = rec.old_pricing_id
    LOOP
      new_item_id := gen_random_uuid();
      INSERT INTO "TaskPricingItem" (
        "id", "description", "amount", "pricingId", "createdAt", "updatedAt",
        "observation", "shouldSync", "position"
      )
      VALUES (
        new_item_id, item_rec."description", item_rec."amount", new_pricing_id,
        NOW(), NOW(), item_rec."observation", item_rec."shouldSync", item_rec."position"
      );
    END LOOP;

    -- Copy _TaskPricingInvoiceTo join rows ("A" = Customer ID, "B" = TaskPricing ID)
    FOR join_rec IN
      SELECT "A" FROM "_TaskPricingInvoiceTo" WHERE "B" = rec.old_pricing_id
    LOOP
      INSERT INTO "_TaskPricingInvoiceTo" ("A", "B")
      VALUES (join_rec."A", new_pricing_id);
    END LOOP;

    -- Point the task to the new pricing copy
    UPDATE "Task" SET "pricingId" = new_pricing_id WHERE "id" = rec.task_id;
  END LOOP;
END $$;

-- Step 3: Add unique constraint on Task.pricingId (PostgreSQL allows multiple NULLs)
CREATE UNIQUE INDEX "Task_pricingId_key" ON "Task"("pricingId");

-- Step 4: Drop the old non-unique index (replaced by unique index above)
DROP INDEX IF EXISTS "Task_pricingId_idx";
