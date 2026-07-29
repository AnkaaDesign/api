-- Item."totalPrice" is a denormalized cache of (latest price x quantity), used by
-- the item list column "Valor Total", the totalPriceRange filter, totalPrice
-- sorting and the PPE export. It was maintained ad-hoc by three TypeScript call
-- sites (item repo create/update, item merge step 14c) while ~20 other paths
-- mutate Item.quantity or insert MonetaryValue rows without touching it:
-- activity.service (increment on every INBOUND/OUTBOUND), order receipt,
-- order-item receipt edits, external-operation withdrawal/return, ppe-delivery
-- revert, paint-production, paint-formula-component, atomic-stock-update, and
-- item.service batchAdjustPrices (new price, quantity untouched).
--
-- Production state before this migration: 255 of 783 items carried a stale total
-- (aggregate R$ 611.251,80 stored vs R$ 622.220,06 correct) -- e.g. an item at
-- quantity 1 x R$ 170,00 rendering "Valor em Estoque R$ 1.020,00", a leftover
-- from when it held 6 units.
--
-- Maintaining the cache per-call-site has already failed once for every path
-- added since. Enforce the invariant in the database instead, so present and
-- future writers are covered by construction, then backfill the drifted rows.

-- Canonical "current price" for an item: newest MonetaryValue by createdAt.
-- This matches what the API include and the web detail page already read
-- (prices ordered by createdAt desc, take 1) so the stored total always agrees
-- with the "Preco Atual" shown next to it. The `current` boolean is NOT usable
-- as the selector: 438 items have no row flagged current at all.
CREATE OR REPLACE FUNCTION item_latest_price(p_item_id text)
RETURNS double precision
LANGUAGE sql
STABLE
AS $$
  SELECT mv.value
  FROM "MonetaryValue" mv
  WHERE mv."itemId" = p_item_id
  ORDER BY mv."createdAt" DESC, mv.id DESC
  LIMIT 1;
$$;

-- Quantity side. BEFORE-row so the recomputed total is part of the same tuple
-- write (Prisma's RETURNING hands the caller the correct value with no extra
-- round trip). Scoped to `UPDATE OF quantity` so the MonetaryValue trigger's
-- totalPrice-only UPDATE below cannot recurse into this one.
CREATE OR REPLACE FUNCTION item_sync_total_price()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."totalPrice" := COALESCE(item_latest_price(NEW.id), 0) * COALESCE(NEW.quantity, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS item_total_price_sync ON "Item";
CREATE TRIGGER item_total_price_sync
BEFORE INSERT OR UPDATE OF quantity ON "Item"
FOR EACH ROW
EXECUTE FUNCTION item_sync_total_price();

-- Price side. Covers INSERT (new price recorded), UPDATE (value edited, or
-- itemId re-pointed -- item merge moves the whole price history to the survivor,
-- so both the old and the new owner are refreshed) and DELETE.
CREATE OR REPLACE FUNCTION monetary_value_sync_item_total_price()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_item_ids text[];
  v_item_id  text;
BEGIN
  SELECT array_agg(DISTINCT id)
  INTO v_item_ids
  FROM (
    SELECT CASE WHEN TG_OP <> 'INSERT' THEN OLD."itemId" END AS id
    UNION ALL
    SELECT CASE WHEN TG_OP <> 'DELETE' THEN NEW."itemId" END AS id
  ) candidates
  WHERE id IS NOT NULL;

  IF v_item_ids IS NULL THEN
    -- Position salary rows (itemId NULL) reuse this table; nothing to sync.
    RETURN NULL;
  END IF;

  FOREACH v_item_id IN ARRAY v_item_ids LOOP
    -- No-ops when the owning Item is being cascade-deleted in this same
    -- statement, which is the intended behaviour.
    UPDATE "Item" i
    SET "totalPrice" = COALESCE(item_latest_price(i.id), 0) * COALESCE(i.quantity, 0)
    WHERE i.id = v_item_id;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS monetary_value_item_total_price_sync ON "MonetaryValue";
CREATE TRIGGER monetary_value_item_total_price_sync
AFTER INSERT OR UPDATE OR DELETE ON "MonetaryValue"
FOR EACH ROW
EXECUTE FUNCTION monetary_value_sync_item_total_price();

-- Backfill every row that already drifted (includes the 107 rows sitting at
-- NULL, which rendered as "-" in the list instead of their real value).
UPDATE "Item" i
SET "totalPrice" = COALESCE(item_latest_price(i.id), 0) * COALESCE(i.quantity, 0)
WHERE i."totalPrice" IS DISTINCT FROM
      COALESCE(item_latest_price(i.id), 0) * COALESCE(i.quantity, 0);
