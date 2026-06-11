# PRODUCTION RUNBOOK — data correction 2026-06 + pending migrations

Scope: apply the 6 pending prisma migrations and the full data-correction suite
(phases A–A16, B, B2, D, E) plus the notification-config seed to **live
production**. Everything here was rehearsed end-to-end on the 2026-06-10 20:25 UTC
prod backup restored locally (see `ANALYSIS-2026-06-10.md` for the rehearsal
results, which are the expected baselines below).

Conventions used throughout:

```bash
PSQL='docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1'
```

Every data-correction SQL file is a **single transaction** (`BEGIN…COMMIT` with
`ON_ERROR_STOP`): any guard failure aborts that whole file with zero changes.

---

## Stage 0 — repo reconciliation (BEFORE the window, no prod access needed)

1. **Pull/merge commit `6d70b77`** (`feat(trucks): split B_DOUBLE into front/rear
   compartments + fix bonus cron for new hires`, on `origin/main`). It carries
   `prisma/migrations/20260610120000_split_b_double_compartments/migration.sql` —
   the migration that is **applied in prod but was missing from the local tree**
   (found by the 06-10 analysis). Without it, `prisma migrate deploy` state and
   `schema.prisma` (B_DOUBLE_FRONT/B_DOUBLE_REAR) disagree with prod.

   ```bash
   cd api && git fetch origin && git merge 6d70b77   # or rebase local work onto origin/main
   ```

2. **Commit the untracked migrations and scripts** (they exist only on this
   machine right now — prod deploy pulls from git):
   - `prisma/migrations/20260609180000_item_capability_fields/`
   - `prisma/migrations/20260610090000_external_operation_billing/`
   - `prisma/migrations/20260610120000_rename_commission_to_bonification/`
   - `prisma/migrations/20260610234500_ppe_type_overall/`
   - `scripts/data-correction-2026-06/` (all SQL + README + this runbook)

   Do **not** commit `scripts/output/` (gitignored — local CSV reports).

3. **Verify the build**:

   ```bash
   npx prisma generate && npx tsc --noEmit && npm run build
   ```

---

## Stage 1 — prod pre-flight (READ-ONLY; run before the window)

### (a) Migration ledger

```sql
SELECT migration_name, finished_at
FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 15;
```

- Verify `20260610120000_split_b_double_compartments` **is recorded**. It was
  applied to prod out-of-band; if the DDL is present (TruckCategory has
  `B_DOUBLE_FRONT`/`B_DOUBLE_REAR`, no `B_DOUBLE` rows) but the ledger row is
  missing, record it WITHOUT re-running:

  ```bash
  npx prisma migrate resolve --applied 20260610120000_split_b_double_compartments
  ```

- Verify the 4 new migrations (`20260609180000_item_capability_fields`,
  `20260610090000_external_operation_billing`,
  `20260610120000_rename_commission_to_bonification`,
  `20260610234500_ppe_type_overall`) are **NOT** yet recorded.

### (b) No stale ELECTRONIC_TOOL categories

`ELECTRONIC_TOOL` was added (20260526130000) and removed (20260528120000); a
leftover row would break the capability-fields backfill assumptions.

```sql
SELECT count(*) FROM "ItemCategory" WHERE type::text = 'ELECTRONIC_TOOL';
-- MUST be 0. If not, stop and investigate before Stage 2.
```

### (c) Hardcoded-UUID verification (merge / deactivation targets of phase-a)

phase-a aborts on any mismatch here, so catching drift now avoids a failed
window. Expected names are the 2026-06-10 backup names.

