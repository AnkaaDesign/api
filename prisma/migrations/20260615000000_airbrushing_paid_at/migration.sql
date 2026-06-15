-- Stamp when an airbrushing painter payment is settled (paymentStatus = PAID),
-- so Contas a Pagar can window "paid this month" precisely.
ALTER TABLE "Airbrushing" ADD COLUMN "paidAt" TIMESTAMP(3);
