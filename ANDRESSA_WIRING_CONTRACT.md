# Andressa Wiring Contract — 2026-06-14

End-to-end wiring pass connecting features that were built but left unconnected, plus a
Contas a Pagar / Previsão de Saídas redesign. Branch `andressa-wiring-2026-06-14` in api/web/mobile.

## Locked decisions (from user)

1. **Pago = Fulfilled.** An order's payment obligation is OPEN iff
   `status NOT IN (FULFILLED, PARTIALLY_RECEIVED, RECEIVED, CANCELLED)`. Reaching FULFILLED (or
   beyond) means the order is settled and leaves Contas a Pagar / "Pedidos em aberto". Keying on
   `status` (not the stale `paymentStatus`) fixes all existing data with no backfill. `paymentStatus`
   remains the request sub-pipeline (Não Solicitado → Solicitado → Aguardando) for OPEN orders, and
   is auto-flipped to PAID when an order settles (record consistency + "Pago" view).
2. **Unified payables list.** Contas a Pagar shows all payable sources in one list grouped by payee,
   each row carrying its own payment state:
   - Open **orders** (per rule above)
   - **Airbrushing** painter payments (`Airbrushing.price`, `paymentStatus`, `painter`) not yet PAID
   - **Recurring / scheduled expected** outflows (active `OrderSchedule` due in window via `getExpectedTotals`)
3. **Notas Fiscais nav:** rename Elotech issuance page → **"NFS-e Emitidas"** (top-level, ADMIN/COMMERCIAL);
   reconciliation fiscal-documents "Notas Fiscais" lives **only inside the Conciliação Bancária submenu**
   (drop the top-level `notas-fiscais-contabilidade` duplicate; add ACCOUNTING to the submenu entry).
4. **Solicitar Pagamento** moves from the Contas-a-Pagar context menu to the **Order detail page**
   (admin requests payment from the order itself).
5. Full build across api + web + mobile, including the DB migration.

## Canonical constants (api)

```
SETTLED_ORDER_STATUSES   = [FULFILLED, PARTIALLY_RECEIVED, RECEIVED]   // settled obligation
PAYABLE_OPEN_STATUSES    = [CREATED, PARTIALLY_FULFILLED, OVERDUE]     // still owed
// CANCELLED is neither — always excluded from payables.
```

---

## Area 1 — Contas a Pagar (orders payment semantics)  [api: order.service.ts]

- Open-list / summary / forecast filters key on **order `status`** (PAYABLE_OPEN_STATUSES), not paymentStatus.
- Auto-settle hook: in `checkAndUpdateOrderFulfillmentStatus` (→FULFILLED) and
  `checkAndUpdateOrderReceivedStatus` (→RECEIVED) and the manual receive path (~710-775), when the new
  status is settled and `paymentStatus != PAID`, set `paymentStatus=PAID`, `paidAt = now`, log SYSTEM change.
- `getPaymentSummary`: open buckets filtered to `status IN PAYABLE_OPEN_STATUSES`; PAID bucket = settled
  orders in last 90 days (windowed by `paidAt`).
- `requestPayment` already exists (`PUT /orders/:id/request-payment`). Keep. Web moves the trigger to order detail.

## Area 2 — Unified payables aggregation  [api: new method on order.service or new financial service]

New endpoint `GET /orders/payables` (or `financial/payables`) returning normalized rows:
```
PayableRow {
  source: 'ORDER' | 'AIRBRUSHING' | 'SCHEDULED'
  id, payeeId, payeeName, description, amount,
  paymentState: 'NOT_REQUESTED'|'REQUESTED'|'AWAITING_PAYMENT'|'PARTIALLY_PAID'|'EXPECTED',
  dueDate?, method?, requestedAt?
}
```
- ORDER rows: open orders (status rule), paymentState from `paymentStatus`.
- AIRBRUSHING rows: `Airbrushing` where `paymentStatus != PAID` and `price != null`; payee = painter;
  paymentState maps PENDING→NOT_REQUESTED, PARTIALLY_PAID→PARTIALLY_PAID.
- SCHEDULED rows: active `OrderSchedule` with `nextRun` in window → `getExpectedTotals`; paymentState='EXPECTED'.
- Plus a `payablesSummary` (counts/totals per state) to back the cards.

## Area 3 — Previsão de Saídas + tributos/quote integration  [api: outflow-forecast.service.ts]

- `buildOrdersSection`: replace `OPEN_PAYMENT_STATUSES` filter with `status IN PAYABLE_OPEN_STATUSES`
  (excludes done + CANCELLED). Fixes "displaying all the orders already done".
- New `buildInvoicedServiceTaxForecast(from,to)`: sum `TaskQuote` billing-approved this month
  (`billingApprovedAt ∈ [from,to]`, customerConfig.generateInvoice=true) service base; derive
  ISS = base × `ELOTECH_OXY_SERVICO_LC_ALIQUOTA`% + federal retentions from contribuinte aliquotas
  (`ElotechOxyAuthService.getContribuinteData`), respecting regime. Merge into the Impostos card as a
  forward estimate alongside the existing 3-month bank average.

## Area 4 — Notas Fiscais nav cleanup  [web: navigation.ts, routes/labels]

- Rename `notas-fiscais` label → "NFS-e Emitidas".
- Remove top-level `notas-fiscais-contabilidade`; add ACCOUNTING to submenu `conciliacao-notas` privileges.

## Area 5 — Afastamento (Leave) ↔ Secullum  [api: new secullum-leave-sync.service.ts]

- Mirror `SecullumVacationSyncService`: on Leave create/update/finish/cancel push a tagged
  `FuncionariosAfastamentos` (`[ANKAA-LEAVE:{id}]`), mapping `LeaveType` → Secullum JustificativaId.
- Wire into `leave.service.ts` create/update/finish/delete.
- Remove orphan `enum AbsenceStatus` if confirmed unused.

## Area 6 — Exams ↔ Admission/Termination  [api: migration + services; web/mobile: UI]

- **Migration**: add `MedicalExam.admissionId` (unique?) + `MedicalExam.terminationId` FKs (+ relations).
- admission.service: set `admissionId` on auto-created ADMISSION exam; advance-guard uses FK.
- termination.service: set `terminationId` on auto-created DISMISSAL exam; doc-sync uses FK.
- medical-exam.service: add admission-side `syncAdmissionExamDocument` (mirror dismissal sync) so a
  completed/uploaded ADMISSION exam fills the `ADMISSION_EXAM` AdmissionDocument.
- Web: "Agendar exame" actions on admission status-card + termination status-stepper-card.
- Mobile: replace dead MEDICAL_EXAM steppers with live linked-exam view + "Agendar exame".

## Verification
- api: `npx tsc --noEmit` + build. web: `tsc -b` / build. mobile: `NODE_OPTIONS=--max-old-space-size=8192 tsc`.
- Migration applied LOCAL only; prod pending (document in runbook). Do not push until user confirms.