```sql
WITH expect(id, expected_name, role) AS (VALUES
  -- merge losers (phase-a A3)
  ('61fb86ca-bb7f-4477-8be7-4ee6bcc84683','Máscara Semi Facial Pequena','merge loser'),
  ('40c4bf81-df10-46da-8ae5-7da9254f6e96','Caixa Luva Nitrílica M','merge loser'),
  ('91571283-6965-4125-b717-ce0949f9d433','Caixa Luva Nitrílica P','merge loser'),
  ('db02e98b-eb3a-4f70-9ce4-3cd5a1d786f9','Luva Química','merge loser'),
  ('7b4f258c-80fd-46aa-8055-665fd2a1c4a3','Caixa Luva Nitrílica G','merge loser'),
  ('ab0e102e-f859-4a0e-8a24-b4277ee6b2ff','Luva de Vaqueta','merge loser'),
  ('1f6b6ed1-f61e-4a8a-b2bf-d883cd0b79dc','Bobina Papel Tkv','merge loser'),
  ('d59a3919-ed4a-43cd-8f9b-2fa5d5a2562f','Bobina Papel Ondulado','merge loser'),
  ('2eb51ba2-3ce1-40fc-a37f-f4848a711a0a','Pistola Pintura K3','merge loser'),
  ('e6cc2d12-4ba7-4f2f-a7b9-eb5a49f111de','Lixadeira Orbital','merge loser'),
  ('07c98533-24cf-44b9-99ae-4bafc694c640','Kit Bateria 4,0ah','merge loser'),
  ('27f14a82-4af7-41a8-9f44-6bea662ae037','Bateria 2.0ah','merge loser'),
  ('ab763024-0bbb-4f2c-9263-354bd7401a0d','Lanterna Side Marker Led Âmbar','merge loser'),
  -- merge survivors (phase-a A3; pre-A4-rename backup names)
  ('58d7af65-e670-4490-90c9-1fb1b5654232','Máscara Semi Facial Pequena','merge survivor'),
  ('67132f63-8215-4002-bd18-e7700e465edf','Caixa Luva Látex-M','merge survivor'),
  ('12b81549-95a0-482b-bc4a-ed30ff7e0341','Caixa Luva Látex-G','merge survivor'),
  ('08c4d8a0-6001-4498-be6c-90e4930ddf2f','Luva de Proteção Anticorte','merge survivor'),
  ('5131671a-ad6b-4c6a-9f80-9f1ea718d045','Bobina Papel Tk','merge survivor'),
  ('c87c806a-18cc-4e85-a58f-1db6703c5dc1','Papel Corrugado (ondulado)','merge survivor'),
  ('44a3eba4-6494-4881-8cd7-3391392baef3','Pistola Pintura K3','merge survivor'),
  ('5eceb603-c08d-4574-82b6-5dd46a41d87e','Lixadeira Orbital','merge survivor'),
  ('7095790b-5d66-432c-b5a5-afbd2e81e74b','Bateria 4.0ah','merge survivor'),
  ('96835114-45df-4032-bc45-d9cba12ac336','Bateria 2.0ah','merge survivor'),
  ('1f44b50c-5241-40d7-878f-1020b308e404','Lanterna Led Âmbar','merge survivor'),
  -- deactivations (phase-a A6)
  ('5a1210ab-9e71-41be-b68e-3f16fc5b294a','Pulverizador de Pressão','deactivate'),
  ('27278f33-b534-4e4a-8450-71a300787ab0','Espatula Inox/12cm Cab Pvc','deactivate'),
  ('3218b7cb-5850-4f71-9f37-1082def56334','Soprador Térmico Bateria','deactivate'),
  -- deactivation audit backfills (phase-a A6)
  ('cda57e50-7f11-43b8-b32d-9c0530bf20b5','Fita Led','backfill'),
  ('04c48d67-33fe-4b9f-ba91-68d9612f3793','Pá de Lixo Inox','backfill'),
  ('eeff8972-e9d7-43e0-ae27-7a6c583be4b8','Trena Dewalt Emb','backfill'),
  ('a04a552e-490b-47c3-9548-a6f1fb595b03','Pistola Pintura','backfill'),
  -- B4 mask-halving items (phase-b; renamed to "Máscara de Transferência 32x" by phase-a6)
  ('5334cf95-0e83-404e-a8c0-cd84c888b6c7','Máscara','mask B4'),
  ('33ed541a-343c-4232-bf6d-921dfdf198a6','Máscara','mask B4')
)
SELECT e.role, e.id, e.expected_name, i.name AS actual_name,
       CASE WHEN i.id IS NULL THEN 'MISSING'
            WHEN i.name = e.expected_name THEN 'OK'
            ELSE 'NAME DRIFT' END AS status
FROM expect e LEFT JOIN "Item" i ON i.id = e.id
ORDER BY (CASE WHEN i.id IS NULL THEN 0 WHEN i.name <> e.expected_name THEN 1 ELSE 2 END), e.id;
-- Every row must be OK. MISSING / NAME DRIFT rows will make phase-a (or phase-b
-- for the masks) abort — resolve them (and update the script's expected names
-- deliberately) BEFORE the window.
```

phase-a additionally pre-flights all 160 category-move ids with the same
id→expected-name technique (tolerates ≤5 missing / ≤8 renamed; aborts above
that), so no separate manual check is needed for the moves.

