-- =============================================================================
-- PHASE B2 — Residual activity corrections (forensic findings B6+, addendum to
-- phase B). Run AFTER phase B. Idempotent by construction (detectors find
-- nothing on re-run; one-time flags are guarded by NOT EXISTS on the log).
--
-- Convention reminders (same as phase B): Item.quantity is NEVER touched
-- (overstated stock goes on the physical-recount list); activities are never
-- CREATED; every change is logged to correction_log_20260609 with old values —
-- deleted Activity rows log their FULL row JSON.
--
-- B6. Residual cross-user same-day duplicate outbound spikes: extends the B1
--     detector from a 10-minute window to the full calendar day and drops the
--     qty>=20 floor. Pairs/triples of PRODUCTION_USAGE/OTHER OUT legs on the
--     same item, same day, DIFFERENT users, quantities equal +/-1, every leg
--     >= 8x the item's median nonzero consumption OUT (and >= 8 absolute).
--     Keep the EARLIEST leg of each group (same as B1), DELETE the rest.
--     Unlike B1, chains are resolved transitively (a leg is deleted when ANY
--     earlier same-day candidate exists), so A->B->C triples where A/C share
--     a user still collapse to A (B1's keeper-protection would orphan C).
--     Earlier candidates include legs ALREADY DELETED by phase B/B2 (rebuilt
--     from their full-JSON log rows), so partial prior runs cannot orphan the
--     tail of a chain; the earliest leg of a component is never deleted.
--     Safety: aborts if the detector matches > 25 groups (thresholds too
--     loose). Legitimate same-day pack draws (Palha de Aco 40/40 med 20,
--     Fita Crepe 36/36 med 36) sit far below 8x median and cannot match.
-- B7. Double-booked order-receipt inbounds AT ITEM LEVEL: ORDER_RECEIVED
--     INBOUND legs grouped by (itemId, supplierId, day) across >= 2 OrderItems
--     where the booked total is an integer multiple (N >= 2) of the largest
--     per-line receivedQuantity (stale order + reorder both batch-received the
--     same day: Azul and Thinner 7000 on 2026-01-16). Keep the earliest legs
--     whose running sum equals the target, DELETE the surplus legs.
--     NOTE: the original forensic list (Faixa Refletiva 200/100, Garrafa
--     Quadrada 90/30, Abracadeira Nylon Preta 24/8, Branco 32/16) aggregated
--     by item NAME; at itemId level those legs belong to DISTINCT items that
--     share a display name (clamp/bottle sizes; two whites; a suspected
--     duplicate "Faixa Refletiva" item pair created 1 min apart). Deleting
--     them would corrupt unrelated items' histories, so they are logged as
--     B7-flag-name-collision skips instead (owner review / merge + recount).
--     The Mascara UNDER-booked OrderItem (54 booked vs 108 received) is logged
--     as B7-flag-underbooked only — activities are never created.
-- B8. Pacote Pincel de Retoque (C/50): the 2026-02-10 INVENTORY_COUNT INBOUND
--     of 157 counted brushes, not packs -> rescale 157 -> 3 (157/50 rounded).
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE IF NOT EXISTS correction_log_20260609 (
  id bigserial PRIMARY KEY,
  phase text NOT NULL, step text NOT NULL, entity text NOT NULL, entity_id text NOT NULL,
  old_value jsonb, new_value jsonb, at timestamptz NOT NULL DEFAULT now()
);

-- per-item outbound stats (nonzero consumption reasons only)
CREATE TEMP TABLE _b6_stats AS
SELECT "itemId",
       percentile_cont(0.5) WITHIN GROUP (ORDER BY quantity) AS med,
       count(*) AS n
FROM "Activity"
WHERE operation = 'OUTBOUND'
  AND reason NOT IN ('INVENTORY_COUNT','MANUAL_ADJUSTMENT')
  AND quantity > 0
GROUP BY 1;

-- ---------------------------------------------------------------------------
-- B6. cross-user same-day spike groups -> delete all but the earliest leg
-- ---------------------------------------------------------------------------
-- anchors = live consumption OUT legs UNION legs already deleted by phase B/B2
-- (rebuilt from their full-JSON log rows), so chains survive prior deletions
CREATE TEMP TABLE _b6_anchor AS
SELECT a.id, a."itemId", a."userId", a.quantity, a."createdAt"
FROM "Activity" a
WHERE a.operation = 'OUTBOUND' AND a.reason IN ('PRODUCTION_USAGE','OTHER')
UNION ALL
SELECT l.old_value->>'id', l.old_value->>'itemId', l.old_value->>'userId',
       (l.old_value->>'quantity')::double precision,
       (l.old_value->>'createdAt')::timestamp
FROM correction_log_20260609 l
WHERE l.entity = 'Activity' AND l.new_value IS NULL
  AND l.old_value->>'operation' = 'OUTBOUND'
  AND l.old_value->>'reason' IN ('PRODUCTION_USAGE','OTHER');

-- a live leg is deleted when ANY earlier same-day cross-user near-equal spike
-- anchor exists (transitive: the earliest leg of a component is never deleted)
CREATE TEMP TABLE _b6_del AS
SELECT DISTINCT a2.id AS del_id, a2."itemId", a2."createdAt"::date AS day
FROM _b6_anchor a1
JOIN "Activity" a2
  ON a2."itemId" = a1."itemId"
 AND a2.id <> a1.id
 AND a2."createdAt" >  a1."createdAt"
 AND a2."createdAt"::date = a1."createdAt"::date
 AND a2.operation = 'OUTBOUND'
 AND a2.reason IN ('PRODUCTION_USAGE','OTHER')
 AND a1."userId" IS DISTINCT FROM a2."userId"
 AND abs(a2.quantity - a1.quantity) <= 1
JOIN _b6_stats s ON s."itemId" = a1."itemId" AND s.n >= 8
WHERE least(a1.quantity, a2.quantity) >= 8 * s.med
  AND least(a1.quantity, a2.quantity) >= 8;          -- absolute floor (sub-unit medians)

-- sanity cap: the 2026-06 forensic sweep found ~15 groups; abort if far more
DO $$
DECLARE n int;
BEGIN
  SELECT count(DISTINCT ("itemId", day)) INTO n FROM _b6_del;
  IF n > 25 THEN
    RAISE EXCEPTION 'B6 detector matched % groups (> 25): thresholds too loose, aborting', n;
  END IF;
END $$;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'B2','B6-delete-crossday-dup','Activity', a.id, to_jsonb(a) - 'updatedAt', NULL
FROM "Activity" a WHERE a.id IN (SELECT del_id FROM _b6_del);

DELETE FROM "Activity" WHERE id IN (SELECT del_id FROM _b6_del);

-- ---------------------------------------------------------------------------
-- B7. double-booked order receipts (item level) -> delete surplus legs
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _b7_legs AS
SELECT a.id, a."itemId", a.quantity, a."createdAt", a."createdAt"::date AS day,
       oi.id AS oi_id, oi."receivedQuantity" AS recv, o."supplierId" AS supplier_id
FROM "Activity" a
JOIN "OrderItem" oi ON oi.id = a."orderItemId"
JOIN "Order" o ON o.id = oi."orderId"
WHERE a.operation = 'INBOUND' AND a.reason = 'ORDER_RECEIVED'
  AND oi."receivedQuantity" > 0;

CREATE TEMP TABLE _b7_grp AS
SELECT "itemId", supplier_id, day, max(recv) AS target
FROM _b7_legs
GROUP BY 1,2,3
HAVING count(DISTINCT oi_id) >= 2
   AND sum(quantity) > max(recv)
   AND sum(quantity) = round(sum(quantity) / max(recv)) * max(recv)
   AND sum(quantity) / max(recv) >= 2;

-- sanity cap: the 2026-06 forensic sweep confirmed 2 item-level groups
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _b7_grp;
  IF n > 10 THEN
    RAISE EXCEPTION 'B7 detector matched % groups (> 10): thresholds too loose, aborting', n;
  END IF;
END $$;

-- keep the earliest legs whose running sum equals the target; delete the rest
CREATE TEMP TABLE _b7_run AS
SELECT l.id, l."itemId", l.supplier_id, l.day, g.target,
       sum(l.quantity) OVER (PARTITION BY l."itemId", l.supplier_id, l.day
                             ORDER BY l."createdAt", l.id) AS run
FROM _b7_legs l
JOIN _b7_grp g ON g."itemId" = l."itemId" AND g.day = l.day
             AND g.supplier_id IS NOT DISTINCT FROM l.supplier_id;

CREATE TEMP TABLE _b7_del AS
SELECT r.id
FROM _b7_run r
WHERE r.run > r.target
  AND EXISTS (SELECT 1 FROM _b7_run x                 -- only when an exact prefix exists
              WHERE x."itemId" = r."itemId" AND x.day = r.day
                AND x.supplier_id IS NOT DISTINCT FROM r.supplier_id
                AND x.run = x.target);

-- groups with no exact keep-prefix are skipped and flagged once (manual review)
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'B2','B7-skipped-no-exact-prefix','ItemDayGroup', g."itemId" || '@' || g.day, NULL,
       jsonb_build_object('target', g.target, 'note', 'no leg prefix sums to target; manual review')
FROM _b7_grp g
WHERE NOT EXISTS (SELECT 1 FROM _b7_run x
                  WHERE x."itemId" = g."itemId" AND x.day = g.day
                    AND x.supplier_id IS NOT DISTINCT FROM g.supplier_id AND x.run = x.target)
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'B7-skipped-no-exact-prefix'
                    AND l.entity_id = g."itemId" || '@' || g.day);

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'B2','B7-delete-double-receipt','Activity', a.id, to_jsonb(a) - 'updatedAt', NULL
FROM "Activity" a WHERE a.id IN (SELECT id FROM _b7_del);

