-- Add percentage discount (Portuguese: "desconto") to purchase orders.
-- Defaults to 0 so existing orders behave unchanged. The form lets users enter
-- a discount percentage during creation/edit; the discount is applied to the
-- goods subtotal (before ICMS/IPI) and total displays now subtract it.

ALTER TABLE "Order" ADD COLUMN "discount" DOUBLE PRECISION NOT NULL DEFAULT 0;
