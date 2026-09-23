-- Nº do pedido de compra informado pelo signatário de Compras na cerimônia.
--
-- Escrita à mão, como as demais do módulo de assinatura: `prisma migrate dev`
-- autogera um diff que derruba os índices trigram e as colunas `*Normalized`.
--
-- `ADD VALUE` fora de transação explícita e com IF NOT EXISTS, como
-- `20260914120000_signer_reopened_event`: reaplicar não falha.
ALTER TYPE "SignatureEventType" ADD VALUE IF NOT EXISTS 'ORDER_NUMBER_INFORMED';
