-- Cotação da aerografia: tempo de execução e orçamento de abertura.
--
-- O término previsto passa a ser DERIVADO do tempo de execução (horas ou dias)
-- a partir do início previsto; propostas e contrapropostas negociam valor,
-- tempo ou os dois. A empresa pode abrir a cotação já com um orçamento.
-- Tudo aditivo e nulo: aerografias e negociações antigas seguem como estão.

CREATE TYPE "ExecutionTimeUnit" AS ENUM ('HOURS', 'DAYS');

ALTER TABLE "Airbrushing"
  ADD COLUMN "executionTime" INTEGER,
  ADD COLUMN "executionTimeUnit" "ExecutionTimeUnit",
  ADD COLUMN "quotationOfferAmount" DOUBLE PRECISION,
  ADD COLUMN "quotationOfferExecutionTime" INTEGER,
  ADD COLUMN "quotationOfferExecutionTimeUnit" "ExecutionTimeUnit";

ALTER TABLE "AirbrushingQuote"
  ADD COLUMN "executionTime" INTEGER,
  ADD COLUMN "executionTimeUnit" "ExecutionTimeUnit";

ALTER TABLE "AirbrushingQuoteEvent"
  ADD COLUMN "executionTime" INTEGER,
  ADD COLUMN "executionTimeUnit" "ExecutionTimeUnit";

-- O aviso de cotação nova passa a citar o orçamento de abertura ({{offer}}).
UPDATE "NotificationConfiguration" SET "templates" = E'{"push": {"body": "{{taskName}}{{#if serialNumber}} #{{serialNumber}}{{/if}} — aerografia aguardando sua proposta{{#if offer}} ({{offer}}){{/if}}", "title": "Novo Serviço para Cotar"}, "email": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} está em cotação.{{#if description}} Serviço: {{description}}.{{/if}}{{#if offer}} Orçamento da empresa: {{offer}}.{{/if}} Envie as suas condições pelo app.", "subject": "Novo Serviço para Cotar — {{taskName}}"}, "inApp": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} está em cotação.{{#if description}} Serviço: {{description}}.{{/if}}{{#if offer}} Orçamento da empresa: {{offer}}.{{/if}} Envie as suas condições pelo app.", "title": "Novo Serviço para Cotar"}, "whatsapp": {"body": "A aerografia da tarefa \\"{{taskName}}\\"{{#if serialNumber}} #{{serialNumber}}{{/if}}{{#if customerName}} — {{customerName}}{{/if}} está em cotação.{{#if description}} Serviço: {{description}}.{{/if}}{{#if offer}} Orçamento da empresa: {{offer}}.{{/if}} Envie as suas condições pelo app."}}'::jsonb, "updatedAt" = now() WHERE "key" = 'airbrushing.quote.requested';