DELETE FROM "Activity" WHERE id IN (SELECT id FROM _b7_del);

-- ---------------------------------------------------------------------------
-- B7 flags — logged once, NO data change
-- ---------------------------------------------------------------------------
-- under-booked receipts (e.g. Mascara 54 booked vs 108 received): convention
-- forbids creating activities, so flag only
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'B2','B7-flag-underbooked','OrderItem', oi.id,
       jsonb_build_object('receivedQuantity', oi."receivedQuantity", 'booked', sum(a.quantity)),
       jsonb_build_object('note', 'inbound activities < receivedQuantity; NOT fixed (never create activities)')
FROM "OrderItem" oi
JOIN "Activity" a ON a."orderItemId" = oi.id AND a.operation = 'INBOUND'
WHERE oi."receivedQuantity" > 0
  AND NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'B7-flag-underbooked' AND l.entity_id = oi.id)
GROUP BY oi.id, oi."receivedQuantity"
HAVING sum(a.quantity) < oi."receivedQuantity";

-- name-collision pseudo-duplicates: name-level booked total is an N>=2 multiple
-- of the largest line, but the legs belong to DISTINCT items sharing a display
-- name (sizes/variants, or a suspected duplicate item pair) -> owner review,
-- possible item merge + physical recount; activities NOT deleted
CREATE TEMP TABLE _b7_legs2 AS
SELECT a.id, a."itemId", i.name, a.quantity, a."createdAt"::date AS day,
       oi.id AS oi_id, oi."receivedQuantity" AS recv
