-- O BOLETO QUE MORREU POR UM MOTIVO QUE DEIXOU DE EXISTIR SEIS DIAS DEPOIS.
--
-- Em 18/06/2026 o registro no Sicredi da 4ª e última parcela do orçamento 24
-- (Amendolândia, R$ 1.375,00, vencimento 23/06) falhou com
--
--     Validation failed: Customer "Amendolandia" has invalid document (CNPJ=, CPF=)
--
-- e a linha ficou em `ERROR` com `errorCount = 3`. Esse é o teto: o job de criação
-- de boletos filtra por `errorCount < 3` (`sicredi-boleto.scheduler.ts`), de modo
-- que a partir dali NADA voltaria a tentar — por desenho, porque erro repetido
-- pede gente, não repetição.
--
-- Só que a gente já veio. O ChangeLog do cliente registra, em **24/06/2026
-- 10:06:45**, `cnpj: "" → "08069383000166"` — o CNPJ foi preenchido seis dias
-- depois da falha, e o `updatedAt` do cliente é exatamente esse instante. A
-- condição que bloqueava o registro deixou de valer e ninguém tinha como saber:
-- não existe gatilho que reabra boletos parados quando um cadastro é corrigido.
--
-- A dívida é real e é a única em aberto do contrato — as parcelas 1, 2 e 3 estão
-- PAGAS (R$ 1.375,00 + R$ 1.375,00 + R$ 1.392,46), a 4ª está PENDENTE e sem
-- boleto nenhum na mão do cliente. A cobrança lê VENCIDO, corretamente.
--
-- A correção é a mesma que o botão "Regenerar boleto" faz
-- (`POST /invoices/:installmentId/boleto/regenerate`): devolver a linha para
-- `CREATING` com `nossoNumero` temporário e o contador zerado, para que o job de
-- criação a registre. Nada aqui fala com o Sicredi — quem fala é o job, na
-- próxima execução.
--
-- ⚠️ CONSEQUÊNCIA CONHECIDA: o vencimento 23/06 está no passado e o Sicredi
-- recusa data passada, então o registro vai GRAMPEAR o vencimento para o dia do
-- registro e mover a parcela junto (é o que `dueDateWasClamped` faz em todo
-- registro atrasado, para que o sistema mostre a mesma data do boleto que o
-- cliente recebeu). A cobrança sai de VENCIDO nesse momento — não por
-- esquecimento, mas porque passa a existir um boleto com vencimento novo.
--
-- ⚠️ ESCOPO: uma linha só, endereçada pelo par (status ERROR + a parcela). Se a
-- linha já tiver sido tratada à mão, o `WHERE` não casa e a migration é inócua.
UPDATE "BankSlip" bs
SET
  "status"        = 'CREATING',
  "nossoNumero"   = 'TMP-' || bs."installmentId",
  "errorMessage"  = NULL,
  "errorCount"    = 0,
  "barcode"       = NULL,
  "digitableLine" = NULL,
  "pixQrCode"     = NULL,
  "txid"          = NULL,
  "updatedAt"     = now()
FROM "Installment" ins, "Customer" c, "Invoice" i
WHERE ins."id" = bs."installmentId"
  AND i."id"   = ins."invoiceId"
  AND c."id"   = i."customerId"
  AND bs."status" = 'ERROR'
  AND bs."errorMessage" LIKE '%invalid document%'
  -- A condição que travava o registro NÃO vale mais: hoje há documento.
  AND (
    (c."cnpj" IS NOT NULL AND c."cnpj" <> '')
    OR (c."cpf" IS NOT NULL AND c."cpf" <> '')
  )
  -- E a parcela continua sendo dívida em aberto. Parcela paga ou cancelada não
  -- volta a gerar boleto por nada.
  AND ins."status" NOT IN ('PAID', 'CANCELLED');
