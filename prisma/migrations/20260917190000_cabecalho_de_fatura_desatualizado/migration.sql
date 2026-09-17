-- O CABEÇALHO DA FATURA QUE FICOU PARA TRÁS DAS PRÓPRIAS PARCELAS.
--
-- `Invoice.status` é derivado das parcelas dela, e alguém precisa recalculá-lo
-- quando uma parcela é baixada (`recalcInvoicePaymentState`). Em cinco faturas
-- isso não aconteceu: quatro dizem `PARTIALLY_PAID` e uma diz `ACTIVE` com TODAS
-- as suas parcelas `PAID`.
--
-- Não é cosmético, e ficou visível quando o faturamento ganhou estado próprio: a
-- cobrança deriva das parcelas e diz "Liquidado", a fatura diz "Parcialmente
-- paga", e a tela mostra os dois lado a lado. Dois estados derivados do mesmo
-- fato, por gatilhos diferentes, discordando — que é a forma que a divergência
-- assume antes de virar erro de cobrança.
--
-- ⚠️ ESTA MIGRATION CORRIGE O DADO, NÃO A CAUSA. O caminho de baixa que não
-- recalcula está sendo tratado no código; sem ele, faturas novas voltam a
-- divergir e esta correção vira paliativo.
--
-- Conferido antes: 298 das 303 faturas vivas já concordavam com as suas parcelas.
-- Só as cinco divergentes são tocadas, e só para o valor que as PRÓPRIAS parcelas
-- sustentam — nenhum número é inventado.
UPDATE "Invoice" inv
SET "status" = 'PAID'
FROM (
  SELECT i."invoiceId" AS id,
         count(*) FILTER (WHERE i.status <> 'CANCELLED') AS ativas,
         count(*) FILTER (WHERE i.status = 'PAID')       AS pagas
  FROM "Installment" i
  WHERE i."invoiceId" IS NOT NULL
  GROUP BY i."invoiceId"
) s
WHERE s.id = inv.id
  AND inv."status" IN ('ACTIVE', 'PARTIALLY_PAID')
  AND s.ativas > 0
  AND s.pagas = s.ativas;
