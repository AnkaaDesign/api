-- Add "Prestação de Serviço" chart-of-accounts group (third-party/outsourced services).
ALTER TYPE "AccountingType" ADD VALUE IF NOT EXISTS 'PRESTACAO_SERVICO' AFTER 'MANUTENCAO';
