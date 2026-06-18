-- Boleto payment flexibility: first parcela due date is now user-chosen.
-- `paymentDueDays` keeps meaning the interval (steps, in days) between parcelas;
-- `paymentFirstDueDate` is the chosen due date of the 1st parcela.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentFirstDueDate" TIMESTAMP(3);
