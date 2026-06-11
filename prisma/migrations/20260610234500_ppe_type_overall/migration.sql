-- Macacão de segurança is PPE (coverall), not uniform clothing. PPE_SIZE_TYPE
-- already anticipated OVERALL; this adds it to PpeType so items can carry it.
ALTER TYPE "PpeType" ADD VALUE IF NOT EXISTS 'OVERALL';
