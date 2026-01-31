-- Add signature-related status values to PpeDeliveryStatus enum
ALTER TYPE "PpeDeliveryStatus" ADD VALUE IF NOT EXISTS 'WAITING_SIGNATURE';
ALTER TYPE "PpeDeliveryStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "PpeDeliveryStatus" ADD VALUE IF NOT EXISTS 'SIGNATURE_REJECTED';
