-- Extraordinary accounting group (plano de contas). Catches exceptional,
-- non-recurring items that don't belong to any of the regular operating cost
-- groups, so they can be isolated in the DRE instead of distorting them.
ALTER TYPE "AccountingType" ADD VALUE IF NOT EXISTS 'EXTRAORDINARIO';
