-- Cancellation-request lifecycle for NFS-e (Elotech "solicitação de cancelamento").
-- Cancellation is asynchronous + fiscal-approved: submitting a request does not cancel
-- the note. Track the request so system-only users see what is happening at the prefeitura.

-- AlterEnum: new statuses placed before CANCELLED
ALTER TYPE "NfseStatus" ADD VALUE IF NOT EXISTS 'CANCEL_REQUESTED' BEFORE 'CANCELLED';
ALTER TYPE "NfseStatus" ADD VALUE IF NOT EXISTS 'CANCEL_REJECTED' BEFORE 'CANCELLED';

-- AlterTable
ALTER TABLE "NfseDocument"
  ADD COLUMN IF NOT EXISTS "cancelRequestId" INTEGER,
  ADD COLUMN IF NOT EXISTS "cancelRequestStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelReasonCode" INTEGER,
  ADD COLUMN IF NOT EXISTS "cancelRejectionMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelSubstituteNfseNumber" INTEGER,
  ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelResolvedAt" TIMESTAMP(3);
