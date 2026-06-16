-- Durable NF↔task linkage: a note is never unlinked/deleted when its invoice is removed.
-- Add taskId, make invoiceId nullable, swap invoice FK to SetNull, backfill taskId.

ALTER TABLE "NfseDocument" ADD COLUMN IF NOT EXISTS "taskId" TEXT;
ALTER TABLE "NfseDocument" ALTER COLUMN "invoiceId" DROP NOT NULL;

-- Backfill taskId from the linked invoice's task
UPDATE "NfseDocument" nd
SET "taskId" = i."taskId"
FROM "Invoice" i
WHERE nd."invoiceId" = i.id AND nd."taskId" IS NULL AND i."taskId" IS NOT NULL;

-- Swap invoice FK Cascade -> SetNull
ALTER TABLE "NfseDocument" DROP CONSTRAINT IF EXISTS "NfseDocument_invoiceId_fkey";
ALTER TABLE "NfseDocument"
  ADD CONSTRAINT "NfseDocument_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- New task FK (SetNull)
ALTER TABLE "NfseDocument"
  ADD CONSTRAINT "NfseDocument_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "NfseDocument_taskId_idx" ON "NfseDocument"("taskId");
