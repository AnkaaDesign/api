-- Drop the Order <-> File document relations EXCEPT receipts. These were Prisma implicit
-- many-to-many relations, each backed by a join table. We remove budgets / invoices /
-- reimbursements / invoiceReimbursements entirely and keep only receipts (_ORDER_RECEIPTS).
--
-- The join tables only hold the M2M links (FKs to "Order" and "File"); dropping them does
-- NOT delete any File rows. CASCADE clears the table's own FK constraints cleanly.

DROP TABLE IF EXISTS "_ORDER_BUDGETS" CASCADE;
DROP TABLE IF EXISTS "_ORDER_INVOICES" CASCADE;
DROP TABLE IF EXISTS "_ORDER_REIMBURSEMENTS" CASCADE;
DROP TABLE IF EXISTS "_ORDER_INVOICE_REIMBURSEMENTS" CASCADE;
