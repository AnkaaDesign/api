-- Order payment workflow redesign
-- ---------------------------------
-- 1. Collapse OrderPaymentStatus to AWAITING_PAYMENT / PARTIALLY_PAID / PAID
--    (drop the legacy NOT_REQUESTED / REQUESTED "solicitar pagamento" steps).
-- 2. First-class payment installments (OrderInstallment) for boleto 2x/3x.
-- 3. Order <-> FiscalDocument link so boleto installments settle via reconciliation.
-- 4. paidById (who settled) + installmentCount on Order.
-- 5. Backfill: legacy received-but-unpaid PIX/CREDIT_CARD/unspecified orders -> PAID.
--
-- Hand-written (not `prisma migrate diff` output) to avoid touching pre-existing
-- schema drift (order_number_seq, supplier_number_seq, Goal index, etc.).

-- CreateEnum
CREATE TYPE "OrderInstallmentStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- AlterEnum: OrderPaymentStatus -> {AWAITING_PAYMENT, PARTIALLY_PAID, PAID}
BEGIN;
-- Map legacy values onto one present in BOTH old and new enums before the swap,
-- otherwise the USING cast below fails on NOT_REQUESTED / REQUESTED rows.
UPDATE "Order" SET "paymentStatus" = 'AWAITING_PAYMENT'
  WHERE "paymentStatus" IN ('NOT_REQUESTED', 'REQUESTED');
CREATE TYPE "OrderPaymentStatus_new" AS ENUM ('AWAITING_PAYMENT', 'PARTIALLY_PAID', 'PAID');
ALTER TABLE "Order" ALTER COLUMN "paymentStatus" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "paymentStatus" TYPE "OrderPaymentStatus_new"
  USING ("paymentStatus"::text::"OrderPaymentStatus_new");
ALTER TYPE "OrderPaymentStatus" RENAME TO "OrderPaymentStatus_old";
ALTER TYPE "OrderPaymentStatus_new" RENAME TO "OrderPaymentStatus";
DROP TYPE "OrderPaymentStatus_old";
ALTER TABLE "Order" ALTER COLUMN "paymentStatus" SET DEFAULT 'AWAITING_PAYMENT';
COMMIT;

-- AlterTable
ALTER TABLE "Order"
  ADD COLUMN "installmentCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "paidById" TEXT;

-- CreateTable
CREATE TABLE "OrderInstallment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3),
    "amount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "OrderInstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ORDER_FISCAL_DOCUMENTS" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ORDER_FISCAL_DOCUMENTS_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "OrderInstallment_orderId_idx" ON "OrderInstallment"("orderId");
CREATE INDEX "OrderInstallment_status_idx" ON "OrderInstallment"("status");
CREATE INDEX "OrderInstallment_dueDate_idx" ON "OrderInstallment"("dueDate");
CREATE INDEX "OrderInstallment_paidById_idx" ON "OrderInstallment"("paidById");
CREATE UNIQUE INDEX "OrderInstallment_orderId_number_key" ON "OrderInstallment"("orderId", "number");
CREATE INDEX "_ORDER_FISCAL_DOCUMENTS_B_index" ON "_ORDER_FISCAL_DOCUMENTS"("B");
CREATE INDEX "Order_paidById_idx" ON "Order"("paidById");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_paidById_fkey"
  FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderInstallment" ADD CONSTRAINT "OrderInstallment_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderInstallment" ADD CONSTRAINT "OrderInstallment_paidById_fkey"
  FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "_ORDER_FISCAL_DOCUMENTS" ADD CONSTRAINT "_ORDER_FISCAL_DOCUMENTS_A_fkey"
  FOREIGN KEY ("A") REFERENCES "FiscalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ORDER_FISCAL_DOCUMENTS" ADD CONSTRAINT "_ORDER_FISCAL_DOCUMENTS_B_fkey"
  FOREIGN KEY ("B") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recompute paymentStatusOrder for the new ordering.
UPDATE "Order" SET "paymentStatusOrder" = CASE "paymentStatus"
  WHEN 'AWAITING_PAYMENT' THEN 1
  WHEN 'PARTIALLY_PAID'   THEN 2
  WHEN 'PAID'             THEN 3
  ELSE 1 END;

-- Backfill: orders that already reached fulfilment but were never marked paid.
-- For PIX / CREDIT_CARD / unspecified method, "fulfilled-or-beyond" implies the
-- bill was settled (payment precedes receipt in those flows), so mark them PAID
-- and stamp paidAt from the latest item receivedAt (fallback updatedAt).
-- BANK_SLIP orders are intentionally excluded: fulfilled-but-owing is legitimate
-- for installment boletos and must stay visible in Contas a Pagar.
UPDATE "Order" o SET
  "paymentStatus" = 'PAID',
  "paymentStatusOrder" = 3,
  "paidAt" = COALESCE(
    (SELECT MAX(oi."receivedAt") FROM "OrderItem" oi WHERE oi."orderId" = o."id"),
    o."updatedAt"
  )
WHERE o."status" IN ('FULFILLED', 'PARTIALLY_RECEIVED', 'RECEIVED')
  AND o."paymentStatus" <> 'PAID'
  AND (o."paymentMethod" IS NULL OR o."paymentMethod" IN ('PIX', 'CREDIT_CARD'));
