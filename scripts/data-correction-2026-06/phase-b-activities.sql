-- =============================================================================
-- PHASE B — Activity history corrections (3-year forensic cleanup)
-- Run AFTER phase A. Idempotent by construction (detectors find nothing on re-run).
--
-- IMPORTANT: raw SQL deliberately bypasses the API service, so Item.quantity is
-- NOT touched by these fixes. That is intended: current stock was re-trued by the
-- 2026 INVENTORY_COUNT balances; these edits fix CONSUMPTION HISTORY only, which
-- the metric engine (pnpm stock:correct / nightly cron) then re-reads.
--
-- B1. Cross-user double-entered stock balances (e.g. Michael+Gleverton pairs,
--     same item, same day, near-identical spike quantities seconds apart):
--     keep the earliest leg, DELETE the duplicates.
-- B2. Same-user double-click duplicates (same item/user/qty/op within 60 s, qty>=5):
--     DELETE the later leg.
-- B3. Surviving consumption spikes that are really informal stock balances
--     (> 5x item median AND >= p99 AND >= 20): reclassify PRODUCTION_USAGE/OTHER
--     -> INVENTORY_COUNT so the bulk-adjustment distributor smears them.
-- B4. Máscara 321/328 half-mask double-count: pre-2026 integer outbounds were
--     recorded in half-mask units -> divide by 2 (fractional rows are already real).
-- B5. Zero-quantity noise rows: DELETE.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE IF NOT EXISTS correction_log_20260609 (
  id bigserial PRIMARY KEY,
  phase text NOT NULL, step text NOT NULL, entity text NOT NULL, entity_id text NOT NULL,
  old_value jsonb, new_value jsonb, at timestamptz NOT NULL DEFAULT now()
);

-- per-item outbound stats (consumption reasons only)
CREATE TEMP TABLE _stats AS
SELECT "itemId",
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY quantity) AS med,
       percentile_cont(0.99) WITHIN GROUP (ORDER BY quantity) AS p99,
       count(*) AS n
FROM "Activity"
WHERE operation = 'OUTBOUND'
  AND reason NOT IN ('INVENTORY_COUNT','MANUAL_ADJUSTMENT')
GROUP BY 1;

-- ---------------------------------------------------------------------------
-- B1. cross-user same-day spike pairs -> delete later legs
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _b1_del AS
SELECT DISTINCT a2.id AS del_id, a1.id AS keep_id
FROM "Activity" a1
JOIN "Activity" a2
  ON a2."itemId" = a1."itemId"
 AND a2.id <> a1.id
 AND a2."createdAt" >  a1."createdAt"
 AND a2."createdAt" <= a1."createdAt" + interval '10 minutes'
 AND a2.operation = 'OUTBOUND' AND a1.operation = 'OUTBOUND'
 AND a1.reason IN ('PRODUCTION_USAGE','OTHER')
 AND a2.reason IN ('PRODUCTION_USAGE','OTHER')
 AND a1."userId" IS DISTINCT FROM a2."userId"
 AND abs(a2.quantity - a1.quantity) <= 2
 AND least(a1.quantity, a2.quantity) >= 20
JOIN _stats s ON s."itemId" = a1."itemId" AND s.n >= 8
WHERE least(a1.quantity, a2.quantity) > 3 * s.med;

-- never delete a row that is itself a keeper of another pair processed first
DELETE FROM _b1_del WHERE keep_id IN (SELECT del_id FROM _b1_del);

-- keep the B1 count around for the combined B1+B2 abort cap below
CREATE TEMP TABLE _b1_count AS SELECT count(*) AS n FROM _b1_del;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'B','B1-delete-crossuser-dup','Activity', a.id, to_jsonb(a) - 'updatedAt', NULL
FROM "Activity" a WHERE a.id IN (SELECT del_id FROM _b1_del);

DELETE FROM "Activity" WHERE id IN (SELECT del_id FROM _b1_del);

