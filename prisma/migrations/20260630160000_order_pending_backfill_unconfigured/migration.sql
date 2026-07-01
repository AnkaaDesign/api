-- Backfill legacy "unconfigured" orders into the new PENDING pre-payable state.
--
-- Before the PENDING workflow existed, a created order defaulted straight to
-- AWAITING_PAYMENT. An AWAITING order with no payment method chosen rendered as
-- the neutral "A Definir" placeholder (OrderPaymentStatusBadge) — which IS exactly
-- the new PENDING meaning: created but not yet requested for payment. Those rows
-- were therefore showing the contradictory AWAITING-only actions ("Cancelar
-- requisição de pagamento" / "Marcar como Pago") instead of "Requisitar Pagamento".
--
-- Migrate just those rows to PENDING so they correctly read "Pendente" and offer
-- the request-payment action. Orders that already have a payment method are
-- grandfathered as AWAITING_PAYMENT (they were genuinely configured/staged under
-- the old model); PAID and CANCELLED orders are untouched. paymentStatusOrder 0
-- matches ORDER_PAYMENT_STATUS_ORDER[PENDING].
UPDATE "Order"
SET "paymentStatus" = 'PENDING', "paymentStatusOrder" = 0
WHERE "paymentStatus" = 'AWAITING_PAYMENT'
  AND "paymentMethod" IS NULL
  AND "status" <> 'CANCELLED';
