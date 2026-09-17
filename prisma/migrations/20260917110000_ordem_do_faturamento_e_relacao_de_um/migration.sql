-- PARCIAL PASSA NA FRENTE DE APROVADO.
--
-- Decisão do dono em 17/09: a lista de Faturamento ordena por
--
--   vencido → pendente → parcial → aprovado → liquidado → cancelado
--
-- Não é a ordem cronológica — cronologicamente aprovado vem antes de parcial. É a
-- ordem da ATENÇÃO: parcialmente pago tem saldo em aberto e um pagador que já
-- começou a pagar; recém-aprovado só espera o primeiro vencimento chegar.
--
-- `Billing.statusOrder` é PERSISTIDO na escrita do estado, então as 695 linhas que
-- já existem carregam a numeração anterior. Espelho em código:
-- `src/constants/sortOrders.ts` → `BILLING_STATUS_ORDER`. Os dois andam juntos.
UPDATE "Billing" SET "statusOrder" = CASE "status"
  WHEN 'OVERDUE'   THEN 1
  WHEN 'PENDING'   THEN 2
  WHEN 'PARTIAL'   THEN 3
  WHEN 'APPROVED'  THEN 4
  WHEN 'SETTLED'   THEN 5
  WHEN 'CANCELLED' THEN 6
END;

-- ─────────────────────────────────────────────────────────────────────────────
-- A COLUNA "STATUS FATURAMENTO" VOLTA A SER ORDENÁVEL — e o conserto é de SCHEMA,
-- não de SQL.
--
-- `Task.billingEntry` estava declarado `BillingTask[]`. O banco já garantia no
-- máximo um (`BillingTask.@@unique([taskId])`), mas para o Prisma uma lista é
-- relação de-muitos, e `orderBy` não atravessa relação de-muitos. Era só isso que
-- impedia a lista de ordenar pelo estado da cobrança: o dado estava a um passo, e
-- o ORM se recusava a dar o passo.
--
-- Declarada como `BillingTask?`, o `orderBy` funciona nativamente. Nenhuma
-- mudança de banco é necessária — a garantia de unicidade já existe, e é ela que
-- torna a declaração verdadeira. Esta nota existe para que a próxima pessoa que
-- ler a migration entenda por que ela quase não tem SQL.
