-- "Marcar como resolvido" no extrato: a linha que a categoria explica e que não
-- tem obrigação nem documento a vincular. Ver o comentário do modelo em
-- schema.prisma para o porquê de não ser "Ignorar".
ALTER TABLE "BankTransaction" ADD COLUMN "settlementAckAt" TIMESTAMP(3);
ALTER TABLE "BankTransaction" ADD COLUMN "settlementAckById" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN "settlementAckNote" TEXT;
