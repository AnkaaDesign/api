-- Adds the learned-alias table that lets the bank reconciliation matcher
-- recover counterparty identity for OFX transactions whose memo does not
-- carry a parseable CNPJ. Each row is a (memoFingerprint -> CNPJ/CPF) pair
-- harvested from confirmed matches; the matcher consults it to fill in a
-- synthetic CNPJ before scoring. The existing 90-threshold / 8-point
-- runner-up gate still gates auto-matching.

-- 1. Enum for alias provenance — MANUAL_MATCH is gold; AUTO_MATCH is weakly
--    trusted and needs multiple confirmations before it can boost a score.
CREATE TYPE "ReconciliationAliasSource" AS ENUM ('MANUAL_MATCH', 'AUTO_MATCH', 'ADMIN_SEEDED');

-- 2. The alias table itself.
CREATE TABLE "ReconciliationAlias" (
    "id" TEXT NOT NULL,
    "memoFingerprint" TEXT NOT NULL,
    "counterpartyCnpjCpf" TEXT NOT NULL,
    "txType" "BankTransactionType" NOT NULL,
    "source" "ReconciliationAliasSource" NOT NULL,
    "confirmedCount" INTEGER NOT NULL DEFAULT 1,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationAlias_pkey" PRIMARY KEY ("id")
);

-- Uniqueness on the natural key (fingerprint + counterparty + direction).
-- Same fingerprint can resolve to two different CNPJs across credit/debit
-- legitimately (e.g. a service we both pay and receive from), hence txType
-- is part of the key.
CREATE UNIQUE INDEX "ReconciliationAlias_memoFingerprint_counterpartyCnpjCpf_txType_key" ON "ReconciliationAlias"("memoFingerprint", "counterpartyCnpjCpf", "txType");

-- Read-path index: matcher resolves (fingerprint, direction) -> alias.
CREATE INDEX "ReconciliationAlias_memoFingerprint_txType_idx" ON "ReconciliationAlias"("memoFingerprint", "txType");

-- Admin/inspection index: list all aliases for a given counterparty.
CREATE INDEX "ReconciliationAlias_counterpartyCnpjCpf_idx" ON "ReconciliationAlias"("counterpartyCnpjCpf");

-- Used by the decay job to find aliases to disable.
CREATE INDEX "ReconciliationAlias_disabledAt_idx" ON "ReconciliationAlias"("disabledAt");
