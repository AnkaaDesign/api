-- Add CANCELLED to the TaskQuoteStatus enum.
-- A quote is cancelled when its task is cancelled (task-cancel → quote-cancel cascade).
-- Additive and idempotent; safe to re-run via `prisma migrate deploy`.
ALTER TYPE "TaskQuoteStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