### (d) Phase-D assertion items exist

`src/scripts/correct-stock-metrics.ts` aborts its transaction if these two
anomaly-assertion items are missing:

```sql
SELECT id, name, "isActive" FROM "Item"
WHERE id IN ('197b3e61-88ee-4986-af4e-36955b0b360f',   -- Vira Macho Reto (FIXED_TARGET tool)
             '9446d4ee-3c43-4c2a-9e05-111d3d4d67c6');  -- Tomada 20a Vermelha
-- expect exactly 2 rows.
```

---

## Stage 2 — maintenance window

### 2.1 Backup (mandatory, verified)

```bash
docker exec ankaa-postgres pg_dump -U ankaa_prod -d ankaa_production -Fc -Z6 \
  > ankaa_production_pre_correction_$(date -u +%Y%m%d_%H%M%S).dump
ls -lh ankaa_production_pre_correction_*.dump   # sanity: non-trivial size
```

### 2.2 Quiesce the API

Stop the API service (and with it the 02:30 inventory cron, schedulers, and all
user writes) for the duration of the window. Leave postgres up.

### 2.3 Prisma migrations

```bash
cd api && npx prisma migrate deploy
```

- **Expect a long step**: `20260610120000_rename_commission_to_bonification`
  performs **5 full regex scans/rewrites of ChangeLog** (plus
  TaskFieldChangeLog / Notification / NotificationConfiguration et al.) inside
  ONE transaction — minutes to tens of minutes on prod volume. This is normal.
  **Do NOT edit the migration** (its checksum is recorded; editing breaks the
  ledger) and do not kill it mid-run.

- Post-migration verification (residue must be zero):

```sql
SELECT
  (SELECT count(*) FROM "ChangeLog"
    WHERE "field" ~* 'commiss|comiss' OR "reason" ~* 'commiss|comiss'
       OR "oldValue"::text ~* 'commiss|comiss' OR "newValue"::text ~* 'commiss|comiss'
       OR "metadata"::text ~* 'commiss|comiss')                              AS changelog_residue,   -- expect 0
  (SELECT count(*) FROM "Notification"
    WHERE "title" ~* 'commiss|comiss' OR "body" ~* 'commiss|comiss'
       OR "metadata"::text ~* 'commiss|comiss')                              AS notification_residue, -- expect 0
  (SELECT count(*) FROM "Item" WHERE "stockModel" IS NULL)                   AS items_missing_stockmodel, -- expect 0 (capability backfill)
  (SELECT count(*) FROM "Item" WHERE "ppeType"::text = 'OVERALL')            AS overall_ppe;             -- expect 0 here (phase-a15 sets 3 later)
```

### 2.4 Data-correction phases (in order, each its own transaction)

```bash
cd scripts/data-correction-2026-06
$PSQL < phase-a-taxonomy-items.sql
$PSQL < phase-a2-owner-decisions.sql
$PSQL < phase-a3-faixa-dedup.sql
$PSQL < phase-a4-category-tree.sql
$PSQL < phase-a5-plotagem-tree.sql
$PSQL < phase-a6-mascaramento-cleanup.sql
$PSQL < phase-a7-epi-ferramentas-leaves.sql
$PSQL < phase-a8-prep-chemicals.sql
$PSQL < phase-a9-taxonomy-v2.sql
$PSQL < phase-a10-rebite-history.sql
$PSQL < phase-a11-temp-line-links.sql
$PSQL < phase-a12-rename-collisions.sql
$PSQL < phase-a13-measure-fixes.sql
$PSQL < phase-a14-taxonomy-tweaks.sql
$PSQL < phase-a15-ppe-overall.sql
$PSQL < phase-a16-abrasivos-tree.sql
$PSQL < phase-b-activities.sql
$PSQL < phase-b2-residual-activities.sql
```

If ANY file raises a guard exception it rolls back **only itself** — read the
message, fix the cause (usually deliberate prod drift since the 06-10 backup),
and re-run that file before continuing.

**Replay caution:** each phase is idempotent when re-run at its own position in
the sequence, but do NOT replay an EARLIER phase after a LATER one has run.
Known case: re-running phase-a9 after a14/a16 would re-rename the recreated
`Lixas` leaf to `Lixas, Fibras e Suportes`. Re-run only the failed file, then
continue forward.

### 2.5 Mirror sync (transaction-category ITEM_DERIVED mirrors)

```bash
NODE_ENV=production node dist/scripts/sync-transaction-category-mirror.js
```

