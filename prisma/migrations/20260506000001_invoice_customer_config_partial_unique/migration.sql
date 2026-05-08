-- Replace the global @unique on Invoice.customerConfigId with a partial unique index
-- that only enforces uniqueness for non-CANCELLED invoices.
-- This allows a new invoice to be created after an old one is cancelled (re-approval flow).

-- Drop the old Prisma-managed unique index
DROP INDEX IF EXISTS "Invoice_customerConfigId_key";

-- Create partial unique index: one non-cancelled invoice per customerConfig
CREATE UNIQUE INDEX "Invoice_customerConfigId_active_unique"
  ON "Invoice"("customerConfigId")
  WHERE status != 'CANCELLED';
