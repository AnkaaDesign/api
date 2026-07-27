-- Responsible.cpf — o dado que faltava para a assinatura eletrônica conferir
-- identidade sem pedir o CPF inteiro toda vez.
--
-- Sem esta coluna, `EnvelopeSigner.declaredCpf` nascia sempre null: o gate de
-- identidade aceitava qualquer CPF bem-formado, e a máscara do §5.9 não tinha o
-- que mascarar. Com ela, o cadastro passa a ser a âncora — o signatário completa
-- só os dígitos ocultos, e completar corretamente é o que vale como conferência.
--
-- NÃO é UNIQUE, ao contrário de `phone` e `email`. Duas razões:
--   1. a unicidade da pessoa já é garantida pelo telefone, que é o canal do OTP;
--   2. o CPF passa a ser gravado DURANTE a cerimônia (o signatário digita o CPF
--      completo na primeira assinatura). Uma violação de unicidade ali derrubaria
--      a assinatura de um cliente por causa de um cadastro duplicado antigo —
--      trocar uma falha de dado por uma falha de negócio no pior momento.
--
-- Escrita à mão de propósito: `prisma migrate dev` autogera um diff que DERRUBA
-- 16 índices trigram e 96 colunas geradas deste schema.

ALTER TABLE "Representative"
  ADD COLUMN IF NOT EXISTS "cpf" TEXT;

-- Coluna gerada, no mesmo formato das demais (ver 20260624150000).
ALTER TABLE "Representative"
  ADD COLUMN IF NOT EXISTS "cpfNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("cpf"))) STORED;

-- Busca por CPF na listagem de contatos, no mesmo padrão de `email`/`phone`.
CREATE INDEX IF NOT EXISTS "Representative_cpf_idx" ON "Representative"("cpf");
