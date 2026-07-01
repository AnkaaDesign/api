-- Backfill the new PRESTACAO_SERVICO chart-of-accounts group onto the outsourced
-- third-party service categories. The enum value + label were added (migration
-- 20260630170000) but NO TransactionCategory carried the type, so it was inert:
-- accountingTypeDistribution groups by TransactionCategory.accountingType and every
-- one of these service categories was seeded with accountingType = NULL, dropping
-- them into the untyped bucket and leaving PRESTACAO_SERVICO permanently empty.
--
-- Tag only the unambiguously-administrative outsourced services (accounting,
-- monitoring/security, and the generic "Prestação de Serviços" catch-all the
-- classifier routes subcontractors into). Production-subcontracting services
-- (aerografia, impressao-de-adesivo) are intentionally left untyped for manual
-- curation, since they may belong to a production-cost group rather than SG&A.
--
-- Non-destructive: fills NULLs only, never overrides a manually-set accountingType.
-- Idempotent: re-running is a no-op (the WHERE stops matching once set); if the
-- categories aren't seeded in a given database this simply updates zero rows.
-- The ADD VALUE for PRESTACAO_SERVICO lives in a separate earlier migration
-- (20260630170000), so this UPDATE runs in its own transaction — Postgres' ban on
-- using a freshly-added enum value in the same transaction does not apply.
UPDATE "TransactionCategory"
SET "accountingType" = 'PRESTACAO_SERVICO'
WHERE "slug" IN ('prestacao-de-servicos', 'contabilidade', 'monitoramento')
  AND "accountingType" IS NULL;
