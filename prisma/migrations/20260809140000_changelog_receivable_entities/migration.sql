-- Receivables settlement entities were missing from ChangeLogEntityType, which
-- made every installment/invoice/boleto mutation structurally unauditable.
-- Additive only: new enum members, no data change, safe to run before the code
-- that writes them ships.
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'INSTALLMENT';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'INVOICE';
ALTER TYPE "ChangeLogEntityType" ADD VALUE IF NOT EXISTS 'BANK_SLIP';
