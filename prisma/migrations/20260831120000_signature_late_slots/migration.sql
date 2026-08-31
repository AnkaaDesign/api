-- Lacunas de cadastro tardio (série, placa, chassi) reservadas na frase do
-- veículo e medidas no mesmo render que as âncoras de assinatura.
--
-- Nulo nos envelopes já existentes de propósito: o documento deles foi
-- congelado sem lacuna nenhuma, então não há retângulo onde carimbar, e o dado
-- que chegar depois continua indo para a trilha de auditoria.
ALTER TABLE "SignatureEnvelope" ADD COLUMN "lateSlots" JSONB;
