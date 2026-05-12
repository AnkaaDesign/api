-- Migrate Installment from single receiptFile (1:1) to many receipts (M2M)
-- and add a per-installment observations text field.
--
-- Safe rollout order:
--   1. Add observations column.
--   2. Create the new join table.
--   3. Backfill the join table from existing receiptFileId values.
--   4. Drop the old FK + column.

-- 1. Add observations column on Installment.
ALTER TABLE "Installment" ADD COLUMN "observations" TEXT;

-- 2. Create the implicit M2M join table for File <-> Installment receipts.
CREATE TABLE "_InstallmentReceipts" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_InstallmentReceipts_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_InstallmentReceipts_B_index" ON "_InstallmentReceipts"("B");

ALTER TABLE "_InstallmentReceipts" ADD CONSTRAINT "_InstallmentReceipts_A_fkey" FOREIGN KEY ("A") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_InstallmentReceipts" ADD CONSTRAINT "_InstallmentReceipts_B_fkey" FOREIGN KEY ("B") REFERENCES "Installment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Backfill: every installment that currently has a receiptFileId becomes a row
--    in the join table. A = File.id, B = Installment.id (Prisma's alphabetical ordering).
INSERT INTO "_InstallmentReceipts" ("A", "B")
SELECT "receiptFileId", "id"
FROM "Installment"
WHERE "receiptFileId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- 4. Drop the old single-receipt foreign key and column.
ALTER TABLE "Installment" DROP CONSTRAINT "Installment_receiptFileId_fkey";

ALTER TABLE "Installment" DROP COLUMN "receiptFileId";
