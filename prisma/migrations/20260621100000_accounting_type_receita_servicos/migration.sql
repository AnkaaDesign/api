-- Service revenue cost group (plano de contas). Incoming receipts that settle a
-- task / external-operation receivable roll up here, giving the entrada side an
-- accounting classification the way DEBITs already get one from NF items.
ALTER TYPE "AccountingType" ADD VALUE IF NOT EXISTS 'RECEITA_SERVICOS';
