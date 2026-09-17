-- A FILA DO ORÇAMENTO: o que espera ação vem primeiro, e do mais antigo.
--
-- Pedido do dono: "deve mostrar primeiro os mais antigos pendentes, depois os
-- mais novos aprovados." As duas metades têm DIREÇÕES OPOSTAS — e é por isso que
-- isto é uma coluna, e não um `ORDER BY` com duas chaves.
--
-- Um pendente antigo é uma proposta esquecida: quanto mais velha, mais urgente,
-- logo o mais antigo primeiro. Um aprovado é trabalho resolvido: o que interessa
-- é o que acabou de entrar, logo o mais recente primeiro. Nenhuma ordenação de
-- duas colunas com direção fixa expressa isso, e o Postgres não deixa ordenar por
-- uma expressão vinda do cliente.
--
-- Então a expressão vira DADO: `queueRank` é o instante de criação em segundos,
-- NEGADO para quem já saiu da fila. Ordenar por `statusOrder, queueRank` (as duas
-- ascendentes, que é tudo que o Prisma sabe fazer) produz exatamente a leitura
-- pedida.
--
-- GENERATED ALWAYS … STORED: o banco calcula e mantém sozinho, e não há como
-- gravar um valor divergente. É o mesmo recurso que as colunas `*Normalized` da
-- busca sem acento já usam. O Prisma não sabe declará-la, então o campo é
-- declarado no schema e criado aqui — e nenhum mapeador o emite, porque todos
-- desestruturam campo a campo.
--
-- `extract(epoch from …)` é imutável sobre `timestamp without time zone`, que é o
-- tipo que o Prisma gera para `DateTime`. Sobre `timestamptz` NÃO seria (depende
-- do fuso da sessão) e o Postgres recusaria a coluna gerada.

ALTER TABLE "Budget" ADD COLUMN "queueRank" double precision
  GENERATED ALWAYS AS (
    CASE
      WHEN "status" IN ('APPROVED', 'CANCELLED') THEN -extract(epoch from "createdAt")
      ELSE extract(epoch from "createdAt")
    END
  ) STORED;

-- A lista ordena por (statusOrder, queueRank) e pagina por isso. Sem o índice
-- composto, cada página de quarenta ordena as 722 linhas inteiras.
CREATE INDEX "Budget_statusOrder_queueRank_idx" ON "Budget" ("statusOrder", "queueRank");
