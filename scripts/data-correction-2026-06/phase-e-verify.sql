-- =============================================================================
-- PHASE E — Verification (read-only). Run after phases A, B and `pnpm stock:correct`.
-- =============================================================================

-- E1. Taxonomy: category distribution (active items)
SELECT c.name, c.type, count(i.id) FILTER (WHERE i."isActive") AS active_items
FROM "ItemCategory" c LEFT JOIN "Item" i ON i."categoryId" = c.id
GROUP BY c.name, c.type ORDER BY c.name;

-- E2. No active item without category; no item in a dropped category
SELECT count(*) AS active_items_without_category FROM "Item" WHERE "categoryId" IS NULL AND "isActive";

-- E3. Merge integrity: losers hold no quantity and no transactional FKs
SELECT i.id, i.name, i.quantity,
       (SELECT count(*) FROM "Activity"  a WHERE a."itemId" = i.id) AS acts,
       (SELECT count(*) FROM "OrderItem" o WHERE o."itemId" = i.id) AS order_items,
       (SELECT count(*) FROM "Borrow"    b WHERE b."itemId" = i.id) AS borrows
FROM "Item" i
WHERE i."deactivationReason" LIKE 'Unificado:%'
  AND (i.quantity <> 0
       OR EXISTS (SELECT 1 FROM "Activity"  a WHERE a."itemId" = i.id)
       OR EXISTS (SELECT 1 FROM "OrderItem" o WHERE o."itemId" = i.id)
       OR EXISTS (SELECT 1 FROM "Borrow"    b WHERE b."itemId" = i.id));

-- E4. PPE coherence: active PPE-category items must have ppeType
SELECT count(*) AS active_ppe_missing_ppetype
FROM "Item" i JOIN "ItemCategory" c ON c.id = i."categoryId"
WHERE c.type = 'PPE' AND i."isActive" AND i."ppeType" IS NULL;

-- E5. Consumption sanity on the previously-worst divergent items
-- (stored mc vs 12-month median of monthly real consumption)
WITH monthly AS (
  SELECT a."itemId", date_trunc('month', a."createdAt") AS mo, sum(a.quantity) AS qty
  FROM "Activity" a
  WHERE a.operation = 'OUTBOUND'
    -- text comparison: works both before and after migration 20260610090000
    -- renamed EXTERNAL_WITHDRAWAL -> EXTERNAL_OPERATION
    AND a.reason::text IN ('PRODUCTION_USAGE','PAINT_PRODUCTION','EXTERNAL_WITHDRAWAL','EXTERNAL_OPERATION','MAINTENANCE','DAMAGE','LOSS','OTHER')
    AND a."createdAt" >= now() - interval '12 months'
  GROUP BY 1, 2
)
SELECT i.name, round(i."monthlyConsumption", 1) AS stored_mc,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY m.qty)::numeric, 1) AS median_mo,
       round((i."monthlyConsumption" / NULLIF(percentile_cont(0.5) WITHIN GROUP (ORDER BY m.qty), 0))::numeric, 2) AS ratio
FROM "Item" i JOIN monthly m ON m."itemId" = i.id
WHERE i.id IN ('b4d313c5-6bc7-455a-9582-a824bce79aec',  -- Pincel (was 3.88x)
               '1993cbdb-4420-49a0-8508-3e1ff72fc58d',  -- Espátula Rígida (was 3.72x)
               '8d73219c-694d-4a04-9b6f-000000000000') -- placeholder
   OR i.name IN ('Palha de Aço','Desengraxante','Fita Crepe Automotiva','Fita Crepe Amarela','Máscara')
GROUP BY i.id, i.name, i."monthlyConsumption"
ORDER BY ratio DESC NULLS LAST;

-- E6. Items whose reorderPoint is below their peak real weekly usage (13 weeks)
WITH wk AS (
  SELECT "itemId", date_trunc('week', "createdAt") AS w, sum(quantity) AS wqty
  FROM "Activity"
  WHERE operation = 'OUTBOUND'
    AND "createdAt" >= now() - interval '13 weeks'
    AND reason::text IN ('PRODUCTION_USAGE','PAINT_PRODUCTION','EXTERNAL_WITHDRAWAL','EXTERNAL_OPERATION','MAINTENANCE','DAMAGE','LOSS','OTHER')
  GROUP BY 1, 2
), peak AS (SELECT "itemId", max(wqty) AS peak_week FROM wk GROUP BY 1)
SELECT count(*) AS items_rp_below_peak_week
FROM "Item" i JOIN peak p ON p."itemId" = i.id
JOIN "ItemCategory" c ON c.id = i."categoryId"
WHERE i."isActive" AND c.type = 'REGULAR'
  AND COALESCE(i."reorderPoint", 0) < p.peak_week;

-- E7. Correction log totals
SELECT phase, step, count(*) FROM correction_log_20260609 GROUP BY 1, 2 ORDER BY 1, 2;

-- E8. Activity row count and reason distribution after corrections
SELECT reason, count(*), round(sum(quantity)::numeric, 0) AS units
FROM "Activity" WHERE operation = 'OUTBOUND' GROUP BY 1 ORDER BY 2 DESC;
