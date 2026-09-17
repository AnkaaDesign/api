-- ORÇAMENTO DEIXA DE SE CHAMAR "TASK QUOTE".
--
-- O nome nasceu quando um orçamento pertencia a UMA tarefa. Desde o multitarefa
-- ele cobre N veículos, e desde que o faturamento virou entidade a casa tem duas
-- palavras: BUDGET (o que se propõe) e BILLING (o que se cobra). "TaskQuote" não
-- descreve mais nem o dono nem o escopo.
--
-- ⚠️ ESTA MIGRAÇÃO NÃO MOVE UM ÚNICO BYTE DE DADO. Renomear tabela, índice,
-- constraint e tipo enum é operação de CATÁLOGO no Postgres: instantânea,
-- transacional e reversível trocando os dois lados de cada RENAME.
--
-- ⚠️ O QUE **NÃO** FOI RENOMEADO, e por quê:
--
--   • as COLUNAS `quoteId` (em Budget* e nas 7 tabelas que apontam para cá).
--     Elas viajam como CHAVE DE STRING em `include`/`where`/`select` — 116
--     ocorrências entre api, web e app —, e o zod dessas rotas não é `.strict()`:
--     um nome que não bate é APAGADO em silêncio, não recusado. A tela abriria
--     sem orçamento e sem erro. Renomear coluna é fase própria, com os três
--     clientes atualizados juntos.
--   • os VALORES do enum `ChangeLogEntityType` (`TASK_QUOTE`,
--     `TASK_QUOTE_SERVICE`, `TASK_QUOTE_CUSTOMER_CONFIG`): há 3.863 linhas de
--     histórico gravadas com eles. `ALTER TYPE … RENAME VALUE` preservaria as
--     linhas, mas os dois enums TS que os espelham e os filtros salvos no web
--     seguiriam o valor antigo. Fase posterior.
--   • as chaves de notificação `task_quote.*`, gravadas em configuração e
--     roteadas por prefixo — inclusive a partir de variável de ambiente.
--
-- Os nomes de CONSTRAINT e ÍNDICE são renomeados explicitamente: o Postgres NÃO
-- os renomeia junto com a tabela, e deixá-los com o nome velho faria o
-- `migrate diff` da próxima vez propor um DROP/CREATE deles.

-- ── 1. AS TRÊS TABELAS ──────────────────────────────────────────────────────
ALTER TABLE "TaskQuote"               RENAME TO "Budget";
ALTER TABLE "TaskQuoteService"        RENAME TO "BudgetItem";
ALTER TABLE "TaskQuoteCustomerConfig" RENAME TO "BudgetPayer";

-- ── 2. O TIPO ENUM DO ESTADO ────────────────────────────────────────────────
ALTER TYPE "TaskQuoteStatus" RENAME TO "BudgetStatus";

-- ── 3. CHAVES PRIMÁRIAS ─────────────────────────────────────────────────────
ALTER TABLE "Budget"      RENAME CONSTRAINT "TaskQuote_pkey"               TO "Budget_pkey";
ALTER TABLE "BudgetItem"  RENAME CONSTRAINT "TaskQuoteService_pkey"        TO "BudgetItem_pkey";
ALTER TABLE "BudgetPayer" RENAME CONSTRAINT "TaskQuoteCustomerConfig_pkey" TO "BudgetPayer_pkey";

-- ── 4. CHAVES ESTRANGEIRAS QUE SAEM DAS TRÊS ────────────────────────────────
ALTER TABLE "Budget"      RENAME CONSTRAINT "TaskQuote_commercialUserId_fkey"                TO "Budget_commercialUserId_fkey";
ALTER TABLE "BudgetItem"  RENAME CONSTRAINT "TaskQuoteService_quoteId_fkey"                  TO "BudgetItem_quoteId_fkey";
ALTER TABLE "BudgetItem"  RENAME CONSTRAINT "TaskQuoteService_invoiceToCustomerId_fkey"      TO "BudgetItem_invoiceToCustomerId_fkey";
ALTER TABLE "BudgetPayer" RENAME CONSTRAINT "TaskQuoteCustomerConfig_quoteId_fkey"           TO "BudgetPayer_quoteId_fkey";
ALTER TABLE "BudgetPayer" RENAME CONSTRAINT "TaskQuoteCustomerConfig_billingId_fkey"         TO "BudgetPayer_billingId_fkey";
ALTER TABLE "BudgetPayer" RENAME CONSTRAINT "TaskQuoteCustomerConfig_customerId_fkey"        TO "BudgetPayer_customerId_fkey";
ALTER TABLE "BudgetPayer" RENAME CONSTRAINT "TaskQuoteCustomerConfig_responsibleId_fkey"     TO "BudgetPayer_responsibleId_fkey";
ALTER TABLE "BudgetPayer" RENAME CONSTRAINT "TaskQuoteCustomerConfig_customerSignatureId_fkey" TO "BudgetPayer_customerSignatureId_fkey";

-- ── 5. ÍNDICES ──────────────────────────────────────────────────────────────
ALTER INDEX "TaskQuote_budgetNumber_key"                       RENAME TO "Budget_budgetNumber_key";
ALTER INDEX "TaskQuote_commercialUserId_idx"                   RENAME TO "Budget_commercialUserId_idx";
ALTER INDEX "TaskQuote_expiresAt_idx"                          RENAME TO "Budget_expiresAt_idx";
ALTER INDEX "TaskQuote_status_idx"                             RENAME TO "Budget_status_idx";
ALTER INDEX "TaskQuote_statusOrder_idx"                        RENAME TO "Budget_statusOrder_idx";
ALTER INDEX "TaskQuoteService_quoteId_idx"                     RENAME TO "BudgetItem_quoteId_idx";
ALTER INDEX "TaskQuoteService_invoiceToCustomerId_idx"         RENAME TO "BudgetItem_invoiceToCustomerId_idx";
ALTER INDEX "TaskQuoteCustomerConfig_quoteId_idx"              RENAME TO "BudgetPayer_quoteId_idx";
ALTER INDEX "TaskQuoteCustomerConfig_billingId_idx"            RENAME TO "BudgetPayer_billingId_idx";
ALTER INDEX "TaskQuoteCustomerConfig_customerId_idx"           RENAME TO "BudgetPayer_customerId_idx";
ALTER INDEX "TaskQuoteCustomerConfig_responsibleId_idx"        RENAME TO "BudgetPayer_responsibleId_idx";
ALTER INDEX "TaskQuoteCustomerConfig_customerSignatureId_idx"  RENAME TO "BudgetPayer_customerSignatureId_idx";