FROM "Activity" a
JOIN "OrderItem" oi ON oi.id = a."orderItemId"
JOIN "Order" o ON o.id = oi."orderId"
JOIN "Item" i ON i.id = a."itemId"
WHERE a.operation = 'INBOUND' AND a.reason = 'ORDER_RECEIVED'
  AND oi."receivedQuantity" > 0;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'B2','B7-flag-name-collision','ItemNameDayGroup', g.name || '@' || g.day, NULL,
       jsonb_build_object('total', g.total, 'max_recv', g.max_recv, 'n_legs', g.n_legs,
                          'n_items', g.n_items,
                          'note', 'distinct items share this name; NOT deleted; review for item dup/merge + recount')
FROM (
  SELECT name, day, sum(quantity) AS total, max(recv) AS max_recv,
         count(*) AS n_legs, count(DISTINCT "itemId") AS n_items
  FROM _b7_legs2
  GROUP BY 1,2
  HAVING count(DISTINCT "itemId") >= 2
     AND sum(quantity) > max(recv)
     AND sum(quantity) = round(sum(quantity) / max(recv)) * max(recv)
     AND sum(quantity) / max(recv) >= 2
) g
WHERE NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step = 'B7-flag-name-collision'
                    AND l.entity_id = g.name || '@' || g.day);

-- ---------------------------------------------------------------------------
-- B8. Pacote Pincel de Retoque (C/50): 2026-02-10 count entered in brushes,
--     not packs -> 157 / 50 rounded = 3
-- ---------------------------------------------------------------------------
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'B2','B8-pincel-pack-rescale','Activity', a.id,
       jsonb_build_object('quantity', a.quantity),
       jsonb_build_object('quantity', 3)
FROM "Activity" a
JOIN "Item" i ON i.id = a."itemId"
WHERE a.id = '845e68f6-7ce1-4fbb-b518-930203ab2006'
  AND i.name = 'Pacote Pincel de Retoque'
  AND a.operation = 'INBOUND' AND a.reason = 'INVENTORY_COUNT'
  AND a.quantity = 157;

UPDATE "Activity" a SET quantity = 3, "updatedAt" = now()
FROM "Item" i
WHERE i.id = a."itemId"
  AND a.id = '845e68f6-7ce1-4fbb-b518-930203ab2006'
  AND i.name = 'Pacote Pincel de Retoque'
  AND a.operation = 'INBOUND' AND a.reason = 'INVENTORY_COUNT'
  AND a.quantity = 157;

-- unknown/already-fixed row is logged as skipped instead of failing (once)
INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'B2','B8-skipped-unknown-row','Activity', '845e68f6-7ce1-4fbb-b518-930203ab2006', NULL,
       jsonb_build_object('note', 'expected qty-157 INVENTORY_COUNT INBOUND not found; manual review')
WHERE NOT EXISTS (SELECT 1 FROM correction_log_20260609 l
                  WHERE l.step IN ('B8-pincel-pack-rescale','B8-skipped-unknown-row')
                    AND l.entity_id = '845e68f6-7ce1-4fbb-b518-930203ab2006');

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
SELECT step, count(*) FROM correction_log_20260609 WHERE phase='B2' GROUP BY 1 ORDER BY 1;

COMMIT;
