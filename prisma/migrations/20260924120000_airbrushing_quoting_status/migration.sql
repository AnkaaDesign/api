-- Aerografia em cotação: novo status QUOTING ("Em Cotação").
--
-- Separado das tabelas da cotação porque um valor novo de enum não pode ser
-- USADO na mesma transação em que foi criado. `ADD VALUE IF NOT EXISTS`, como
-- `20260914120000_signer_reopened_event`: reaplicar não falha.
ALTER TYPE "AirbrushingStatus" ADD VALUE IF NOT EXISTS 'QUOTING' BEFORE 'PREPARATION';
