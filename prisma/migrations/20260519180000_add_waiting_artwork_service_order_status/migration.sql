-- Add WAITING_ARTWORK to the ServiceOrderStatus enum.
--
-- Used exclusively by COMMERCIAL-type service orders. When a TaskQuote is
-- commercial-approved but the linked Task has no APPROVED artwork yet, the
-- "Em Negociação" COMMERCIAL SO is auto-transitioned to WAITING_ARTWORK
-- and resolves to COMPLETED when an artwork is approved (or back to
-- IN_PROGRESS if the quote is reverted).

ALTER TYPE "ServiceOrderStatus" ADD VALUE IF NOT EXISTS 'WAITING_ARTWORK';
