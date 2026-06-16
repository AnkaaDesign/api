-- Complete all open ServiceOrders (of every type) for the 27 historical task
-- service orders listed by the user (2026-06-15). The parent Tasks are already
-- COMPLETED; their per-sector ServiceOrders (COMMERCIAL / LOGISTIC / ARTWORK /
-- PRODUCTION) were left partially open (the "x/y" fractions on the schedule).
--
-- For every open SO (status not COMPLETED/CANCELLED):
--   status      -> COMPLETED
--   statusOrder -> 4  (SERVICE_ORDER_STATUS_ORDER[COMPLETED])
--   finishedAt  -> the parent task's finishedAt (keeps bonus/payroll periods accurate)
--   startedAt   -> existing startedAt, else task.startedAt, else task.finishedAt
--
-- Idempotent: re-running only affects rows still open.

UPDATE "ServiceOrder" so
SET "status" = 'COMPLETED',
    "statusOrder" = 4,
    "finishedAt" = COALESCE(so."finishedAt", t."finishedAt"),
    "startedAt"  = COALESCE(so."startedAt", t."startedAt", t."finishedAt"),
    "updatedAt"  = now()
FROM "Task" t
WHERE so."taskId" = t.id
  AND so."taskId" IN (
    '64980b0f-f34a-4ba6-8d4c-e609767ad454', -- 36936  Sapé
    '3735a8a0-d6c9-4664-8a78-e40e1e372c17', -- FGV8F83 Auriz foods
    '83735f2c-ca01-4412-a7ea-7d92eb192ac6', -- EQX9C19 Supermercado Confiança
    '73fce291-f7f9-4e3b-936e-7c8daa550493', -- RXK1F08 ACM
    '8260060d-4a55-4a4b-9eda-22992075ef83', -- 37184  Pnae
    '08cccc96-b3b4-4094-b4d3-8aa2eceaf08f', -- SVT3A86 Supermercado Confiança 9,00
    'fbc97f6d-a444-4a38-b0a3-8b708213dbf7', -- 37207  Transgenio
    'd225d630-d631-4521-a5b3-4609c39f8cf4', -- 37192  Astuti
    '1d419b20-83e1-4587-9601-9783c9f2e483', -- 37208  Transgenio
    'cce03622-8d1d-450b-920e-545c66ba597c', -- 37314  Jr distribuidora
    '848aea08-4bef-40ba-b295-ef20de425f2e', -- 36781  Mamão +
    'a39d78bc-5f0b-44a4-b7d7-76f7d0e4e20c', -- 36974  Sola Alimentos
    '8c7d8074-ab9a-4af3-be6b-f97701f4d909', -- 37395  Frontal e Traseira
    '7283205b-7019-4911-9685-4297897ac67a', -- RUR5D79 Pintura Geral
    'c60ded81-e2c8-4833-abd7-c07b5229712b', -- 36280  Bananas Marilandia
    'bae4784a-1f30-4a3c-98d3-1cfce8ed6d36', -- 37648  Pintura Geral Roxo
    '7404dc0d-4bbc-4355-a610-0de6c81f027e', -- ENB1B95 Marquespan
    'ac328e1e-46da-4292-9ba5-fc1b92f2e5b6', -- 38196  Friron
    '3aece508-9346-47e4-adb0-114f6ce877d4', -- 38197  Friron
    '89368d76-1d03-46b8-91ae-694dce036f07', -- EWR6787 Confiança Supermercado
    '0b386d4b-d9d6-45b9-a0ba-5b1077fa3a36', -- 38313  Frontal e Traseira Preto
    '98afac5c-941a-421a-afab-a964ab695d3c', -- 35163-RETRAB RDD
    '08e186cc-6373-433a-b240-71b36d586f9a', -- FDK1429 Confiança Supermercado
    '3e94068c-e4b0-4e47-84f3-e073bc8b42eb', -- BBO6929 Ibiporã
    'd831852c-788b-464a-a2dd-9d5515789c96', -- 37691  MIX Mineiro
    'e6511f91-8a0a-4706-86ec-b66c4f50859e', -- BDC4G82 Bergamini
    '171a7f63-b2d9-4957-bede-efada84ff68d'  -- 38328  TMR Marques Roberto
  )
  AND so."status" NOT IN ('COMPLETED', 'CANCELLED');
