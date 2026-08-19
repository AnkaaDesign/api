-- Conciliação externa de parcela a receber.
--
-- ReconciliationMatch.transactionId é NOT NULL, então um recebimento que entrou
-- numa conta de sócio (fora da conta da empresa) não pode ser conciliado pelo
-- caminho normal: a transação bancária correspondente nunca vai existir no OFX.
-- Estas colunas registram a declaração manual — quem marcou, quando e por quê —
-- para que a parcela pare de aparecer como "paga sem conciliação".
ALTER TABLE "Installment" ADD COLUMN "externalClearedAt" TIMESTAMP(3);
ALTER TABLE "Installment" ADD COLUMN "externalClearedById" TEXT;
ALTER TABLE "Installment" ADD COLUMN "externalClearedNote" TEXT;

-- A varredura noturna de stale-paid filtra por esta coluna; sem índice ela varre
-- a tabela inteira toda madrugada.
CREATE INDEX "Installment_externalClearedAt_idx" ON "Installment"("externalClearedAt");