-- ---------------------------------------------------------------------------
-- B2. same-user duplicates within 60 s -> delete later legs
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _b2_del AS
SELECT DISTINCT a2.id AS del_id
FROM "Activity" a1
JOIN "Activity" a2
  ON a2."itemId" = a1."itemId"
 AND a2.id <> a1.id
 AND a2."userId" IS NOT DISTINCT FROM a1."userId"
 AND a2.operation = a1.operation
 AND a2.reason   = a1.reason
 AND a2.quantity = a1.quantity
 AND a2."createdAt" >  a1."createdAt"
 AND a2."createdAt" <= a1."createdAt" + interval '60 seconds'
WHERE a1.operation = 'OUTBOUND'
  AND a1.reason IN ('PRODUCTION_USAGE','OTHER')
  AND a1.quantity >= 5;

-- sanity cap (style of phase-b2 B6/B7): the 06-09 baseline was 29 B1 + 12 B2
-- deletions and the 06-10 rerun matched it exactly. If B1+B2 would delete more
-- than 50 rows on prod, the detectors are matching post-backup drift — abort
-- (single transaction: the B1 deletions above roll back too).
DO $$
DECLARE n int;
BEGIN
  SELECT (SELECT n FROM _b1_count) + count(*) INTO n FROM _b2_del;
  IF n > 50 THEN
    RAISE EXCEPTION 'B1+B2 detectors matched % delete rows (> 50; baseline 41): thresholds too loose for current data, aborting', n;
  END IF;
END $$;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'B','B2-delete-sameuser-dup','Activity', a.id, to_jsonb(a) - 'updatedAt', NULL
FROM "Activity" a WHERE a.id IN (SELECT del_id FROM _b2_del);

DELETE FROM "Activity" WHERE id IN (SELECT del_id FROM _b2_del);

-- ---------------------------------------------------------------------------
-- B3. reclassify surviving balance spikes -> INVENTORY_COUNT
--     (stats recomputed after B1/B2 deletions)
-- ---------------------------------------------------------------------------
-- Stats must reflect the ORIGINAL post-B1/B2 distribution on every run. Rows a
-- previous B3 run already reclassified (now INVENTORY_COUNT) and rows a later
-- B6 run deleted are unioned back in at their original quantities — otherwise
-- each re-run lowers med/p99 and reclassifies progressively normal draws
-- (feedback loop; observed 2026-06-10: 19 routine 24-unit Desengraxante box
-- draws were wrongly flagged on a second run).
CREATE TEMP TABLE _stats2 AS
SELECT "itemId",
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY quantity) AS med,
       percentile_cont(0.99) WITHIN GROUP (ORDER BY quantity) AS p99,
       count(*) AS n
FROM (
  SELECT "itemId", quantity FROM "Activity"
  WHERE operation = 'OUTBOUND'
    AND reason NOT IN ('INVENTORY_COUNT','MANUAL_ADJUSTMENT')
  UNION ALL
  SELECT a."itemId", (l.old_value->>'quantity')::double precision
  FROM correction_log_20260609 l
  JOIN "Activity" a ON a.id::text = l.entity_id
  WHERE l.step = 'B3-reclass-spike'
  UNION ALL
  SELECT (l.old_value->>'itemId'), (l.old_value->>'quantity')::double precision
  FROM correction_log_20260609 l
  WHERE l.step = 'B6-delete-crossday-dup'
    AND l.old_value->>'operation' = 'OUTBOUND'
    AND l.old_value->>'reason' IN ('PRODUCTION_USAGE','OTHER')
) src
GROUP BY 1 HAVING count(*) >= 20;

CREATE TEMP TABLE _b3_reclass AS
SELECT a.id
FROM "Activity" a
JOIN _stats2 s ON s."itemId" = a."itemId"
WHERE a.operation = 'OUTBOUND'
  AND a.reason IN ('PRODUCTION_USAGE','OTHER')
  AND a.quantity > 5 * s.med
  AND a.quantity >= s.p99
  AND a.quantity >= 20
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'B3-reclass-spike' AND l.entity_id = a.id::text);

