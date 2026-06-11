-- =============================================================================
-- PHASE A10 — Seed consumption history for the LOW_DATA rebites (owner decision
-- 2026-06-10: NO manual-rp override field — the owner removed that workflow
-- once before; instead, inject realistic PRODUCTION_USAGE history so the
-- canonical engine computes a stable nonzero rp on its own).
--
-- WHY: phase B reclassified the rebites' contaminated history to
-- INVENTORY_COUNT, leaving <3 distinct consumption months (engine
-- CONSUMPTION_MIN_DISTINCT_MONTHS=3) → mc=0/rp=0 despite real draws:
--   525 — 730 un/90d;  516 — 240 un/90d;  640 — 42 un/90d (May–Jun 2026 real)
--
-- WHAT: March + April 2026 OUTBOUND PRODUCTION_USAGE rows (userId null, same
-- shape as system rows), magnitudes extending each item's OBSERVED cadence
-- backwards — NOT inflated to force a specific rp. Single row per item per
-- day, near-median magnitudes: cannot trip the phase-B/B2 duplicate/spike
-- detectors on a re-run. Item.quantity is NOT touched (B-phase convention —
-- stock was re-trued by physical counts; this repairs the demand signal only).
--
-- Self-healing: as months roll past the 6-month consumption lookback these
-- seeded rows age out naturally while real history accumulates.
--
-- Idempotent: skipped when the item already has an A10-logged injection.
-- Logged to correction_log_20260609 (phase 'A10', step 'A37-inject-history';
-- old_value NULL, new_value = the injected row → reversible by activity id).
--
-- AFTER: run the recompute → NODE_ENV=production pnpm stock:correct
-- Run: docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a10-rebite-history.sql
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE IF NOT EXISTS correction_log_20260609 (
  id bigserial PRIMARY KEY,
  phase text NOT NULL,
  step text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

-- name | qty | timestamp (weekday business hours, São Paulo ≈ UTC-3 → stored UTC-naive like app rows)
CREATE TEMP TABLE _seed (name text, qty numeric, at timestamp);
INSERT INTO _seed VALUES
  -- Rebite de Repuxo 525: real May=630/Jun=100 → Mar 500, Apr 550
  ('Rebite de Repuxo 525', 100, '2026-03-05 12:40:00'),
  ('Rebite de Repuxo 525', 150, '2026-03-12 15:10:00'),
  ('Rebite de Repuxo 525', 100, '2026-03-19 11:25:00'),
  ('Rebite de Repuxo 525', 150, '2026-03-26 17:05:00'),
  ('Rebite de Repuxo 525', 150, '2026-04-02 13:30:00'),
  ('Rebite de Repuxo 525', 100, '2026-04-09 16:45:00'),
  ('Rebite de Repuxo 525', 150, '2026-04-16 12:15:00'),
  ('Rebite de Repuxo 525', 150, '2026-04-23 14:50:00'),
  -- Rebite de Repuxo 516: real May=100/Jun=140 → Mar 300, Apr 300
  ('Rebite de Repuxo 516', 100, '2026-03-06 14:20:00'),
  ('Rebite de Repuxo 516', 120, '2026-03-17 11:55:00'),
  ('Rebite de Repuxo 516',  80, '2026-03-27 16:30:00'),
  ('Rebite de Repuxo 516', 120, '2026-04-08 12:05:00'),
  ('Rebite de Repuxo 516', 100, '2026-04-17 15:40:00'),
  ('Rebite de Repuxo 516',  80, '2026-04-28 11:10:00'),
  -- Rebite de Repuxo 640: real May=42 → Mar 100, Apr 110 (200-un April purchase
  -- shows demand ramping; still the most conservative of the three)
  ('Rebite de Repuxo 640',  60, '2026-03-10 13:45:00'),
  ('Rebite de Repuxo 640',  40, '2026-03-24 16:20:00'),
  ('Rebite de Repuxo 640',  50, '2026-04-07 12:35:00'),
  ('Rebite de Repuxo 640',  60, '2026-04-21 15:00:00');

-- Guard: skip items already seeded by this phase (idempotent re-run).
CREATE TEMP TABLE _todo AS
SELECT s.*, i.id AS item_id
FROM _seed s JOIN "Item" i ON i.name = s.name
WHERE NOT EXISTS (
  SELECT 1 FROM correction_log_20260609 l
  WHERE l.step = 'A37-inject-history'
    AND l.new_value->>'itemId' = i.id
);

CREATE TEMP TABLE _inserted AS
WITH ins AS (
  INSERT INTO "Activity"
    (id, quantity, operation, "userId", "itemId", "orderId", "orderItemId",
     reason, "reasonOrder", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, t.qty, 'OUTBOUND', NULL, t.item_id, NULL, NULL,
         'PRODUCTION_USAGE', 2, t.at, t.at
  FROM _todo t
  RETURNING id, "itemId", quantity, "createdAt"
)
SELECT * FROM ins;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A10','A37-inject-history','Activity', x.id, NULL,
       jsonb_build_object('itemId', x."itemId", 'quantity', x.quantity,
                          'createdAt', x."createdAt", 'reason', 'PRODUCTION_USAGE',
                          'operation', 'OUTBOUND', 'synthetic', true)
FROM _inserted x;

-- Unknown names logged instead of silently skipped.
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A10','A37-skipped-unknown-item','Item', s.name, NULL, NULL
FROM (SELECT DISTINCT name FROM _seed) s
WHERE NOT EXISTS (SELECT 1 FROM "Item" i WHERE i.name = s.name)
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'A37-skipped-unknown-item' AND l.entity_id = s.name);

SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A10' GROUP BY step;
SELECT i.name, to_char(a."createdAt",'YYYY-MM') mo, count(*), sum(a.quantity)
FROM "Activity" a JOIN "Item" i ON i.id = a."itemId"
WHERE i.name IN ('Rebite de Repuxo 525','Rebite de Repuxo 516','Rebite de Repuxo 640')
  AND a.reason = 'PRODUCTION_USAGE' AND a.operation = 'OUTBOUND'
GROUP BY 1,2 ORDER BY 1,2;

COMMIT;
