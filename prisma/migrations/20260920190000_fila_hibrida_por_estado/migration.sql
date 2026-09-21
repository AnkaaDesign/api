-- ---------------------------------------------------------------------------
-- A FILA INTERNA PASSA A TER DIREÇÃO POR ESTADO.
-- ---------------------------------------------------------------------------
--
-- O QUE ESTAVA ERRADO, e por que não era um erro óbvio.
--
-- `queueRank` nasceu com uma regra só: terminais (`APPROVED`, `CANCELLED`)
-- ordenam do mais RECENTE primeiro, todo o resto do mais ANTIGO primeiro. A
-- justificativa era boa e continua valendo para metade dos casos — "o pendente
-- mais antigo é o mais urgente": um orçamento parado há três semanas esperando
-- a assinatura do cliente é exatamente o que tem de estar no topo, porque é o
-- que envelhece.
--
-- Só que a MESMA regra, aplicada a `REQUESTED`, produz o contrário do que se
-- quer. Uma requisição que acabou de chegar é trabalho NOVO — e ela ia para o
-- FIM do próprio grupo, atrás de todas as anteriores. Quem abriu o orçamento
-- pelo portal e ligou em seguida perguntando por ele ouvia "não chegou nada",
-- porque não chegou nada VISÍVEL.
--
-- A DIREÇÃO DEPENDE DE QUEM DEVE A PRÓXIMA AÇÃO:
--
--   · a bola está com a ANKAA  → mais RECENTE primeiro (trabalho que chegou)
--     `REQUESTED`, `PRE_APPROVED`, `SIGNED`
--   · espera-se o CLIENTE      → mais ANTIGO primeiro (cobrança que envelhece)
--     `EXPIRED`, `IN_NEGOTIATION`, `PENDING`
--   · TERMINAIS                → mais RECENTE primeiro (histórico se lê de trás)
--     `APPROVED`, `CANCELLED`
--
-- POR QUE NA COLUNA, E NÃO NO `orderBy` DO CÓDIGO.
-- Direção por estado não se exprime num `ORDER BY` de duas chaves: seria
-- `CASE` no `orderBy` de toda consulta que lista orçamento — servidor, tabela
-- interna, contadores — e a primeira que esquecesse ordenaria diferente das
-- outras sem nada falhar. A coluna gerada já era o lugar dessa decisão desde
-- `20260917210000`; aqui ela só passa a conhecer três grupos em vez de dois.
-- Nenhuma linha de TypeScript muda: `BUDGET_QUEUE_ORDER` continua
-- `[{statusOrder:'asc'},{queueRank:'asc'}]`.
--
-- ⚠️ A LISTA DO PORTAL NÃO USA ISTO e não deve usar. Ela é o HISTÓRICO do
--    cliente, onde o que ele acabou de mandar tem de estar em cima sempre —
--    `PORTAL_BUDGET_ORDER` (`portal-read.service.ts`) usa `createdAt desc` e é
--    deliberadamente independente desta fila de trabalho.
--
-- ⚠️ COLUNA GERADA NÃO ACEITA `ALTER ... USING`: para trocar a expressão é
--    preciso DERRUBAR e RECRIAR, e o índice junto — mesmo caminho das duas
--    migrations anteriores que mexeram nela.

DROP INDEX IF EXISTS "Budget_statusOrder_queueRank_idx";
ALTER TABLE "Budget" DROP COLUMN IF EXISTS "queueRank";

ALTER TABLE "Budget" ADD COLUMN "queueRank" double precision
  GENERATED ALWAYS AS (
    CASE
      -- A bola está com a Ankaa, ou o orçamento já terminou: mais recente
      -- primeiro. O sinal negativo é o que faz `ORDER BY queueRank ASC`
      -- devolver o mais novo na frente.
      WHEN "status" IN ('REQUESTED', 'PRE_APPROVED', 'SIGNED', 'APPROVED', 'CANCELLED')
        THEN -extract(epoch from "createdAt")
      -- Espera-se o cliente: mais antigo primeiro, que é o que envelhece.
      ELSE extract(epoch from "createdAt")
    END
  ) STORED;

CREATE INDEX "Budget_statusOrder_queueRank_idx" ON "Budget" ("statusOrder", "queueRank");
