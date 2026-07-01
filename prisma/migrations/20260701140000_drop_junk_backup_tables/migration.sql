-- Cleanup: drop one-off data-surgery backup / fix / correction tables left behind
-- by prior manual interventions (2026-06-09 .. 2026-06-30). None are Prisma models;
-- they are ad-hoc snapshots that are no longer needed. Includes two User password
-- backup tables (a standing security liability). IF EXISTS keeps this idempotent and
-- safe to run against any environment that may or may not still have them.
DROP TABLE IF EXISTS "Item_fastnorm_bak20260629" CASCADE;
DROP TABLE IF EXISTS "Item_paraf20260629_bak" CASCADE;
DROP TABLE IF EXISTS "Measure_fastnorm_bak20260629" CASCADE;
DROP TABLE IF EXISTS "Measure_paraf20260629_bak" CASCADE;
DROP TABLE IF EXISTS "MonetaryValue_paraf20260629_bak" CASCADE;
DROP TABLE IF EXISTS "NotificationTargetRule_acctbackup20260626" CASCADE;
DROP TABLE IF EXISTS "OrderItem_lixapromo20260630_bak" CASCADE;
DROP TABLE IF EXISTS "OrderItem_parafuso20260630_bak" CASCADE;
DROP TABLE IF EXISTS "OrderItem_pedido_bak20260629" CASCADE;
DROP TABLE IF EXISTS "OrderItem_pedido_bak20260629_v2" CASCADE;
DROP TABLE IF EXISTS "ServiceOrder_fix20260625_37814" CASCADE;
DROP TABLE IF EXISTS "ServiceOrder_fix20260625_marquespan" CASCADE;
DROP TABLE IF EXISTS "TaskForecastHistory_fix20260625_marquespan" CASCADE;
DROP TABLE IF EXISTS "TaskQuoteCustomerConfig_fix20260623" CASCADE;
DROP TABLE IF EXISTS "TaskQuoteService_fix20260623" CASCADE;
DROP TABLE IF EXISTS "TaskQuoteService_fix20260625_37814" CASCADE;
DROP TABLE IF EXISTS "TaskQuote_fix20260623" CASCADE;
DROP TABLE IF EXISTS "TaskQuote_fix20260625_marquespan" CASCADE;
DROP TABLE IF EXISTS "Task_fix20260625_marquespan" CASCADE;
DROP TABLE IF EXISTS "Truck_fix20260625_marquespan" CASCADE;
DROP TABLE IF EXISTS "User_pwbackup20260626" CASCADE;
DROP TABLE IF EXISTS "User_pwbackup20260630" CASCADE;
DROP TABLE IF EXISTS "_fix20260622_cph" CASCADE;
DROP TABLE IF EXISTS "_fix20260622_ec" CASCADE;
DROP TABLE IF EXISTS "_fix20260622_user" CASCADE;
DROP TABLE IF EXISTS "_fix20260622b_cph" CASCADE;
DROP TABLE IF EXISTS "_fix20260622b_ec" CASCADE;
DROP TABLE IF EXISTS "_fix20260622b_user" CASCADE;
DROP TABLE IF EXISTS "correction_log_20260609" CASCADE;
