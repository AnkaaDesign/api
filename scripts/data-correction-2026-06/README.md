# Data correction 2026-06 — inventory taxonomy, items, activities, metrics

Tested end-to-end on the production backup (`ankaa_production` restored locally) on 2026-06-09.
Everything is idempotent and logged to `correction_log_20260609` (old values preserved → rollback possible).

## What each phase does

| Phase | File | Summary |
|---|---|---|
| A | `phase-a-taxonomy-items.sql` | 9 category renames + 11 new categories (28 total taxonomy), 13 item merges, 165 category moves, 9 renames + whitespace trims, 3 deactivations, 5 new items, PPE coherence fixes |
| A2 | `phase-a2-owner-decisions.sql` | Owner decisions: printer-ink physical counts (C/M/Y=1, K=2), soprador térmico rename guard + TOOL capability fix, pote-redondo and capability-backfill read-only checks. Resolves items by NAME (A7 ids differ per env) |
| A3 | `phase-a3-faixa-dedup.sql` | Renames the two identical-name Faixa Refletiva pairs into Direita/Esquerda side pairs (Avery 100/100 + 3M 20/40 — distinct items with their own order lines, NOT duplicates). Side assignment provisional, verify at recount |
| A4 | `phase-a4-category-tree.sql` | Category tree + accounting groups: 7 new level-1 parent groups, 26 categories nested as level-2 children, EPI + Plotagem standalone, AccountingType on all 35 rows (structure from the merged-taxonomy design; items untouched). Run the ITEM_DERIVED mirror sync afterwards. The stale `apply-merged-taxonomy.ts` (whose per-item batches predate phase A and would clobber the moves/merges) was DELETED from the repo on 2026-06-11 |
| A5 | `phase-a5-plotagem-tree.sql` | Plotagem subcategories (Vinil e Adesivos ×12 itens, Ferramentas de Plotagem ×3) + the three width-only "Adesivo" rolls renamed to Adesivo Vinil 1,52m/1,27m/1,06m. Mirror sync afterwards |
| A6 | `phase-a6-mascaramento-cleanup.sql` | The two "Máscara" rolls (uniCodes 321/328 — the cut-in-half items behind B4) are plotting transfer masks: renamed "Máscara de Transferência 321/328" and moved to the new Plotagem leaf "Máscaras de Transferência". 13 misplaced (inactive) rows re-homed out of Mascaramento e Cobertura (selantes→Reparo, arames+parafusos→Fixadores, aplicadores→Produção, sacola→Embalagem). Mirror sync afterwards |
| A7 | `phase-a7-epi-ferramentas-leaves.sql` | EPI split into 5 level-2 leaves (Calçados, Mãos, Respiratória, Visual/Auditiva/Corporal, Uniformes — ppeType-driven, all 95 items placed, parent emptied); Ferramentas Manuais split into 3 new sibling leaves under Ferramentas e Equipamentos (Chaves/Alicates/Soquetes ×133, Corte/Impacto/Escovas ×8, Medição ×6; 15 generic stay); 36 cross-category sweep moves (misplaced inactive twins → their active twin's category, primers/massas/rebites/discos/plotter/LED/eletrônicos). Mirror sync afterwards |
| A8 | `phase-a8-prep-chemicals.sql` | Workflow-based chemical placement (owner rule: categorize by usage stage, not material family): Removedor + Desengraxante → Reparo e Preparação; new "Aditivos e Auxiliares" leaf under Tintas (Flexibilizante ×2, Aditivo Anticratera, Solução Flexibilizante, Acelerador de Secagem); parent "Produção e Preparação" renamed "Funilaria e Produção" (collided with child "Reparo e Preparação"). Mirror sync afterwards |
| A9 | `phase-a9-taxonomy-v2.sql` | Taxonomy v2 (owner-preferred 14-top separation, 2026-06-10): 4 top renames, 3 leaf→top promotions (Mascaramento, Ferramentas Manuais, Uniforme), 2 new tops (Aplicadores, A Revisar), 12 leaf renames, 16 new leaves, ar-comprimido → MANUTENCAO (owner decision), 173 item moves (faixas→Plotagem, Hookit→Lixas, bits→Chaves, Copa split, Uniforme split…), dissolves Produção/Reparo e Preparação. Primers STAY in Tintas (owner decision). Applied state: `docs/categorization/category-reclassify/taxonomy-v2.json`. Mirror sync afterwards |
| A10 | `phase-a10-rebite-history.sql` | Seeds Mar+Apr/2026 PRODUCTION_USAGE history for Rebites 525/516/640 (magnitudes extend the OBSERVED May–Jun cadence; single row/item/day, near-median — won't trip B/B2 detectors; quantity untouched). Owner rejected a manual-rp override field; with ≥3 distinct months the engine computes rp naturally (525→323, 516→150, 640→64 on the 2026-06-10 run). Self-healing: rows age out of the 6-month lookback as real history accumulates. Run recompute (phase D) afterwards |
| A11 | `phase-a11-temp-line-links.sql` | Links 6 received free-text order lines to their catalog items (Rebites 516/525, Discos Trizact P1000/P3000, Desengripante, Arruela 10mm) — LINK ONLY, no activities/quantity (stock was absorbed at item creation; catalog qty == received qty proves it). Restores purchase history + lead-time signal. Code fix shipped alongside: PUT /order-items/:id accepts itemId (null→id conversion only) + GET /order-items/temporary/suggestions fuzzy-matches unlinked temp lines against the catalog |
| A12 | `phase-a12-rename-collisions.sql` | Renames 38 active name-collision items (owner approval; pigment UC/AC pairs deliberately kept): clothing sizes from Measure (Calça - 36..48, Camiseta - P..XG, Macacão - M/XG/XXG), tool models from uniCode, distinct chemical products with codes, abraçadeiras with dimensions, garrafas by volume (+ 1000-LITER→MILLILITER unit typo fix). Escada trio (7/16/30 degraus) and Hookit/Base Hookit verified distinct — nothing merged |
| A13 | `phase-a13-measure-fixes.sql` | Measure cleanup (165 changes): 9 exact-dup deletes, 75 junk deletes, 53 conversions, 26 inserts, 2 renames. Root causes: fraction-parse bug ("1/2" stored as LENGTH 1 INCH_1_2 + LENGTH 2 INCHES — divisor deleted, numerator → DIAMETER 0.5 INCHES), socket size+drive concatenation junk (18.5 INCHES), bolt DxL splits (smaller → DIAMETER; M06's 0,40 → THREAD pitch), tape/roll second-comprimento → WIDTH, KILOGRAM-for-GRAM typos (982kg hardener cans, 500kg marreta), Faixa Lateral 9300kg/9300L junk → 30×5cm like the siblings. Web-verified specs added: GA5010 (125mm/1050W), GWS 9-125 (125mm/900W), DHP482 (18V/13mm), GSB 18V-50 (13mm), PDR PRO-534 (bico 1,7mm/copo 600ml). Renames: "Pistola PR 0.7m"→"PR 1.7mm" (uniCode ".7m" was truncated 1.7mm — its own measure rows proved it), "Parafuso Sextavado Zincado UNC"→"UNC 3/8" (+ THREAD 16 TPI). Flagged not fixed: Bisnaga 2 volumes, Extensão bitola 2x2,5mm², mixed-bin parafusos, Cavalete dims, Kit Rodas/Banqueta load-capacity-as-WEIGHT |
| A14 | `phase-a14-taxonomy-tweaks.sql` | Owner tweaks after v2 review: "Lixas" promoted to its own level-1 category (sanding media; 17 active); new leaf "Bases e Adaptadores" under Abrasivos (Base Hookit, Hookit, Disco de Interface, Adaptador Boina — typo "Adapitador" fixed); Papel Kraft → Plotagem › Máscaras de Transferência; Macacões Vicsa → EPI › Proteção Visual/Corporal (são EPI, não uniforme); empty "Uniforme — Corpo Inteiro" deleted. Mirror sync afterwards |
| A15 | `phase-a15-ppe-overall.sql` | Sets ppeType=OVERALL on the 3 Macacões de Segurança (they carried SHIRT from the Uniformes era). REQUIRES prisma migration 20260610234500_ppe_type_overall first. Code shipped with it: PPE_TYPE.OVERALL ("Macacão") across api+web+mobile (enums, labels, sort orders, size maps P..XG, ppe.ts validation, ppe-config: interval 6mo, headcount 22 production-floor) |
| A16 | `phase-a16-abrasivos-tree.sql` | Abrasivos correction (owner, revising A14): "Lixas" demoted back to a leaf under Abrasivos e Polimento; new sibling leaf "Fibras Abrasivas" takes Palha de Aço + Scotch Brite out of Lixas. Final: Lixas(15) / Fibras Abrasivas(2) / Bases e Adaptadores(4) / Discos(5) / Polimento(6). Mirror sync afterwards |
| B | `phase-b-activities.sql` | Deletes cross-user double-entered stock balances (spike pairs) and same-user double-clicks; reclassifies surviving balance spikes → INVENTORY_COUNT; halves pre-2026 integer outbounds of Máscara 321/328 (half-mask double-count era); deletes zero-qty noise rows. **Does NOT touch Item.quantity by design** — stock was re-trued by the 2026 inventory counts; these fixes repair consumption history only |
| B2 | `phase-b2-residual-activities.sql` | Residual cross-user same-day duplicate outbound spikes (B6: full-day window, ≥8× median, transitive chains, keeps earliest leg); item-level double-booked order receipts (B7: stale order + reorder batch-received together — Azul, Thinner 7000) with flag-only logging for the under-booked Máscara OrderItem and for name-collision pseudo-dups (distinct items sharing a display name — NOT deleted); Pacote Pincel de Retoque count rescaled 157 → 3 packs (B8). Same conventions as B |
| D | `pnpm stock:correct` | Recompute of mc / rp / max / reorderQty / leadTime / ABC / XYZ with the canonical engine (same as nightly cron), single transaction |
| E | `phase-e-verify.sql` | Read-only verification: taxonomy distribution, merge integrity, PPE coherence, consumption sanity, rp-vs-peak-week, correction-log totals |

## Code changes required BEFORE running phase D in production

These are in the repo (deploy them first — the nightly cron at 02:30 uses the same engine and
would otherwise re-derive bad lead times):

1. `src/utils/stock-health.ts` — new `leadTimeClockStart()`: ignores `fulfilledAt` when it is
   < 1 day before `receivedAt` (warehouse marks "fulfilled" at receipt, collapsing lead time to
   ~1 day; 62 items had rp ≈ 2 days of demand because of this).
2. `src/modules/inventory/services/item-recompute.service.ts` + `inventory-cron.service.ts` —
   use the helper at all 4 clock-start sites.
3. `src/scripts/correct-stock-metrics.ts` — anomaly assertion updated to the target-based TOOL
   rules (rp = max = tool target, not 0).
4. New engine behavior (`src/utils/stock-health.ts` + `src/constants/inventory-config.ts`):
   INVENTORY_COUNT fully excluded from consumption (`INVENTORY_COUNT_SHARE_CAP = 0`), monthly
   buckets winsorized at 3× the nonzero-month median (`WINSORIZE_FACTOR = 3.0`), rp floored at
   the peak winsorized week (`RP_PEAK_WEEK_FLOOR_FACTOR = 1.0`), `XYZ_MIN_MONTHS` 2 → 6, and
   metric keying moved from category type to the capability fields (`stockModel` /
   `isBorrowable` / `fixedTargetQuantity`; FIXED_TARGET keeps rp = max = target).

## Production runbook

> Full production procedure (pre-flight checks, maintenance window, rollback,
> timing): see **`RUNBOOK-PROD.md`** in this directory. The condensed order below
> must be followed exactly.

**ORDERING (fixed 2026-06-11): prisma migrations come FIRST.** Phase A2 hard-requires
migration `20260609180000_item_capability_fields` (it reads/writes `isBorrowable` /
`stockModel` / `fixedTargetQuantity`) and phase A15 hard-requires
`20260610234500_ppe_type_overall` (the `OVERALL` ppeType enum value). Running the
phases before `npx prisma migrate deploy` fails mid-sequence.

```bash
# 0. Backup first (their normal backup process). See RUNBOOK-PROD.md Stage 2 for
#    the explicit pg_dump command and the API quiesce step.

# 1. Prisma migrations — FIRST, before any data-correction phase.
#    NOTE: 20260610120000_rename_commission_to_bonification rewrites stored
#    ChangeLog data in 5 full regex scans inside one transaction — expect minutes
#    to tens of minutes. Do NOT edit the migration; let it run.
cd api && npx prisma migrate deploy

# 2. Data-correction phases, in order (each is a single transaction):
cd scripts/data-correction-2026-06
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a-taxonomy-items.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a2-owner-decisions.sql   # AFTER A: resolves A7-created items by name
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a3-faixa-dedup.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a4-category-tree.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a5-plotagem-tree.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a6-mascaramento-cleanup.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a7-epi-ferramentas-leaves.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a8-prep-chemicals.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a9-taxonomy-v2.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a10-rebite-history.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a11-temp-line-links.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a12-rename-collisions.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a13-measure-fixes.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a14-taxonomy-tweaks.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a15-ppe-overall.sql      # migrations already applied in step 1
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-a16-abrasivos-tree.sql
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-b-activities.sql         # AFTER all A phases
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production -v ON_ERROR_STOP=1 < phase-b2-residual-activities.sql  # AFTER B; aborts itself if detectors over-match

# 3. Mirror sync (ITEM_DERIVED transaction categories follow the new taxonomy)
NODE_ENV=production node dist/scripts/sync-transaction-category-mirror.js

# 4. Deploy the new API code (lead-time clock + new metric engine) BEFORE the
#    next 02:30 inventory cron — the old engine would re-derive bad lead times.

# 5. Phase D (metric recompute, inside the API container/environment)
NODE_ENV=production pnpm stock:correct        # CSV diff lands in api/scripts/output/

# 6. Phase E (verify)
docker exec -i ankaa-postgres psql -U ankaa_prod -d ankaa_production < phase-e-verify.sql

# 7. Notification-config seed (dry-run first; see RUNBOOK-PROD.md — do NOT run
#    the dashboard seed, it would reset user layouts and re-broadcast a message)
npm run seed:notifications -- --dry-run
npm run seed:notifications
```

Notes for the prod run:
- All SQL phases are guarded. Rows already fixed are skipped (idempotent re-run), and unknown
  move ids are logged as `A5-skipped-unknown-item` instead of failing. **Hardened 2026-06-11:**
  the destructive steps (merges, renames, uniCode/ppeType fixes, deactivations in phase-a; the
  B4 mask halving in phase-b) now verify each hardcoded UUID still carries its expected
  backup-time name and ABORT the whole transaction on drift; the 160 phase-a category moves run
  a pre-flight id→name count check (aborts at >5 missing or >8 renamed); category renames
  (phase-a A1, phase-a9 A29/A30/A31) abort with a clear message on `ItemCategory_name_key`
  collisions; phase-b adds caps (B1+B2 deletions >50 or B3 reclasses >40 abort); phase-a2 only
  overwrites ink quantities still at their stale pre-correction values (else logs
  `A2-ink-skip-drifted`); merge FK repointing logs per-loser Activity/Borrow/OrderItem/
  ExternalOperationItem counts as `A3-merge-fk-repoint`.
- Phase B detectors are set-based: activities created after the backup are scanned too (desired).
- Mask halving is hard-cut at `createdAt < 2026-01-01`; no new rows can be affected.
- Rollback: `correction_log_20260609.old_value` holds prior values, including the full JSON of
  every deleted Activity row.

## Backup test-run results (2026-06-09)

- Phase A: 9 renames, 11 creates, 13 merges, 161+4 moves, 3 deactivations, 5 creates — clean.
- Phase B: 29 cross-user dup deletions, 12 same-user dup deletions, 30 spike reclasses,
  159 mask halvings, 15 zero-qty deletions.
- Phase B2: 16 cross-day dup deletions (252 phantom units), 2 double-receipt deletions
  (Azul 8, Thinner 7000 2), 4 name-collision flags + 1 under-booked flag, 1 pack rescale.
  Re-run confirmed no-op.
- Phase D (old engine): 504/504 items; mc changed on ~57, rp on ~122, leadTime on 24, ABC on 6, XYZ on 12.
  After the lead-time fix: zero items with a >60 % rp collapse; Endurecedor Pu lt 1→18 d, rp 15→249.
- Phase D (new engine, after B2): 201/504 items changed; mc on 126, rp on 113, max on 122,
  ABC on 34, XYZ on 196 (XYZ_MIN_MONTHS 2→6). Count-adjustment victims zeroed (Rebite de
  Repuxo 525/619/516 mc 411/361/202 → 0); peak-week floor raised Lixa Hookit P150 rp 67→150,
  P400 59→100, Luva Látex M 1→17. All 154 FIXED_TARGET items kept rp = max = target.
- Phase E: 28 categories, 0 uncategorized items, merge losers fully drained, 0 active PPE items
  missing ppeType.

## Known follow-ups (not in these scripts)

- Physical recounts needed (priority order from the 2026-06-09 forensic sweep): Faixa Refletiva
  Lateral Dir/Esq (800 each on the books, zero inbound activity in 3 years, heavy 2026 outflow);
  Scotch Brite (qty 400, 2,900 units of 2026 movement, never counted in 2026); Pacote Pincel de
  Retoque (units-vs-packs count, current qty 1); Rebite de Repuxo 619 (qty 192, no purchase
  history ever); Copo Cristal 145ml; the renamed Faixa Refletiva Direita/Esquerda + 3M pairs
  (verify side assignment); Power Bank 5000mAh; Abraçadeira Radial Inox (qty 222, deactivated);
  Intercap & Peneira (counted 2026-05, watch only). Plus a counting wave for the ~290 active
  items never counted in 2026.
- B2 flagged for owner review (no data changed): Branco 522af7dc booked
  8+16 on 2026-01-16 across the old/new PIGMENTOS orders (not a clean multiple, left alone);
  Máscara OrderItem under-booked 54 vs 108 received; Máscara 328 5.75 outbound; Wellington's
  100-unit Faixa Refletiva draws (verify against production records).
- Owner decisions pending: see the AMBIGUITIES section of the session report (garra máscara and
  fita supply not found; pote redondo pack factor; kit bateria contents).
- Pipeline gap: item creation sets initial stock without an Activity row (245/275 post-2026 items
  already diverge ledger-vs-quantity); order receipts before 2025-09 never created inbound
  activities (566 uncovered receipts) — so `Item.quantity` can never be re-derived from the
  ledger alone.
