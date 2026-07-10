-- Installment.paymentMethod: free-form text -> dedicated enum.
-- Manual settlement vocabulary for receivable installments, kept separate from
-- PaymentMethod (Order/Payable billing) so owner-account / cash options never leak
-- into those dropdowns.

-- 1. New enum type.
CREATE TYPE "InstallmentPaymentMethod" AS ENUM (
  'PIX',
  'BANK_SLIP',
  'CASH',
  'TRANSFER',
  'ACCOUNT_GENIVALDO',
  'ACCOUNT_SERGIO',
  'MANUAL',
  'OTHER'
);

-- 2. Normalize legacy free-form values so the cast in step 3 cannot fail.
--    'BOLETO' was an earlier alias for boleto settlements (same meaning as BANK_SLIP).
UPDATE "Installment"
SET "paymentMethod" = 'BANK_SLIP'
WHERE "paymentMethod" = 'BOLETO';

--    Any other unexpected leftover value collapses to OTHER. This preserves the fact
--    that the parcela was paid (status/paidAt/paidAmount are untouched) while keeping
--    the cast total. Known-good values (PIX, BANK_SLIP, CASH, TRANSFER,
--    ACCOUNT_GENIVALDO, ACCOUNT_SERGIO, MANUAL, OTHER) and NULL are left as-is.
UPDATE "Installment"
SET "paymentMethod" = 'OTHER'
WHERE "paymentMethod" IS NOT NULL
  AND "paymentMethod" NOT IN (
    'PIX',
    'BANK_SLIP',
    'CASH',
    'TRANSFER',
    'ACCOUNT_GENIVALDO',
    'ACCOUNT_SERGIO',
    'MANUAL',
    'OTHER'
  );

-- 3. Convert the column type (nullable is preserved).
ALTER TABLE "Installment"
  ALTER COLUMN "paymentMethod" TYPE "InstallmentPaymentMethod"
  USING ("paymentMethod"::"InstallmentPaymentMethod");
