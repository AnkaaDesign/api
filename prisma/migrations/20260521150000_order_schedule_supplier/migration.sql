-- Add supplierId and lastFiredAt to OrderSchedule (missed in feat: order-schedule supplier commit).

ALTER TABLE "OrderSchedule"
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "lastFiredAt" TIMESTAMP(3);

ALTER TABLE "OrderSchedule"
  ADD CONSTRAINT "OrderSchedule_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX "OrderSchedule_supplierId_idx" ON "OrderSchedule"("supplierId");
