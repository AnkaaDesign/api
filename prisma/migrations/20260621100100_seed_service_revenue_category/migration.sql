-- ENTRADA classification: a single service-revenue category that incoming
-- receipts settling a task / external-operation receivable are tagged with on
-- reconciliation. Mirrors how the saída side derives a category from NF items, so
-- the Conciliação detail + accounting distribution show the income's cost group.
-- Not self-resolving: the tag is applied by the receivable match, not the classifier.
INSERT INTO "TransactionCategory" ("id","name","slug","kind","isResolving","isRecurring","accountingType","color","sortOrder")
VALUES (gen_random_uuid(), 'Receita de Serviços', 'receita-servicos', 'SERVICE', false, false, 'RECEITA_SERVICOS', '#10b981', 5)
ON CONFLICT ("slug") DO NOTHING;
