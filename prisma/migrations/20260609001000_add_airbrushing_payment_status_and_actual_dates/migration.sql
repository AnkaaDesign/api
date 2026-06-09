-- CreateEnum
CREATE TYPE "AirbrushingPaymentStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID');

-- AlterTable
ALTER TABLE "Airbrushing" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "Airbrushing" ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMP(3);
ALTER TABLE "Airbrushing" ADD COLUMN IF NOT EXISTS "paymentStatus" "AirbrushingPaymentStatus" NOT NULL DEFAULT 'PENDING';
