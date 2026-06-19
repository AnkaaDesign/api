-- ENTRADA classification: a resolving income category so incoming bank yield /
-- interest credits (subtype RENDIMENTO, memo "rendimento"/"juros") classify and
-- self-reconcile, mirroring how outflow TRANSACTION_ONLY categories work.
INSERT INTO "TransactionCategory" ("id","name","slug","kind","isResolving","isRecurring","accountingType","sortOrder")
VALUES (gen_random_uuid(), 'Rendimentos Financeiros', 'rendimentos', 'TRANSACTION_ONLY', true, false, 'APLICACAO_FINANCEIRA', 19)
ON CONFLICT ("slug") DO NOTHING;
