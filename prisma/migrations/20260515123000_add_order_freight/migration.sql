-- Add freight cost (Portuguese: "frete") to purchase orders.
-- Defaults to 0 so existing orders behave unchanged. The form lets users add
-- a freight value during creation/edit; total displays now include it.

ALTER TABLE "Order" ADD COLUMN "freight" DOUBLE PRECISION NOT NULL DEFAULT 0;
