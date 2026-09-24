-- Cotação da aerografia: propostas e contrapropostas por aerografista.
--
-- Escrita à mão: `prisma migrate dev` é inutilizável neste repositório (a réplica
-- no shadow DB quebra em 20260406000000_consolidated_schema_update).

-- Enums
CREATE TYPE "AirbrushingQuoteStatus" AS ENUM ('PROPOSED', 'COUNTERED', 'ACCEPTED', 'DECLINED', 'SELECTED', 'NOT_SELECTED');
CREATE TYPE "AirbrushingQuoteParty" AS ENUM ('PAINTER', 'COMPANY');
CREATE TYPE "AirbrushingQuoteAction" AS ENUM ('PROPOSAL', 'COUNTER', 'ACCEPT', 'DECLINE', 'SELECT', 'CLOSE');

-- Marcos da cotação na própria aerografia
ALTER TABLE "Airbrushing"
  ADD COLUMN "quotationOpenedAt" TIMESTAMP(3),
  ADD COLUMN "quotationNotifiedAt" TIMESTAMP(3),
  ADD COLUMN "quotationClosedAt" TIMESTAMP(3);

-- Negociação por aerografista
CREATE TABLE "AirbrushingQuote" (
    "id" TEXT NOT NULL,
    "airbrushingId" TEXT NOT NULL,
    "painterId" TEXT NOT NULL,
    "status" "AirbrushingQuoteStatus" NOT NULL DEFAULT 'PROPOSED',
    "amount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AirbrushingQuote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AirbrushingQuote_airbrushingId_painterId_key" ON "AirbrushingQuote"("airbrushingId", "painterId");
CREATE INDEX "AirbrushingQuote_painterId_status_idx" ON "AirbrushingQuote"("painterId", "status");

ALTER TABLE "AirbrushingQuote" ADD CONSTRAINT "AirbrushingQuote_airbrushingId_fkey"
  FOREIGN KEY ("airbrushingId") REFERENCES "Airbrushing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AirbrushingQuote" ADD CONSTRAINT "AirbrushingQuote_painterId_fkey"
  FOREIGN KEY ("painterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Linha do tempo da negociação
CREATE TABLE "AirbrushingQuoteEvent" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "party" "AirbrushingQuoteParty" NOT NULL,
    "action" "AirbrushingQuoteAction" NOT NULL,
    "amount" DOUBLE PRECISION,
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AirbrushingQuoteEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AirbrushingQuoteEvent_quoteId_createdAt_idx" ON "AirbrushingQuoteEvent"("quoteId", "createdAt");

ALTER TABLE "AirbrushingQuoteEvent" ADD CONSTRAINT "AirbrushingQuoteEvent_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "AirbrushingQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AirbrushingQuoteEvent" ADD CONSTRAINT "AirbrushingQuoteEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