-- sanity cap: 30 reclassifications on both the 06-09 and 06-10 runs; abort if
-- prod drift makes the detector match far more
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _b3_reclass;
  IF n > 40 THEN
    RAISE EXCEPTION 'B3 detector matched % reclassifications (> 40; baseline 30): thresholds too loose for current data, aborting', n;
  END IF;
END $$;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'B','B3-reclass-spike','Activity', a.id,
       jsonb_build_object('reason', a.reason, 'quantity', a.quantity),
       jsonb_build_object('reason', 'INVENTORY_COUNT')
FROM "Activity" a WHERE a.id IN (SELECT id FROM _b3_reclass);

UPDATE "Activity"
SET reason = 'INVENTORY_COUNT', "updatedAt" = now()
WHERE id IN (SELECT id FROM _b3_reclass);

-- ---------------------------------------------------------------------------
-- B4. Máscara 321/328: pre-2026 integer outbounds were half-mask units -> /2
-- ---------------------------------------------------------------------------
-- guard: the two hardcoded mask item UUIDs must still be the items captured
-- from the 2026-06-10 prod backup. Both were named 'Máscara' in the backup;
-- phase-a6 (which runs before this phase) renames them to 'Máscara de
-- Transferência 321/328' — accept either. Anything else = drift -> ABORT
-- (halving the wrong item's history is not recoverable by a re-run).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Item" WHERE id = '5334cf95-0e83-404e-a8c0-cd84c888b6c7'
                   AND name IN ('Máscara','Máscara de Transferência 328')) THEN
    RAISE EXCEPTION 'B4 mask guard failed: 5334cf95 is not Máscara (de Transferência 328) — id/name drift vs the 2026-06-10 backup, aborting';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Item" WHERE id = '33ed541a-343c-4232-bf6d-921dfdf198a6'
                   AND name IN ('Máscara','Máscara de Transferência 321')) THEN
    RAISE EXCEPTION 'B4 mask guard failed: 33ed541a is not Máscara (de Transferência 321) — id/name drift vs the 2026-06-10 backup, aborting';
  END IF;
END $$;

CREATE TEMP TABLE _b4 AS
SELECT a.id, a.quantity
FROM "Activity" a
WHERE a."itemId" IN ('5334cf95-0e83-404e-a8c0-cd84c888b6c7',  -- Máscara 328
                     '33ed541a-343c-4232-bf6d-921dfdf198a6')  -- Máscara 321
  AND a.operation = 'OUTBOUND'
  AND a.reason IN ('PRODUCTION_USAGE','OTHER')
  AND a.quantity = trunc(a.quantity)
  AND a.quantity >= 1
  AND a."createdAt" < '2026-01-01'
  -- halve each row exactly ONCE: an even quantity stays an integer after /2,
  -- so the fractional-check alone does not survive a re-run (observed
  -- 2026-06-10: 11 rows double-halved 2 -> 1 -> 0.5 before this guard existed)
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'B4-mask-halving' AND l.entity_id = a.id::text);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'B','B4-mask-halving','Activity', b.id,
       jsonb_build_object('quantity', b.quantity),
       jsonb_build_object('quantity', b.quantity / 2)
FROM _b4 b;

UPDATE "Activity" a SET quantity = a.quantity / 2, "updatedAt" = now()
FROM _b4 b WHERE a.id = b.id;

-- ---------------------------------------------------------------------------
-- B5. zero-quantity noise rows (paint formula components that rounded to 0)
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'B','B5-delete-zero-qty','Activity', a.id, to_jsonb(a) - 'updatedAt', NULL
FROM "Activity" a WHERE a.quantity = 0;

DELETE FROM "Activity" WHERE quantity = 0;

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
SELECT step, count(*) FROM correction_log_20260609 WHERE phase='B' GROUP BY 1 ORDER BY 1;

COMMIT;
