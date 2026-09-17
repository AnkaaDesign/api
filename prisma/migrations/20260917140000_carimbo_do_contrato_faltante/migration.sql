-- O CARIMBO DE "CONTRATO INTEIRAMENTE FATURADO" QUE NUNCA FOI ESCRITO.
--
-- `TaskQuote.billingApprovedAt` significa "todas as cobranças deste orçamento
-- foram aprovadas" — é do CONTRATO, enquanto `Billing.approvedAt` é de cada
-- cobrança. O campo nasceu depois de boa parte do acervo já estar faturada, e
-- nunca houve backfill: em produção, 69 orçamentos totalmente faturados estão com
-- ele nulo — 23% dos 299 que têm cobrança aprovada.
--
-- Isso não é cosmético. Quem lê este campo:
--   · `invoice-analytics.service.ts` → `avgSalesCycleDays`, que simplesmente
--     IGNORA um quarto dos contratos ao medir o ciclo de venda;
--   · o filtro "Período de Faturamento" da lista, que não acha esses orçamentos
--     em faixa de data nenhuma.
--
-- A data defensável é a da ÚLTIMA cobrança aprovada: é literalmente o instante em
-- que o contrato passou a estar inteiramente faturado. Os 69 têm uma cobrança só,
-- então "última" e "única" coincidem — mas o `max` é escrito para valer também
-- para o orçamento fatiado, que é o caso que existe daqui em diante.
--
-- ⚠️ Só toca quem está com o campo NULO **e** não tem nenhuma cobrança pendente.
-- Um orçamento com 30 de 60 veículos cobrados continua sem carimbo, porque ainda
-- não é verdade que ele esteja inteiramente faturado.
UPDATE "TaskQuote" q
SET "billingApprovedAt" = sub.ultima
FROM (
  SELECT b."quoteId" AS id, max(b."approvedAt") AS ultima
  FROM "Billing" b
  GROUP BY b."quoteId"
) sub
WHERE sub.id = q.id
  AND q."billingApprovedAt" IS NULL
  AND sub.ultima IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Billing" b2 WHERE b2."quoteId" = q.id AND b2."approvedAt" IS NULL
  );
