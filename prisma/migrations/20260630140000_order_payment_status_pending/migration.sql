-- New PENDING pre-payable state for orders. Orders are now created in PENDING
-- (an upcoming, non-payable "expected" row in Contas a Pagar); an ADMIN presses
-- "Requisitar Pagamento" to move PENDING -> AWAITING_PAYMENT, making the order
-- payable by accounting. Enum-value ADD is non-destructive; existing rows keep
-- their current value (the create path sets the status explicitly, and the column
-- default stays AWAITING_PAYMENT). Placed BEFORE AWAITING_PAYMENT to match the
-- schema's declared order (display/sort uses the integer paymentStatusOrder, so DB
-- enum position is cosmetic).
ALTER TYPE "OrderPaymentStatus" ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'AWAITING_PAYMENT';