### 2.6 Expected verification counts (vs the 2026-06-10 local rehearsal)

| Check | Expected |
|---|---|
| phase-a summary | 9 category renames, 11 creates, 13 merges, ~157 moves, 3 deactivations, 5 item creates (guards skip rows prod already fixed) |
| phase-a `A3-merge-fk-repoint` log rows | one per merge that had refs; counts of Activity/Borrow/OrderItem repointed per loser |
| phase-a2 | likely full no-op (owner already fixed ink counts in-app); any `A2-ink-skip-drifted` row = re-count that ink physically |
| phase-a3 | 4 faixa renames |
| phase-a9 | **4 `A29-rename-top` + 12 `A31-rename-leaf` log rows**, 173 item moves, 1 leftover (`Carvão Em Pó` → A Revisar) |
| taxonomy after a16 | **14 top-level categories / 48 leaves** (`SELECT count(*) FROM "ItemCategory" WHERE "categoryLevel"=1;` etc.) |
| phase-b | B1=29, B2=12, B3=30, B4=159, B5=15 — the 06-10 rerun matched 06-09 **exactly**; deviations beyond the built-in caps (B1+B2>50, B3>40) self-abort |
| phase-b2 | B6=16, B7=2 deletions, 3 name-collision flags + 1 under-booked flag, B8=1 |
| phase-e | **0** uncategorized active items; merge losers fully drained; 0 active PPE missing ppeType; `items_rp_below_peak_week ≈ 61` (expected: raw-peak check vs winsorized engine + LOW_DATA zeroing) |

### 2.7 Deploy the new API code — BEFORE the next 02:30 inventory cron

The nightly cron uses the same metric engine; running the OLD code against the
corrected data re-derives bad lead times. Deploy the new build (lead-time clock
fix, INVENTORY_COUNT exclusion, winsorization, peak-week floor, capability-field
keying, bonification rename) in the same window.

### 2.8 Phase D — metric recompute

Inside the API container/environment:

```bash
NODE_ENV=production pnpm stock:correct
```

- Single transaction; aborts (full rollback) if either anomaly assertion fails.
- Local baseline: **218/508 items changed, 0 anomalies**; CSV diff written to
  `api/scripts/output/`. Skim the CSV for surprises before moving on.

### 2.9 Notification-config seed

```bash
npm run seed:notifications -- --dry-run   # review the planned changes first
npm run seed:notifications                # then the real run
```

**SKIP the dashboard seed** (`seed-dashboard-defaults-and-message-20260508.ts`):
it would reset every user's dashboard layout and re-broadcast an old company
message.

### 2.10 Restart + smoke test

Start the API, then verify:

- login (web + mobile), item list renders the 14-top taxonomy, item detail opens;
- create + receive a small test order line, then delete it (Activity writes OK);
- bonification pages load (no "commission" residue in UI/API routes);
- external-operation list loads (renamed routes);
- a notification fires and deep-links correctly;
- PPE delivery screen shows Macacão (OVERALL) sizes;
- statistics pages load (consumption charts sane).

> APK rebuild + OTA republish (mobile intent filters / new enums) are handled by
> the separate mobile release procedure — see `mobile/` docs; NOT part of this
> runbook.

---

## Rollback

1. **Per-script**: every SQL phase is one transaction — a guard/exception means
   that file applied **nothing**. No action needed beyond fixing and re-running.
2. **Surgical**: `correction_log_20260609.old_value` holds the prior value of
   every mutated row (deleted Activity rows store their FULL row JSON) — restore
   individual rows from it.
3. **Synthetic rows**: phase-a10 seeds carry `synthetic: true` markers in the
   log — they can simply be deleted if the owner changes course.
4. **Catastrophic**: restore the Stage-2.1 dump:

   ```bash
   docker exec -i ankaa-postgres pg_restore -U ankaa_prod -d ankaa_production \
     --clean --if-exists < ankaa_production_pre_correction_<ts>.dump
   ```

   (Also roll back the code deploy — the new engine expects the new schema.)

---

## Timing — run this SOON

- **phase-a10 decays**: its synthetic Mar+Apr/2026 rebite history ages out of
  the engine's 6-month lookback around **Sep 2026**; after that the rebites'
  reorder points collapse again until real history accumulates.
- **UUID drift grows daily**: every name/quantity/category change made in the
  live app since the 2026-06-10 20:25 UTC backup increases the chance the
  expected-name guards (correctly) abort. The longer the wait, the more manual
  reconciliation before the window.
