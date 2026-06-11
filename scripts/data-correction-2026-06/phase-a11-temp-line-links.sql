-- =============================================================================
-- PHASE A11 — Link received free-text (temporary) order lines to their catalog
-- items. Data correction 2026-06-10.
--
-- WHY: OrderItem rows with temporaryItemDescription and itemId NULL never
-- create inbound activities — the goods bypassed inventory entirely. Several
-- clearly ARE catalog items (the catalog quantities even EQUAL the received
-- amounts: the items were hand-created from these receipts, initial stock set
-- without an Activity — the known pipeline gap). Linking restores purchase
-- history, ordersLast12Months and the lead-time signal for these items.
--
-- LINK ONLY — no Activity rows, no Item.quantity change (stock was already
-- absorbed by item creation/counts; creating inbounds now would double-count).
--
-- Conservative curation: exact-normalized matches + 3 reviewed near-misses.
-- Skipped on purpose (ambiguous / no catalog item): Boina 3M Politriz, Disco
-- Norton Inox, Extensor Boina Politriz, Parafuso Sextavado 1/4 x 1/2 UNC,
-- Parafuso Sextavado 06x20, Rebite Repuxo 525 Milheiro (pack factor unknown),
-- Rodizio, Mola Aerea, Botão remoto, Expositor, Adesivo Vermelho Oracal,
-- Chapa PVC, Papel Sulfite kit (pack mismatch).
--
-- Idempotent: WHERE "itemId" IS NULL guards. Logged to correction_log_20260609
-- (phase 'A11'). Run:
--   docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a11-temp-line-links.sql
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

-- temp-line description (verbatim) → catalog item name (verbatim)
CREATE TEMP TABLE _links (descr text, item_name text);
INSERT INTO _links VALUES
  ('Rebite de Repuxo 516',       'Rebite de Repuxo 516'),
  ('Rebite de Repuxo 525',       'Rebite de Repuxo 525'),
  ('Disco Trizact P1000',        'Disco Trizact P1000'),
  ('Disco Trizact P3000',        'Disco de polir Trizact P3000'),
  ('Desingripante Tek Lub',      'Desengripante'),
  ('Arruela Lisa Zincada 10mm',  'Arruela zincada 10mm');

CREATE TEMP TABLE _todo AS
SELECT oi.id AS order_item_id, oi."temporaryItemDescription" AS descr,
       oi."receivedQuantity", i.id AS item_id, i.name AS item_name
FROM "OrderItem" oi
JOIN _links l ON l.descr = trim(oi."temporaryItemDescription")
JOIN "Item" i ON i.name = l.item_name
WHERE oi."itemId" IS NULL;

INSERT INTO correction_log_20260609 (phase, step, entity, entity_id, old_value, new_value)
SELECT 'A11','A38-link-temp-line','OrderItem', t.order_item_id,
       jsonb_build_object('temporaryItemDescription', t.descr, 'itemId', NULL),
       jsonb_build_object('itemId', t.item_id, 'itemName', t.item_name,
                          'receivedQuantity', t."receivedQuantity",
                          'note', 'link only — stock already absorbed at item creation/count')
FROM _todo t;

UPDATE "OrderItem" oi
SET "itemId" = t.item_id, "updatedAt" = now()
FROM _todo t
WHERE oi.id = t.order_item_id;

SELECT step, count(*) FROM correction_log_20260609 WHERE phase = 'A11' GROUP BY step;
SELECT t.descr, t.item_name, t."receivedQuantity" FROM _todo t ORDER BY t.descr;

COMMIT;
