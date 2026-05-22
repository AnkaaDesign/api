/**
 * inventory-deep-migration.ts
 * ---------------------------------------------------------------------------
 * Comprehensive inventory migration for the post-migration data anomalies
 * discovered on 2026-05-19. Designed to run on a copy of production first,
 * be validated, then applied to production.
 *
 * Phases (executed inside a single Prisma $transaction):
 *
 *   A. Categorize 174 uncategorized items (assignment map in
 *      `categorization-map.ts`). Mask items go to PPE (`Epi`).
 *
 *   B. Mascara workflow migration. Two items (`Máscara 321`, `Máscara 328`)
 *      changed from "register 2 entries per 1 physical mask" to "register 1
 *      per 1 + outbound 0.5 per use". Halves every pre-cutover Activity
 *      quantity (INBOUND + OUTBOUND) and resets the item.quantity to physical
 *      reality, recorded via a single MANUAL_ADJUSTMENT for audit trail.
 *
 *   C. ConsumptionSnapshot backfill for the trailing 12 months on every
 *      active item, building each month's totalConsumption, workingDays,
 *      normalizedConsumption, seasonalFactor from raw Activities. Months that
 *      fall entirely inside a vacation window are SKIPPED (no snapshot row).
 *      This unblocks the XYZ classifier which previously had < 3 months of
 *      history for everyone.
 *
 *   D. Cleanup phantom_mc items. The 20 items with `monthlyConsumption =
 *      quantity` exactly (migration seed pattern) have their mc/rp/max forced
 *      to 0 via a recorded MANUAL_ADJUSTMENT-flag write. They'll re-emerge
 *      naturally once activities accumulate.
 *
 *   E. Per-item recompute on EVERY item (active + inactive) via
 *      `ItemRecomputeService.recomputeItemMetrics`. Reuses the same engine as
 *      the nightly cron.
 *
 *   F. ABC/XYZ classification pass over the freshly-recomputed values.
 *
 * Flags:
 *   --dry-run    Throw a sentinel at the end of the transaction to force a
 *                rollback. No DB writes persist. CSV is still written.
 *   --skip-mask  Skip Phase B (use when validating idempotency).
 *   --skip-backfill  Skip Phase C.
 *
 * Run:
 *   pnpm stock:migrate --dry-run        # safe preview
 *   pnpm stock:migrate                  # commit
 *
 * Outputs:
 *   - api/scripts/output/inventory-migration-<ISO-date>.csv         (item diffs)
 *   - api/scripts/output/inventory-migration-mask-<ISO-date>.csv    (mask details)
 *   - api/scripts/output/inventory-migration-snapshots-<ISO-date>.csv (snapshot stats)
 *   - stdout summary
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { ItemRecomputeService } from '../modules/inventory/services/item-recompute.service';
import {
  ABC_CATEGORY,
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
  ITEM_CATEGORY_TYPE,
  PPE_DELIVERY_MODE,
  PPE_TYPE,
  XYZ_CATEGORY,
} from '../constants/enums';
import {
  REGULAR_CONSUMPTION_REASONS,
} from '../constants/inventory-config';
import {
  isInVacationPeriod,
} from '../constants/working-days-config';
import {
  workingDaysForMonth,
  detectSaturdayShifts,
} from '../utils/working-days';
import { distributeBulkAdjustments } from '../utils/bulk-adjustment-distributor';
import {
  classifyAbc,
  classifyXyz,
  type AbcInput,
  type XyzInput,
} from '../utils/abc-xyz';
import { CORPUS_MONTHLY_INDEX } from '../constants/seasonality-config';
import { CATEGORY_ASSIGNMENTS } from './categorization-map';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANOMALY_TOOL_ID = '197b3e61-88ee-4986-af4e-36955b0b360f';
const ANOMALY_RARE_ID = '9446d4ee-3c43-4c2a-9e05-111d3d4d67c6';

const FLOAT_EPSILON = 0.001;

/** Mask items whose pre-cutover Activities must be halved (workflow change
 *  from 2× double-entry to 0.5× half-unit outbound). */
const MASK_MIGRATION: ReadonlyArray<{
  itemId: string;
  uniCode: string;
  cutoverDate: string; // ISO date — first 0.5 OUTBOUND
  /** Whether to halve INBOUND activities placed BEFORE the cutover. */
  halveInbound: boolean;
  /** Special: ORDER_RECEIVED activities whose Order was placed before the
   *  cutover but received after — these should be halved too. */
  treatOrderReceivedAsPreCutover: boolean;
  notes: string;
}> = [
  {
    itemId: '33ed541a-343c-4232-bf6d-921dfdf198a6',
    uniCode: '321',
    cutoverDate: '2026-03-30T18:24:31.000Z',
    halveInbound: true,
    treatOrderReceivedAsPreCutover: true,
    notes: 'Máscara 321 — cutover 2026-03-30. Halve INBOUND + pre-cutover OUTBOUND.',
  },
  {
    itemId: '5334cf95-0e83-404e-a8c0-cd84c888b6c7',
    uniCode: '328',
    cutoverDate: '2026-04-06T10:22:48.000Z',
    halveInbound: true,
    treatOrderReceivedAsPreCutover: true,
    notes: 'Máscara 328 — cutover 2026-04-06. 640 pre-cutover OUTBOUND rows + bulk INBOUND.',
  },
];

/** PPE-specific fields for the newly-categorized PPE items. Required because
 *  the PPE consumption formula returns 0 when ppeType is NULL. */
const PPE_FIELD_ASSIGNMENTS: ReadonlyArray<{
  itemId: string;
  ppeType: PPE_TYPE;
  ppeDeliveryMode: PPE_DELIVERY_MODE;
  ppeStandardQuantity?: number;
}> = [
  // Face/respirator masks only — 321 and 328 are paint-masking products (Material).
  { itemId: '61fb86ca-bb7f-4477-8be7-4ee6bcc84683', ppeType: PPE_TYPE.MASK, ppeDeliveryMode: PPE_DELIVERY_MODE.SCHEDULED, ppeStandardQuantity: 1 },
  // Gloves
  { itemId: '834fef2b-62fd-40e8-a582-63f052bd1460', ppeType: PPE_TYPE.GLOVES, ppeDeliveryMode: PPE_DELIVERY_MODE.ON_DEMAND, ppeStandardQuantity: 1 },
  { itemId: '6aeca123-7f38-4160-b08b-d9707a6175da', ppeType: PPE_TYPE.GLOVES, ppeDeliveryMode: PPE_DELIVERY_MODE.ON_DEMAND, ppeStandardQuantity: 1 },
  // Boots
  { itemId: 'ca1a74c9-e52d-4da5-aff6-b49853964aa6', ppeType: PPE_TYPE.BOOTS, ppeDeliveryMode: PPE_DELIVERY_MODE.SCHEDULED, ppeStandardQuantity: 1 },
  // Coverall — closest is SHIRT (full body garment)
  { itemId: '60ce70f9-b607-47be-850e-d40673295a3b', ppeType: PPE_TYPE.SHIRT, ppeDeliveryMode: PPE_DELIVERY_MODE.SCHEDULED, ppeStandardQuantity: 1 },
  { itemId: 'df49c809-42bb-4677-b74d-0fcbeeafd099', ppeType: PPE_TYPE.SHIRT, ppeDeliveryMode: PPE_DELIVERY_MODE.SCHEDULED, ppeStandardQuantity: 1 },
];

/** Phantom-mc items (mc = quantity exact, 0-1 activity, migration seed) —
 *  reset mc/rp/max to 0; recompute will rebuild correctly. */
const PHANTOM_MC_ITEM_IDS: ReadonlyArray<string> = [
  // Populated dynamically in Phase D — kept here as a fallback hint if needed.
];

const BACKFILL_LOOKBACK_MONTHS = 12;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ItemSnapshot {
  id: string;
  uniCode: string | null;
  name: string;
  categoryId: string | null;
  categoryType: ITEM_CATEGORY_TYPE | null;
  categoryName: string | null;
  quantity: number;
  monthlyConsumption: number;
  reorderPoint: number | null;
  maxQuantity: number | null;
  reorderQuantity: number | null;
  estimatedLeadTime: number | null;
  abcCategory: ABC_CATEGORY | null;
  xyzCategory: XYZ_CATEGORY | null;
  isActive: boolean;
}

interface DiffRow {
  before: ItemSnapshot;
  after: ItemSnapshot;
  changed: boolean;
  changedFields: string[];
  notes: string[];
}

type AnyPrismaClient = PrismaService | Prisma.TransactionClient;

class DryRunRollback extends Error {
  constructor() {
    super('DRY_RUN_ROLLBACK');
    this.name = 'DryRunRollback';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function decToNum(d: Prisma.Decimal | number | null | undefined): number {
  if (d == null) return 0;
  if (typeof d === 'number') return d;
  return Number(d);
}

async function snapshotAllItems(
  client: AnyPrismaClient,
): Promise<Map<string, ItemSnapshot>> {
  const rows = await client.item.findMany({
    select: {
      id: true,
      uniCode: true,
      name: true,
      categoryId: true,
      quantity: true,
      monthlyConsumption: true,
      reorderPoint: true,
      maxQuantity: true,
      reorderQuantity: true,
      estimatedLeadTime: true,
      abcCategory: true,
      xyzCategory: true,
      isActive: true,
      category: { select: { type: true, name: true } },
    },
  });
  const out = new Map<string, ItemSnapshot>();
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      uniCode: r.uniCode ?? null,
      name: r.name,
      categoryId: r.categoryId ?? null,
      categoryType: (r.category?.type as ITEM_CATEGORY_TYPE | null) ?? null,
      categoryName: r.category?.name ?? null,
      quantity: r.quantity,
      monthlyConsumption: decToNum(r.monthlyConsumption),
      reorderPoint: r.reorderPoint ?? null,
      maxQuantity: r.maxQuantity ?? null,
      reorderQuantity: r.reorderQuantity ?? null,
      estimatedLeadTime: r.estimatedLeadTime ?? null,
      abcCategory: (r.abcCategory as ABC_CATEGORY | null) ?? null,
      xyzCategory: (r.xyzCategory as XYZ_CATEGORY | null) ?? null,
      isActive: r.isActive,
    });
  }
  return out;
}

function nearlyEqual(
  a: number | null | undefined,
  b: number | null | undefined,
  isInt: boolean,
): boolean {
  const aIsNull = a == null;
  const bIsNull = b == null;
  if (aIsNull && bIsNull) return true;
  if (aIsNull !== bIsNull) return false;
  if (isInt) return (a as number) === (b as number);
  return Math.abs((a as number) - (b as number)) <= FLOAT_EPSILON;
}

function diffSnapshots(before: ItemSnapshot, after: ItemSnapshot): string[] {
  const fields: string[] = [];
  if (before.categoryId !== after.categoryId) fields.push('categoryId');
  if (!nearlyEqual(before.quantity, after.quantity, false)) fields.push('quantity');
  if (!nearlyEqual(before.monthlyConsumption, after.monthlyConsumption, false))
    fields.push('monthlyConsumption');
  if (!nearlyEqual(before.reorderPoint, after.reorderPoint, false))
    fields.push('reorderPoint');
  if (!nearlyEqual(before.maxQuantity, after.maxQuantity, false))
    fields.push('maxQuantity');
  if (!nearlyEqual(before.reorderQuantity, after.reorderQuantity, false))
    fields.push('reorderQuantity');
  if (!nearlyEqual(before.estimatedLeadTime, after.estimatedLeadTime, true))
    fields.push('estimatedLeadTime');
  if (before.abcCategory !== after.abcCategory) fields.push('abcCategory');
  if (before.xyzCategory !== after.xyzCategory) fields.push('xyzCategory');
  return fields;
}

function csvEscape(value: string | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '';
  if (Number.isInteger(n)) return String(n);
  return (Math.round(n * 100) / 100).toString();
}

// ---------------------------------------------------------------------------
// Phase A — Categorization
// ---------------------------------------------------------------------------

async function phaseA_categorize(
  tx: Prisma.TransactionClient,
  logger: Logger,
  notesByItem: Map<string, string[]>,
): Promise<{ assigned: number; alreadyCategorized: number; reassigned: number; missing: number; ppeFieldsSet: number }> {
  // Load existing categories to resolve names → ids.
  const categories = await tx.itemCategory.findMany({
    select: { id: true, name: true, type: true },
  });
  const categoryByName = new Map<string, { id: string; type: string }>();
  for (const c of categories) {
    categoryByName.set(c.name, { id: c.id, type: c.type as string });
  }

  let assigned = 0;
  let alreadyCategorized = 0;
  let reassigned = 0;
  let missing = 0;

  // Build current-state lookup for items we plan to (re)assign.
  const targetIds = CATEGORY_ASSIGNMENTS.map(a => a.itemId);
  const currentItems = await tx.item.findMany({
    where: { id: { in: targetIds } },
    select: {
      id: true,
      categoryId: true,
      ppeType: true,
      category: { select: { name: true, type: true } },
    },
  });
  const currentById = new Map(currentItems.map(c => [c.id, c]));

  for (const assign of CATEGORY_ASSIGNMENTS) {
    const item = currentById.get(assign.itemId);
    if (!item) {
      missing++;
      logger.warn(`Phase A: item ${assign.itemId} (${assign.itemName}) not found`);
      continue;
    }
    const targetCat = categoryByName.get(assign.categoryName);
    if (!targetCat) {
      missing++;
      logger.warn(`Phase A: category "${assign.categoryName}" not found in DB`);
      continue;
    }

    const isReassignment = item.categoryId && item.categoryId !== targetCat.id;
    const isFirstAssignment = !item.categoryId;
    if (!isReassignment && !isFirstAssignment) {
      alreadyCategorized++;
      continue;
    }

    // If moving FROM a PPE category TO a non-PPE category, clear ppe fields.
    const movingOutOfPpe =
      item.category?.type === 'PPE' && targetCat.type !== 'PPE';
    const updateData: Prisma.ItemUpdateInput = { category: { connect: { id: targetCat.id } } };
    if (movingOutOfPpe) {
      updateData.ppeType = null;
      updateData.ppeDeliveryMode = null;
      updateData.ppeStandardQuantity = null;
      updateData.ppeCA = null;
    }

    await tx.item.update({
      where: { id: assign.itemId },
      data: updateData,
    });

    if (isReassignment) {
      reassigned++;
      const arr = notesByItem.get(assign.itemId) ?? [];
      arr.push(
        `Recategorizado: ${item.category?.name ?? '?'} → ${assign.categoryName}` +
          (movingOutOfPpe ? ' (PPE fields cleared)' : ''),
      );
      notesByItem.set(assign.itemId, arr);
    } else {
      assigned++;
      const arr = notesByItem.get(assign.itemId) ?? [];
      arr.push(`Categorizado como ${assign.categoryName} (${targetCat.type})`);
      notesByItem.set(assign.itemId, arr);
    }
  }

  // Set PPE-specific fields (ppeType, ppeDeliveryMode, ppeStandardQuantity).
  // Without these, the PPE formula in stock-health.ts returns mc=0.
  let ppeFieldsSet = 0;
  for (const ppe of PPE_FIELD_ASSIGNMENTS) {
    const existing = await tx.item.findUnique({
      where: { id: ppe.itemId },
      select: { id: true, ppeType: true },
    });
    if (!existing) continue;
    if (existing.ppeType) continue; // already set — don't override
    await tx.item.update({
      where: { id: ppe.itemId },
      data: {
        ppeType: ppe.ppeType,
        ppeDeliveryMode: ppe.ppeDeliveryMode,
        ppeStandardQuantity: ppe.ppeStandardQuantity ?? 1,
      },
    });
    ppeFieldsSet++;
    const arr = notesByItem.get(ppe.itemId) ?? [];
    arr.push(`PPE fields: ${ppe.ppeType}/${ppe.ppeDeliveryMode}, std qty=${ppe.ppeStandardQuantity ?? 1}`);
    notesByItem.set(ppe.itemId, arr);
  }

  logger.log(
    `Phase A done: ${assigned} new, ${reassigned} re-categorized, ${alreadyCategorized} unchanged, ${missing} missing, ${ppeFieldsSet} PPE fields set`,
  );
  return { assigned, alreadyCategorized, reassigned, missing, ppeFieldsSet };
}

// ---------------------------------------------------------------------------
// Phase B — Mascara migration
// ---------------------------------------------------------------------------

interface MaskActivityChange {
  activityId: string;
  itemId: string;
  uniCode: string;
  createdAt: Date;
  operation: ACTIVITY_OPERATION;
  reason: ACTIVITY_REASON;
  beforeQty: number;
  afterQty: number;
}

async function phaseB_mascaraMigration(
  tx: Prisma.TransactionClient,
  logger: Logger,
  notesByItem: Map<string, string[]>,
): Promise<MaskActivityChange[]> {
  const changes: MaskActivityChange[] = [];

  const MIGRATION_MARKER = 'MASK_HALVING_2026';

  for (const cfg of MASK_MIGRATION) {
    const cutover = new Date(cfg.cutoverDate);

    // Idempotency: check ChangeLog for a marker that says this migration
    // already ran for this item. Skip if so — running again would re-halve
    // already-halved activities (e.g., a qty=2 → 1 row would go to 0.5).
    const alreadyMigrated = await tx.changeLog.findFirst({
      where: {
        entityType: 'ITEM',
        entityId: cfg.itemId,
        metadata: { path: ['migration'], equals: MIGRATION_MARKER },
      },
      select: { id: true },
    });
    if (alreadyMigrated) {
      logger.log(
        `Phase B ${cfg.uniCode}: already migrated (ChangeLog ${alreadyMigrated.id}) — skipping`,
      );
      const arr = notesByItem.get(cfg.itemId) ?? [];
      arr.push('Máscara: migração já aplicada anteriormente (idempotência).');
      notesByItem.set(cfg.itemId, arr);
      continue;
    }

    // BEFORE halving: capture sums to back-compute the implicit seed (an
    // initial balance that was never registered as an Activity row).
    const beforeSums = await tx.activity.groupBy({
      by: ['operation'],
      where: { itemId: cfg.itemId },
      _sum: { quantity: true },
    });
    let sumInBefore = 0;
    let sumOutBefore = 0;
    for (const s of beforeSums) {
      const q = decToNum(s._sum.quantity);
      if (s.operation === ACTIVITY_OPERATION.INBOUND) sumInBefore = q;
      else if (s.operation === ACTIVITY_OPERATION.OUTBOUND) sumOutBefore = q;
    }
    const itemBefore = await tx.item.findUnique({
      where: { id: cfg.itemId },
      select: { quantity: true, name: true, uniCode: true },
    });
    const beforeQty = itemBefore?.quantity ?? 0;
    // seed_OLD = whatever balance exists outside the activity log, expressed
    // in OLD units (because the system was on OLD units when this seed was set).
    const seedOld = beforeQty - sumInBefore + sumOutBefore;

    // Load all activities for this item.
    const activities = await tx.activity.findMany({
      where: { itemId: cfg.itemId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        operation: true,
        reason: true,
        quantity: true,
        createdAt: true,
        orderId: true,
      },
    });

    for (const a of activities) {
      const operation = a.operation as ACTIVITY_OPERATION;
      const reason = a.reason as ACTIVITY_REASON;

      // Decide if this activity should be halved.
      const isPreCutoverByDate = a.createdAt < cutover;

      // Special: ORDER_RECEIVED activities whose Order was placed pre-cutover
      // should be halved even if the receipt was post-cutover (the order
      // quantity was expressed in old units).
      let isPreCutoverOrderReceipt = false;
      if (
        !isPreCutoverByDate &&
        cfg.treatOrderReceivedAsPreCutover &&
        reason === ACTIVITY_REASON.ORDER_RECEIVED &&
        a.orderId
      ) {
        const order = await tx.order.findUnique({
          where: { id: a.orderId },
          select: { createdAt: true },
        });
        if (order && order.createdAt < cutover) {
          isPreCutoverOrderReceipt = true;
        }
      }

      const shouldHalve =
        (isPreCutoverByDate || isPreCutoverOrderReceipt) &&
        (operation === ACTIVITY_OPERATION.OUTBOUND ||
          (operation === ACTIVITY_OPERATION.INBOUND && cfg.halveInbound));

      if (!shouldHalve) continue;

      // Skip activities that already have fractional quantity (likely already
      // in new units — defensive idempotency).
      if (a.quantity % 1 !== 0) continue;

      const newQty = a.quantity / 2;
      await tx.activity.update({
        where: { id: a.id },
        data: { quantity: newQty },
      });

      changes.push({
        activityId: a.id,
        itemId: cfg.itemId,
        uniCode: cfg.uniCode,
        createdAt: a.createdAt,
        operation,
        reason,
        beforeQty: a.quantity,
        afterQty: newQty,
      });
    }

    // Simple, predictable conversion: halve the stored qty. This matches the
    // user's mental model ("the system was tracking in OLD units, halve it
    // for NEW units"). Activities are halved in-place above so future
    // mc/rp/max calculations see the correct NEW-units consumption rate.
    // Post-cutover NEW-units activities were small (a few 0.5 outbounds
    // around the cutover) — the small imprecision is acceptable, and a
    // human can correct with a one-shot MANUAL_ADJUSTMENT after physical
    // inventory count.
    const computedQty = beforeQty / 2;

    await tx.item.update({
      where: { id: cfg.itemId },
      data: { quantity: computedQty },
    });

    // Idempotency marker — write to ChangeLog so re-runs skip this item.
    const itemChanges = changes.filter(c => c.itemId === cfg.itemId);
    await tx.changeLog.create({
      data: {
        entityType: 'ITEM',
        entityId: cfg.itemId,
        action: 'UPDATE',
        reason: `Máscara ${cfg.uniCode} workflow migration (OLD→NEW units)`,
        metadata: {
          migration: MIGRATION_MARKER,
          uniCode: cfg.uniCode,
          cutoverDate: cfg.cutoverDate,
          activitiesHalved: itemChanges.length,
          beforeQty,
          afterQty: computedQty,
          seedOldInferred: seedOld,
          ranAt: new Date().toISOString(),
        },
        triggeredBy: 'SYSTEM',
      },
    });

    const note = `Máscara ${cfg.uniCode}: ${itemChanges.length} atividades pré-cutover divididas por 2. Saldo: ${beforeQty} → ${computedQty} (seed inferido: ${seedOld} OLD).`;
    const arr = notesByItem.get(cfg.itemId) ?? [];
    arr.push(note);
    notesByItem.set(cfg.itemId, arr);

    logger.log(
      `Phase B ${cfg.uniCode}: halved ${changes.filter(c => c.itemId === cfg.itemId).length} acts, quantity ${beforeQty} → ${computedQty}, seed_OLD inferred ${seedOld}`,
    );
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Phase C — ConsumptionSnapshot backfill
// ---------------------------------------------------------------------------

interface SnapshotStat {
  itemId: string;
  itemName: string;
  monthsCreated: number;
  monthsSkippedVacation: number;
  monthsZero: number;
}

async function phaseC_backfillSnapshots(
  tx: Prisma.TransactionClient,
  logger: Logger,
  now: Date,
): Promise<SnapshotStat[]> {
  const stats: SnapshotStat[] = [];

  // For every active item with category != TOOL.
  const items = await tx.item.findMany({
    where: {
      isActive: true,
      OR: [
        { categoryId: null },
        { category: { is: { type: { not: ITEM_CATEGORY_TYPE.TOOL } } } },
      ],
    },
    select: { id: true, name: true, createdAt: true },
  });

  // Iterate the trailing 12 months (oldest first so seasonal factors stabilize).
  const months: Array<{ year: number; month: number }> = [];
  for (let i = BACKFILL_LOOKBACK_MONTHS; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() });
  }

  for (const item of items) {
    let created = 0;
    let skippedVacation = 0;
    let zeroMonths = 0;

    // Load ALL qualifying activities (full history) so the bulk distributor
    // can spread INVENTORY_COUNT / MANUAL_ADJUSTMENT spikes across their
    // proper windows — including pre-cutover spikes whose window extends
    // before the trailing-12mo lookback. Without this, a single big
    // INVENTORY_COUNT registered in (say) March 2026 concentrates 100% of
    // its volume in that month's snapshot, inflating mc/rp by 10-150×.
    const lookEnd = new Date(now.getFullYear(), now.getMonth(), 1);
    const allActivities = await tx.activity.findMany({
      where: {
        itemId: item.id,
        operation: ACTIVITY_OPERATION.OUTBOUND,
        reason: { in: REGULAR_CONSUMPTION_REASONS as ACTIVITY_REASON[] },
        createdAt: { lt: lookEnd },
      },
      select: { operation: true, reason: true, quantity: true, createdAt: true },
    });

    // Spread bulk-event quantities; non-bulk activities pass through.
    const distributed = distributeBulkAdjustments(
      allActivities.map(a => ({
        operation: a.operation,
        reason: a.reason,
        quantity: a.quantity,
        createdAt: a.createdAt,
      })),
      new Date(item.createdAt),
    );

    // Saturday-shift months — derived from the RAW non-distributed activities
    // (synthetic per-day rows would otherwise fake saturday work).
    const saturdayShifts = detectSaturdayShifts(
      allActivities as any,
      REGULAR_CONSUMPTION_REASONS as any,
    );

    for (const { year, month } of months) {
      // Determine if this month is entirely inside a vacation period.
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);
      let allVacation = true;
      for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
        if (!isInVacationPeriod(d)) {
          allVacation = false;
          break;
        }
      }
      if (allVacation) {
        skippedVacation++;
        continue;
      }

      // Skip months before the item existed.
      if (monthEnd < item.createdAt) {
        zeroMonths++;
        continue;
      }

      // Sum DISTRIBUTED activities for this month.
      let totalConsumption = 0;
      let consumptionCount = 0;
      for (const a of distributed) {
        if (a.createdAt < monthStart || a.createdAt > monthEnd) continue;
        totalConsumption += a.quantity;
        if (!a.synthetic) consumptionCount++;
      }

      const workingDays = workingDaysForMonth(year, month, saturdayShifts);
      const normalizedConsumption =
        workingDays > 0 ? (totalConsumption / workingDays) * 20 : 0;

      // Use corpus seasonality as a stable default (per-item curve isn't
      // computed yet — Phase E recompute will refine).
      const seasonalFactor = CORPUS_MONTHLY_INDEX[month] ?? 1;

      await tx.consumptionSnapshot.upsert({
        where: {
          itemId_year_month: { itemId: item.id, year, month },
        },
        create: {
          itemId: item.id,
          year,
          month,
          totalConsumption,
          consumptionCount,
          workingDays,
          normalizedConsumption,
          seasonalFactor,
        },
        update: {
          totalConsumption,
          consumptionCount,
          workingDays,
          normalizedConsumption,
          seasonalFactor,
        },
      });
      created++;
      if (totalConsumption === 0) zeroMonths++;
    }

    stats.push({
      itemId: item.id,
      itemName: item.name,
      monthsCreated: created,
      monthsSkippedVacation: skippedVacation,
      monthsZero: zeroMonths,
    });
  }

  logger.log(
    `Phase C done: ${stats.length} items processed, ${stats.reduce((s, x) => s + x.monthsCreated, 0)} snapshot rows written, ${stats.reduce((s, x) => s + x.monthsSkippedVacation, 0)} vacation-months skipped`,
  );
  return stats;
}

// ---------------------------------------------------------------------------
// Phase D — Phantom MC cleanup
// ---------------------------------------------------------------------------

async function phaseD_phantomCleanup(
  tx: Prisma.TransactionClient,
  logger: Logger,
  notesByItem: Map<string, string[]>,
): Promise<number> {
  // Find items where mc = quantity exact AND activity count <= 1.
  const candidates: Array<{ id: string; name: string; quantity: number; mc: number }> = await tx.$queryRaw`
    SELECT i.id, i.name, i.quantity, i."monthlyConsumption"::float AS mc
    FROM "Item" i
    WHERE i."monthlyConsumption" > 0
      AND ABS(i."monthlyConsumption" - i.quantity) < 0.001
      AND (SELECT COUNT(*) FROM "Activity" a WHERE a."itemId" = i.id) <= 1
  `;

  for (const c of candidates) {
    await tx.item.update({
      where: { id: c.id },
      data: {
        monthlyConsumption: 0,
        reorderPoint: 0,
        maxQuantity: 0,
        reorderQuantity: 0,
      },
    });
    const arr = notesByItem.get(c.id) ?? [];
    arr.push(`Phantom mc (mc=qty=${c.mc}) — zerado, será recalculado por atividades`);
    notesByItem.set(c.id, arr);
  }

  logger.log(`Phase D done: ${candidates.length} phantom_mc items reset`);
  return candidates.length;
}

// ---------------------------------------------------------------------------
// Phase A2 — Assign Adere supplier to mascara 321/328
// ---------------------------------------------------------------------------
//   The two transfer-mask items (uniCode 321 and 328) historically had no
//   supplier on Item. User confirmed they're supplied by Adere (Alex). This
//   sets it so Phase I's "Adere — Máscaras" schedule resolves them.
//   Idempotent: only acts if Item.supplierId is NULL or different from Adere.

async function phaseA2_assignAdereToMasks(
  tx: Prisma.TransactionClient,
  logger: Logger,
  notesByItem: Map<string, string[]>,
): Promise<{ updated: number }> {
  const adere = await tx.supplier.findFirst({
    where: { fantasyName: 'Adere (Alex)' },
    select: { id: true },
  });
  if (!adere) {
    logger.warn('Phase A2: Adere supplier not found — skipping mask assignment');
    return { updated: 0 };
  }
  const MASK_IDS = [
    '33ed541a-343c-4232-bf6d-921dfdf198a6', // Mascara 321
    '5334cf95-0e83-404e-a8c0-cd84c888b6c7', // Mascara 328
  ];
  const masks = await tx.item.findMany({
    where: { id: { in: MASK_IDS } },
    select: { id: true, name: true, supplierId: true },
  });
  let updated = 0;
  for (const m of masks) {
    if (m.supplierId === adere.id) continue;
    await tx.item.update({ where: { id: m.id }, data: { supplierId: adere.id } });
    updated++;
    const arr = notesByItem.get(m.id) ?? [];
    arr.push(`Supplier assigned: Adere (Alex)`);
    notesByItem.set(m.id, arr);
  }
  logger.log(`Phase A2 done: ${updated} mask(s) assigned to Adere`);
  return { updated };
}

// ---------------------------------------------------------------------------
// Phase G — Backfill NULL supplierId on legacy orders
// ---------------------------------------------------------------------------
//   When all OrderItems on a NULL-supplier order point to items that share
//   the same Item.supplierId, we can safely infer the order's supplier.
//   Orders where items disagree on supplier (or items have no supplier) are
//   left NULL and reported for manual review.
//   Idempotent: only acts on orders still NULL.

async function phaseG_backfillNullSupplierIds(
  tx: Prisma.TransactionClient,
  logger: Logger,
): Promise<{ backfilled: number; ambiguous: number; noHint: number }> {
  type Row = { order_id: string; distinct_suppliers: number; inferred_supplier: string | null };
  const rows = await tx.$queryRaw<Row[]>`
    SELECT
      o.id AS order_id,
      COUNT(DISTINCT i."supplierId")::int AS distinct_suppliers,
      MAX(i."supplierId") AS inferred_supplier
    FROM "Order" o
    LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
    LEFT JOIN "Item" i ON i.id = oi."itemId"
    WHERE o."supplierId" IS NULL
    GROUP BY o.id
  `;

  let backfilled = 0;
  let ambiguous = 0;
  let noHint = 0;
  for (const r of rows) {
    if (r.distinct_suppliers === 1 && r.inferred_supplier) {
      await tx.order.update({
        where: { id: r.order_id },
        data: { supplierId: r.inferred_supplier },
      });
      backfilled++;
    } else if (r.distinct_suppliers > 1) {
      ambiguous++;
    } else {
      noHint++;
    }
  }

  logger.log(
    `Phase G done: ${backfilled} orders backfilled, ${ambiguous} ambiguous (multi-supplier), ${noHint} with no supplier hint`,
  );
  return { backfilled, ambiguous, noHint };
}

// ---------------------------------------------------------------------------
// Phase H — Doubling-pattern candidate report (no auto-action — conservative)
// ---------------------------------------------------------------------------
//   The mascara-halving migration (Phase B) was specific to items 321/328
//   that had a documented OUTBOUND-doubling workflow. Other items in the DB
//   show similar IN/OUT ratio anomalies (e.g. Engate Rápido Macho SM-40 at
//   ~19×, Rebite de Repuxo 640 at ~6×, Lixa Folha 150 at ~3×). These could
//   be doubling artifacts OR legitimate slow-moving stock with one large
//   inventory count — we cannot tell from data alone. This phase only logs
//   the candidates for human review; it does not halve anything.

async function phaseH_doublingCandidatesReport(
  tx: Prisma.TransactionClient,
  logger: Logger,
  notesByItem: Map<string, string[]>,
): Promise<{ candidates: number }> {
  const KNOWN_MIGRATED_ITEM_IDS = [
    '33ed541a-343c-4232-bf6d-921dfdf198a6', // Mascara 321
    '5334cf95-0e83-404e-a8c0-cd84c888b6c7', // Mascara 328
  ];

  type Row = {
    id: string;
    name: string;
    in_out_ratio: number | null;
    total_in: number;
    total_out: number;
    current_qty: number;
    first_fractional_outbound: Date | null;
  };

  const rows = await tx.$queryRaw<Row[]>`
    SELECT
      i.id,
      i.name,
      i.quantity::float AS current_qty,
      COALESCE(SUM(CASE WHEN a.operation = 'INBOUND' THEN a.quantity ELSE 0 END), 0)::float AS total_in,
      COALESCE(SUM(CASE WHEN a.operation = 'OUTBOUND' THEN a.quantity ELSE 0 END), 0)::float AS total_out,
      CASE WHEN SUM(CASE WHEN a.operation = 'OUTBOUND' THEN a.quantity ELSE 0 END) > 0
           THEN (SUM(CASE WHEN a.operation = 'INBOUND' THEN a.quantity ELSE 0 END)::float
                 / SUM(CASE WHEN a.operation = 'OUTBOUND' THEN a.quantity ELSE 0 END)::float)
           ELSE NULL
      END AS in_out_ratio,
      (
        SELECT MIN(af."createdAt")
        FROM "Activity" af
        WHERE af."itemId" = i.id
          AND af.operation = 'OUTBOUND'
          AND af.quantity != FLOOR(af.quantity)
      ) AS first_fractional_outbound
    FROM "Item" i
    LEFT JOIN "Activity" a ON a."itemId" = i.id
    WHERE i.id NOT IN (${Prisma.join(KNOWN_MIGRATED_ITEM_IDS)})
    GROUP BY i.id, i.name, i.quantity
    HAVING
      SUM(CASE WHEN a.operation = 'INBOUND' THEN a.quantity ELSE 0 END) > 10
      AND SUM(CASE WHEN a.operation = 'OUTBOUND' THEN a.quantity ELSE 0 END) > 0
      AND (SUM(CASE WHEN a.operation = 'INBOUND' THEN a.quantity ELSE 0 END)::float
           / NULLIF(SUM(CASE WHEN a.operation = 'OUTBOUND' THEN a.quantity ELSE 0 END), 0)::float) >= 3.0
    ORDER BY in_out_ratio DESC NULLS LAST
    LIMIT 30
  `;

  for (const r of rows) {
    const note = `DOUBLING_CANDIDATE: ratio_in/out=${r.in_out_ratio?.toFixed(2)} in=${r.total_in} out=${r.total_out} qty=${r.current_qty}${r.first_fractional_outbound ? ` (fractional since ${r.first_fractional_outbound.toISOString().slice(0, 10)})` : ''}`;
    const arr = notesByItem.get(r.id) ?? [];
    arr.push(note);
    notesByItem.set(r.id, arr);
  }

  logger.log(
    `Phase H done: ${rows.length} doubling-pattern candidates flagged (no auto-action — see CSV "notes" column for review).`,
  );
  return { candidates: rows.length };
}

// ---------------------------------------------------------------------------
// Phase J — Cent↔unit anomaly detection (log-only)
// ---------------------------------------------------------------------------
//   Flags items where the median activity quantity is low (≥ 0.5 to skip
//   paint/liquid items) but a rare outlier is ≥50× the median — suggests
//   a possible data-entry error (typed 200 instead of 2, or unit/cent
//   confusion). INVENTORY_COUNT and MANUAL_ADJUSTMENT are excluded — those
//   are expected large adjustments. Conservative: log to notes only.

async function phaseJ_centUnitAnomalyReport(
  tx: Prisma.TransactionClient,
  logger: Logger,
  notesByItem: Map<string, string[]>,
): Promise<{ candidates: number }> {
  type Row = {
    id: string;
    name: string;
    median_qty: number;
    max_qty: number;
    ratio: number;
    outlier_count: number;
    max_outlier_date: Date | null;
  };
  const rows = await tx.$queryRaw<Row[]>`
    WITH stats AS (
      SELECT
        a."itemId" AS id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY a.quantity) AS median_qty,
        MAX(a.quantity)::float AS max_qty,
        COUNT(*)::int AS total_acts
      FROM "Activity" a
      WHERE a.operation = 'OUTBOUND'
        AND a.reason NOT IN ('INVENTORY_COUNT', 'MANUAL_ADJUSTMENT')
        AND a.quantity > 0
      GROUP BY a."itemId"
      HAVING COUNT(*) >= 10
    ),
    outliers AS (
      SELECT
        s.id,
        s.median_qty::float AS median_qty,
        s.max_qty,
        (s.max_qty / NULLIF(s.median_qty, 0))::float AS ratio,
        (
          SELECT COUNT(*) FROM "Activity" a
          WHERE a."itemId" = s.id AND a.operation = 'OUTBOUND'
            AND a.reason NOT IN ('INVENTORY_COUNT', 'MANUAL_ADJUSTMENT')
            AND a.quantity > s.median_qty * 10
        )::int AS outlier_count,
        (
          SELECT MAX(a."createdAt") FROM "Activity" a
          WHERE a."itemId" = s.id AND a.quantity = s.max_qty
        ) AS max_outlier_date
      FROM stats s
      WHERE s.median_qty >= 0.5
        AND s.max_qty >= 50
        AND (s.max_qty / NULLIF(s.median_qty, 0)) >= 50
    )
    SELECT o.*, i.name
    FROM outliers o
    JOIN "Item" i ON i.id = o.id
    WHERE o.outlier_count BETWEEN 1 AND 3
    ORDER BY o.ratio DESC
    LIMIT 30
  `;

  for (const r of rows) {
    const note = `CENT_UNIT_ANOMALY: median=${r.median_qty.toFixed(2)} max=${r.max_qty} ratio=${r.ratio.toFixed(0)}× outliers=${r.outlier_count}${r.max_outlier_date ? ` (max on ${r.max_outlier_date.toISOString().slice(0, 10)})` : ''}`;
    const arr = notesByItem.get(r.id) ?? [];
    arr.push(note);
    notesByItem.set(r.id, arr);
  }

  logger.log(
    `Phase J done: ${rows.length} cent/unit anomaly candidates flagged (no auto-action — see CSV "notes" column for review).`,
  );
  return { candidates: rows.length };
}

// ---------------------------------------------------------------------------
// Phase I — Seed OrderSchedule rows for top suppliers
// ---------------------------------------------------------------------------
//   Calendar layout (user's 2026-05-21 preferences):
//     Farben — 5 monthly schedules
//       - 3 on the FIRST Thursday: Bases, Diluentes, Pigmentos
//       - 2 on the SECOND Thursday: Endurecedores+Vernizes, Outros
//     Adere — 2 quarterly schedules with a 1.5-month offset between them
//       - Fitas: month 0
//       - Mascaras (321/328): month +1.5
//     Casa dos Parafusos — every 2 months, all items
//     Bolinha Embalagens — every 2 months, all items (can stack same day)
//     Estopa (Brasil Sul Estopas) — every 2 months
//     Scotch Brite — every 3 months (single item, supplier=Dislon)
//
//   The "first/second Thursday" pattern uses MonthlyScheduleConfig with
//   `occurrence + dayOfWeek` (schema supports this natively, line 781-791).
//   The OrderScheduleService.calculateNextRunDate now honors that and
//   shifts the result to the next Brazilian business day if it lands on a
//   holiday or vacation period.
//
//   Wipe-and-reseed is used (instead of skip-if-exists) so re-running this
//   phase always reflects the latest seed definitions. Existing Order rows
//   that reference these schedules via `orderScheduleId` get unlinked
//   automatically (FK ON DELETE SET NULL).

interface ScheduleSeed {
  name: string;
  description: string;
  supplierId: string;
  /** Item resolver — returns the item IDs to include. */
  resolveItems: (tx: Prisma.TransactionClient) => Promise<string[]>;
  /** Schedule frequency. Always MONTHLY for the 2026-05-21 layout. */
  frequencyCount: number;
  /** Optional monthly occurrence (FIRST/SECOND/LAST + dayOfWeek). When
   *  provided, the schedule fires "Nth weekday of every Nth month". */
  monthlyOccurrence?: { occurrence: 'FIRST' | 'SECOND' | 'THIRD' | 'FOURTH' | 'LAST'; dayOfWeek: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' };
  /** Fallback day-of-month when occurrence is not used. */
  dayOfMonth?: number;
  /** Days offset from `now` for the first firing (sets nextRun). */
  initialOffsetDays: number;
}

async function phaseI_seedSchedules(
  tx: Prisma.TransactionClient,
  logger: Logger,
  now: Date,
): Promise<{ created: number; wiped: number; emptyMembership: number }> {
  // Wipe previously seeded schedules so a re-run reflects the latest layout.
  // Existing Order rows lose their orderScheduleId link (FK is SET NULL).
  const wipeNames = await tx.orderSchedule.findMany({
    where: {
      name: {
        in: [
          'Farben — Bases',
          'Farben — Pigmentos',
          'Farben — Endurecedores + Vernizes',
          'Farben — Diluentes',
          'Farben — Outros',
          'Adere — Fitas',
          'Adere — Máscaras',
          'Casa dos Parafusos — Geral',
          'Bolinha Embalagens — Geral',
          'Estopa — Brasil Sul',
          'Scotch Brite',
        ],
      },
    },
    select: { id: true, monthlyConfigId: true },
  });
  if (wipeNames.length > 0) {
    await tx.orderSchedule.deleteMany({ where: { id: { in: wipeNames.map(s => s.id) } } });
    const monthlyConfigIds = wipeNames.map(s => s.monthlyConfigId).filter((x): x is string => !!x);
    if (monthlyConfigIds.length > 0) {
      await tx.monthlyScheduleConfig.deleteMany({ where: { id: { in: monthlyConfigIds } } });
    }
    logger.log(`Phase I: wiped ${wipeNames.length} pre-existing seeded schedule(s)`);
  }

  // Look up supplier IDs by fantasyName.
  const allSuppliers = await tx.supplier.findMany({
    where: {
      fantasyName: {
        in: [
          'Farben (Ronaldo)',
          'Adere (Alex)',
          'Casa dos Parafusos (Maicon)',
          'Bolinha Embalagens (Ibiporã)',
          'Brasil Sul Estopas',
          'Dislon',
        ],
      },
    },
    select: { id: true, fantasyName: true },
  });
  const supplierByName = new Map(allSuppliers.map(s => [s.fantasyName, s.id]));
  const farben = supplierByName.get('Farben (Ronaldo)');
  const adere = supplierByName.get('Adere (Alex)');
  const casaDosParafusos = supplierByName.get('Casa dos Parafusos (Maicon)');
  const bolinha = supplierByName.get('Bolinha Embalagens (Ibiporã)');
  const brasilSulEstopas = supplierByName.get('Brasil Sul Estopas');
  const dislon = supplierByName.get('Dislon');

  // Helper: pick the next "Nth weekday" of the calendar from `now`. Used to
  // initialize nextRun so the FIRST firing also lands on the right calendar
  // slot (otherwise it would only align after the first calculateNextRunDate).
  function nthWeekdayOfMonth(year: number, monthZeroBased: number, weekday: number, occurrence: number): Date {
    const d = new Date(year, monthZeroBased, 1);
    while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
    d.setDate(d.getDate() + (occurrence - 1) * 7);
    return d;
  }
  function nextOccurrenceFromNow(weekday: number, occurrenceNum: number): Date {
    const candidate = nthWeekdayOfMonth(now.getFullYear(), now.getMonth(), weekday, occurrenceNum);
    if (candidate > now) return candidate;
    return nthWeekdayOfMonth(now.getFullYear(), now.getMonth() + 1, weekday, occurrenceNum);
  }
  const seeds: ScheduleSeed[] = [];

  if (farben) {
    // 3 schedules on the FIRST Thursday of every month.
    const firstThu = nextOccurrenceFromNow(4 /* Thursday */, 1);
    seeds.push(
      {
        name: 'Farben — Bases',
        description: 'Bases Farben (paint bases). Mensal — primeira quinta do mês.',
        supplierId: farben,
        resolveItems: tx => tx.item.findMany({ where: { supplierId: farben, isActive: true, category: { name: 'Base' } }, select: { id: true } }).then(rs => rs.map(r => r.id)),
        frequencyCount: 1,
        monthlyOccurrence: { occurrence: 'FIRST', dayOfWeek: 'THURSDAY' },
        initialOffsetDays: Math.max(1, Math.round((firstThu.getTime() - now.getTime()) / 86_400_000)),
      },
      {
        name: 'Farben — Diluentes',
        description: 'Diluentes e desengraxantes Farben. Mensal — primeira quinta do mês.',
        supplierId: farben,
        resolveItems: tx => tx.item.findMany({ where: { supplierId: farben, isActive: true, category: { name: 'Diluente' } }, select: { id: true } }).then(rs => rs.map(r => r.id)),
        frequencyCount: 1,
        monthlyOccurrence: { occurrence: 'FIRST', dayOfWeek: 'THURSDAY' },
        initialOffsetDays: Math.max(1, Math.round((firstThu.getTime() - now.getTime()) / 86_400_000)),
      },
      {
        name: 'Farben — Pigmentos',
        description: 'Pigmentos / cores Farben. Mensal — primeira quinta do mês.',
        supplierId: farben,
        resolveItems: tx => tx.item.findMany({ where: { supplierId: farben, isActive: true, category: { name: 'Pigmento' } }, select: { id: true } }).then(rs => rs.map(r => r.id)),
        frequencyCount: 1,
        monthlyOccurrence: { occurrence: 'FIRST', dayOfWeek: 'THURSDAY' },
        initialOffsetDays: Math.max(1, Math.round((firstThu.getTime() - now.getTime()) / 86_400_000)),
      },
    );
    // 2 schedules on the SECOND Thursday of every month.
    const secondThu = nextOccurrenceFromNow(4, 2);
    seeds.push(
      {
        name: 'Farben — Endurecedores + Vernizes',
        description: 'Endurecedores e vernizes Farben (co-ocorrem nos pedidos). Mensal — segunda quinta do mês.',
        supplierId: farben,
        resolveItems: tx => tx.item.findMany({ where: { supplierId: farben, isActive: true, category: { name: { in: ['Endurecedor', 'Verniz'] } } }, select: { id: true } }).then(rs => rs.map(r => r.id)),
        frequencyCount: 1,
        monthlyOccurrence: { occurrence: 'SECOND', dayOfWeek: 'THURSDAY' },
        initialOffsetDays: Math.max(1, Math.round((secondThu.getTime() - now.getTime()) / 86_400_000)),
      },
      {
        name: 'Farben — Outros',
        description: 'Tintas avulsas, primers, massa poliester e itens Farben fora dos demais grupos. Mensal — segunda quinta do mês.',
        supplierId: farben,
        resolveItems: tx => tx.item.findMany({ where: { supplierId: farben, isActive: true, category: { name: { in: ['Tinta'] } } }, select: { id: true } }).then(rs => rs.map(r => r.id)),
        frequencyCount: 1,
        monthlyOccurrence: { occurrence: 'SECOND', dayOfWeek: 'THURSDAY' },
        initialOffsetDays: Math.max(1, Math.round((secondThu.getTime() - now.getTime()) / 86_400_000)),
      },
    );
  } else {
    logger.warn('Phase I: Farben supplier not found — skipping Farben seeds');
  }

  if (adere) {
    // Adere — 2 quarterly schedules with a 1.5-month offset.
    seeds.push(
      {
        name: 'Adere — Fitas',
        description: 'Fitas crepe (Automotiva / Uso Geral). Trimestral.',
        supplierId: adere,
        resolveItems: tx => tx.item.findMany({ where: { supplierId: adere, isActive: true, OR: [{ name: { contains: 'Fita', mode: 'insensitive' } }, { name: { contains: 'Adesiv', mode: 'insensitive' } }] }, select: { id: true } }).then(rs => rs.map(r => r.id)),
        frequencyCount: 3, // every 3 months
        dayOfMonth: 15,
        initialOffsetDays: 14,
      },
      {
        name: 'Adere — Máscaras',
        description: 'Máscaras de mascaramento (uniCode 321/328). Trimestral — defasada 45d em relação às Fitas.',
        supplierId: adere,
        resolveItems: tx => tx.item.findMany({ where: { supplierId: adere, isActive: true, OR: [{ name: { contains: 'Máscara', mode: 'insensitive' } }, { name: { contains: 'Mascara', mode: 'insensitive' } }] }, select: { id: true } }).then(rs => rs.map(r => r.id)),
        frequencyCount: 3,
        dayOfMonth: 15,
        initialOffsetDays: 14 + 45, // ~1.5 months after Fitas
      },
    );
  } else {
    logger.warn('Phase I: Adere supplier not found — skipping Adere seeds');
  }

  if (casaDosParafusos) {
    seeds.push({
      name: 'Casa dos Parafusos — Geral',
      description: 'Todos os itens da Casa dos Parafusos (Maicon). Bimestral.',
      supplierId: casaDosParafusos,
      resolveItems: tx => tx.item.findMany({ where: { supplierId: casaDosParafusos, isActive: true }, select: { id: true } }).then(rs => rs.map(r => r.id)),
      frequencyCount: 2,
      dayOfMonth: 10,
      initialOffsetDays: 10,
    });
  } else {
    logger.warn('Phase I: Casa dos Parafusos supplier not found — skipping');
  }

  if (bolinha) {
    seeds.push({
      name: 'Bolinha Embalagens — Geral',
      description: 'Todos os itens da Bolinha Embalagens. Bimestral.',
      supplierId: bolinha,
      resolveItems: tx => tx.item.findMany({ where: { supplierId: bolinha, isActive: true }, select: { id: true } }).then(rs => rs.map(r => r.id)),
      frequencyCount: 2,
      dayOfMonth: 10, // same day as Casa dos Parafusos (user OK with stacking)
      initialOffsetDays: 10,
    });
  } else {
    logger.warn('Phase I: Bolinha supplier not found — skipping');
  }

  if (brasilSulEstopas) {
    seeds.push({
      name: 'Estopa — Brasil Sul',
      description: 'Estopa de Pano e Pacote Estopa (Brasil Sul Estopas). Bimestral.',
      supplierId: brasilSulEstopas,
      resolveItems: tx => tx.item.findMany({ where: { supplierId: brasilSulEstopas, isActive: true, name: { contains: 'Estopa', mode: 'insensitive' } }, select: { id: true } }).then(rs => rs.map(r => r.id)),
      frequencyCount: 2,
      dayOfMonth: 20,
      initialOffsetDays: 20,
    });
  } else {
    logger.warn('Phase I: Brasil Sul Estopas supplier not found — skipping');
  }

  if (dislon) {
    seeds.push({
      name: 'Scotch Brite',
      description: 'Scotch Brite (Dislon). Trimestral.',
      supplierId: dislon,
      resolveItems: tx => tx.item.findMany({ where: { supplierId: dislon, isActive: true, name: { contains: 'Scotch', mode: 'insensitive' } }, select: { id: true } }).then(rs => rs.map(r => r.id)),
      frequencyCount: 3,
      dayOfMonth: 20,
      initialOffsetDays: 20,
    });
  } else {
    logger.warn('Phase I: Dislon supplier not found — skipping Scotch Brite');
  }

  let created = 0;
  let emptyMembership = 0;
  for (const seed of seeds) {
    const itemIds = await seed.resolveItems(tx);
    if (itemIds.length === 0) {
      logger.warn(`Phase I: "${seed.name}" has 0 matching items — creating EMPTY schedule (add items manually)`);
      emptyMembership++;
    }
    const nextRun = new Date(now);
    nextRun.setDate(nextRun.getDate() + seed.initialOffsetDays);

    let monthlyConfigId: string | null = null;
    if (seed.monthlyOccurrence) {
      const mc = await tx.monthlyScheduleConfig.create({
        data: {
          occurrence: seed.monthlyOccurrence.occurrence as any,
          dayOfWeek: seed.monthlyOccurrence.dayOfWeek as any,
        },
      });
      monthlyConfigId = mc.id;
    } else if (seed.dayOfMonth !== undefined) {
      const mc = await tx.monthlyScheduleConfig.create({
        data: { dayOfMonth: seed.dayOfMonth },
      });
      monthlyConfigId = mc.id;
    }

    await tx.orderSchedule.create({
      data: {
        name: seed.name,
        description: seed.description,
        supplierId: seed.supplierId,
        frequency: 'MONTHLY' as any,
        frequencyCount: seed.frequencyCount,
        isActive: true,
        items: itemIds,
        nextRun,
        monthlyConfigId,
      },
    });
    created++;
    const pattern = seed.monthlyOccurrence
      ? `${seed.monthlyOccurrence.occurrence} ${seed.monthlyOccurrence.dayOfWeek} every ${seed.frequencyCount}mo`
      : `day ${seed.dayOfMonth ?? '?'} every ${seed.frequencyCount}mo`;
    logger.log(`Phase I: created "${seed.name}" with ${itemIds.length} items — ${pattern}, nextRun=${nextRun.toISOString().slice(0, 10)}`);
  }

  logger.log(
    `Phase I done: ${created} schedules created, ${wipeNames.length} wiped pre-run, ${emptyMembership} have empty membership`,
  );
  return { created, wiped: wipeNames.length, emptyMembership };
}

// ---------------------------------------------------------------------------
// Phase E — Per-item recompute (every item)
// ---------------------------------------------------------------------------

async function phaseE_recomputeAll(
  tx: Prisma.TransactionClient,
  recomputeService: ItemRecomputeService,
  logger: Logger,
): Promise<{ processed: number; errors: number }> {
  const items = await tx.item.findMany({ select: { id: true } });
  let processed = 0;
  let errors = 0;

  for (const item of items) {
    try {
      await recomputeService.recomputeItemMetrics(item.id, tx);
    } catch (err) {
      errors++;
      logger.error(
        `Phase E: recompute failed for ${item.id}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    processed++;
    if (processed % 100 === 0) {
      logger.log(`  Phase E: ${processed}/${items.length}`);
    }
  }

  logger.log(`Phase E done: ${processed} processed, ${errors} errors`);
  return { processed, errors };
}

// ---------------------------------------------------------------------------
// Phase F — ABC/XYZ pass
// ---------------------------------------------------------------------------

async function phaseF_abcXyzPass(
  tx: Prisma.TransactionClient,
  logger: Logger,
  now: Date,
): Promise<{ classified: number; xyzPopulated: number }> {
  const lookbackStart = new Date(now.getFullYear(), now.getMonth() - 12, 1);

  const items = await tx.item.findMany({
    where: { isActive: true },
    select: {
      id: true,
      monthlyConsumption: true,
      category: { select: { type: true } },
    },
  });
  const itemIds = items.map(i => i.id);
  if (itemIds.length === 0) {
    logger.warn('Phase F: no active items');
    return { classified: 0, xyzPopulated: 0 };
  }

  // Build trailing-12 monthly history from ConsumptionSnapshot.
  const snapshots = await tx.consumptionSnapshot.findMany({
    where: { itemId: { in: itemIds } },
    select: {
      itemId: true,
      year: true,
      month: true,
      normalizedConsumption: true,
    },
  });
  const historyMap = new Map<string, number[]>();
  const bucket = new Map<
    string,
    Array<{ year: number; month: number; consumption: number }>
  >();
  for (const s of snapshots) {
    const d = new Date(s.year, s.month, 1);
    if (d < lookbackStart) continue;
    const arr = bucket.get(s.itemId) ?? [];
    arr.push({ year: s.year, month: s.month, consumption: s.normalizedConsumption });
    bucket.set(s.itemId, arr);
  }
  for (const [itemId, arr] of bucket) {
    arr.sort((a, b) => (a.year - b.year) * 12 + (a.month - b.month));
    historyMap.set(itemId, arr.map(r => r.consumption));
  }

  // Latest price for ABC weight.
  const priceRows = await tx.orderItem.findMany({
    where: {
      itemId: { in: itemIds },
      price: { gt: 0 },
      order: { createdAt: { gte: lookbackStart } },
    },
    orderBy: { createdAt: 'desc' },
    select: { itemId: true, price: true, createdAt: true },
  });
  const priceByItem = new Map<string, number>();
  for (const p of priceRows) {
    if (!p.itemId) continue;
    if (!priceByItem.has(p.itemId)) priceByItem.set(p.itemId, p.price);
  }

  const abcInputs: AbcInput[] = items.map(i => ({
    itemId: i.id,
    monthlyConsumption: decToNum(i.monthlyConsumption),
    unitPrice: priceByItem.get(i.id) ?? 0,
    eligible:
      (i.category?.type as ITEM_CATEGORY_TYPE | null) !== ITEM_CATEGORY_TYPE.TOOL &&
      decToNum(i.monthlyConsumption) > 0,
  }));
  const xyzInputs: XyzInput[] = items.map(i => ({
    itemId: i.id,
    trailingMonthlyConsumption: historyMap.get(i.id) ?? [],
    eligible:
      (i.category?.type as ITEM_CATEGORY_TYPE | null) !== ITEM_CATEGORY_TYPE.TOOL,
  }));

  const abc = new Map(classifyAbc(abcInputs).map(a => [a.itemId, a]));
  const xyz = new Map(classifyXyz(xyzInputs).map(x => [x.itemId, x]));

  let classified = 0;
  let xyzPopulated = 0;
  for (const i of items) {
    const a = abc.get(i.id);
    const x = xyz.get(i.id);
    await tx.item.update({
      where: { id: i.id },
      data: {
        abcCategory: a?.category ?? null,
        abcCategoryOrder: a?.order ?? null,
        xyzCategory: x?.category ?? null,
        xyzCategoryOrder: x?.order ?? null,
      },
    });
    classified++;
    if (x?.category) xyzPopulated++;
  }

  logger.log(`Phase F done: ${classified} items classified, ${xyzPopulated} got XYZ`);
  return { classified, xyzPopulated };
}

// ---------------------------------------------------------------------------
// CSV writers
// ---------------------------------------------------------------------------

async function writeMainCsv(
  filePath: string,
  rows: DiffRow[],
): Promise<void> {
  const header = [
    'itemId',
    'uniCode',
    'name',
    'categoryName_before',
    'categoryName_after',
    'categoryType_after',
    'isActive',
    'qty_before',
    'qty_after',
    'mc_before',
    'mc_after',
    'rp_before',
    'rp_after',
    'max_before',
    'max_after',
    'reorderQty_before',
    'reorderQty_after',
    'leadTime_before',
    'leadTime_after',
    'abc_before',
    'abc_after',
    'xyz_before',
    'xyz_after',
    'changed',
    'changedFields',
    'notes',
  ];

  const lines = [header.join(',')];
  for (const r of rows) {
    const b = r.before;
    const a = r.after;
    lines.push(
      [
        csvEscape(b.id),
        csvEscape(b.uniCode),
        csvEscape(b.name),
        csvEscape(b.categoryName ?? ''),
        csvEscape(a.categoryName ?? ''),
        csvEscape(a.categoryType ?? ''),
        csvEscape(a.isActive ? 'YES' : 'no'),
        csvEscape(fmtNum(b.quantity)),
        csvEscape(fmtNum(a.quantity)),
        csvEscape(fmtNum(b.monthlyConsumption)),
        csvEscape(fmtNum(a.monthlyConsumption)),
        csvEscape(fmtNum(b.reorderPoint)),
        csvEscape(fmtNum(a.reorderPoint)),
        csvEscape(fmtNum(b.maxQuantity)),
        csvEscape(fmtNum(a.maxQuantity)),
        csvEscape(fmtNum(b.reorderQuantity)),
        csvEscape(fmtNum(a.reorderQuantity)),
        csvEscape(fmtNum(b.estimatedLeadTime)),
        csvEscape(fmtNum(a.estimatedLeadTime)),
        csvEscape(b.abcCategory ?? ''),
        csvEscape(a.abcCategory ?? ''),
        csvEscape(b.xyzCategory ?? ''),
        csvEscape(a.xyzCategory ?? ''),
        csvEscape(r.changed ? 'YES' : 'no'),
        csvEscape(r.changedFields.join('|')),
        csvEscape(r.notes.join(' | ')),
      ].join(','),
    );
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
}

async function writeMaskCsv(
  filePath: string,
  changes: MaskActivityChange[],
): Promise<void> {
  const header = [
    'activityId',
    'itemId',
    'uniCode',
    'createdAt',
    'operation',
    'reason',
    'beforeQty',
    'afterQty',
  ];
  const lines = [header.join(',')];
  for (const c of changes) {
    lines.push(
      [
        csvEscape(c.activityId),
        csvEscape(c.itemId),
        csvEscape(c.uniCode),
        csvEscape(c.createdAt.toISOString()),
        csvEscape(c.operation),
        csvEscape(c.reason),
        csvEscape(fmtNum(c.beforeQty)),
        csvEscape(fmtNum(c.afterQty)),
      ].join(','),
    );
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
}

async function writeSnapshotsCsv(
  filePath: string,
  stats: SnapshotStat[],
): Promise<void> {
  const header = [
    'itemId',
    'itemName',
    'monthsCreated',
    'monthsSkippedVacation',
    'monthsZero',
  ];
  const lines = [header.join(',')];
  for (const s of stats) {
    lines.push(
      [
        csvEscape(s.itemId),
        csvEscape(s.itemName),
        String(s.monthsCreated),
        String(s.monthsSkippedVacation),
        String(s.monthsZero),
      ].join(','),
    );
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Flags {
  dryRun: boolean;
  skipMask: boolean;
  skipBackfill: boolean;
}

function parseFlags(): Flags {
  const argv = process.argv.slice(2);
  return {
    dryRun: argv.includes('--dry-run'),
    skipMask: argv.includes('--skip-mask'),
    skipBackfill: argv.includes('--skip-backfill'),
  };
}

async function main(): Promise<number> {
  const flags = parseFlags();
  const logger = new Logger('inventory-deep-migration');
  const startedAt = Date.now();
  logger.log(
    `Starting inventory-deep-migration (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}, dryRun=${flags.dryRun})`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  let beforeSnapshots: Map<string, ItemSnapshot> | null = null;
  let afterSnapshots: Map<string, ItemSnapshot> | null = null;
  let maskChanges: MaskActivityChange[] = [];
  let snapshotStats: SnapshotStat[] = [];
  const notesByItem = new Map<string, string[]>();
  const phaseResults: Record<string, any> = {};

  try {
    const prisma = app.get(PrismaService);
    const recomputeService = app.get(ItemRecomputeService);

    beforeSnapshots = await snapshotAllItems(prisma);
    logger.log(`Snapshotted ${beforeSnapshots.size} items BEFORE migration`);

    // Capture AFTER state before any rollback so dry-run still produces a diff.
    let inTxSnapshot: Map<string, ItemSnapshot> | null = null;

    try {
      const txResult = await prisma.$transaction(
        async tx => {
          const now = new Date();

          phaseResults.A = await phaseA_categorize(tx, logger, notesByItem);
          phaseResults.A2 = await phaseA2_assignAdereToMasks(tx, logger, notesByItem);

          if (!flags.skipMask) {
            maskChanges = await phaseB_mascaraMigration(tx, logger, notesByItem);
          }

          if (!flags.skipBackfill) {
            snapshotStats = await phaseC_backfillSnapshots(tx, logger, now);
          }

          phaseResults.D = await phaseD_phantomCleanup(tx, logger, notesByItem);

          phaseResults.G = await phaseG_backfillNullSupplierIds(tx, logger);
          phaseResults.H = await phaseH_doublingCandidatesReport(tx, logger, notesByItem);
          phaseResults.J = await phaseJ_centUnitAnomalyReport(tx, logger, notesByItem);

          phaseResults.E = await phaseE_recomputeAll(tx, recomputeService, logger);
          // Phase I runs AFTER initial recompute so item categories/suppliers
          // are stable before we materialize schedule membership.
          if (phaseResults.E.errors > 0) {
            throw new Error(
              `Phase E had ${phaseResults.E.errors} errors — aborting`,
            );
          }

          phaseResults.F = await phaseF_abcXyzPass(tx, logger, now);

          // Phase E-prime: re-run per-item recompute now that ABC/XYZ are
          // populated. The first Phase E used stale (NULL) XYZ which routed
          // most items to UNCLASSIFIED (targetStockDays=180), inflating max.
          // This second pass corrects rp/max with the real classification.
          logger.log('Phase E-prime: re-running recompute with fresh ABC/XYZ');
          phaseResults.E2 = await phaseE_recomputeAll(tx, recomputeService, logger);

          // Phase I: seed OrderSchedule rows for top suppliers (after Phase A
          // has assigned categories and Phase G has backfilled suppliers).
          phaseResults.I = await phaseI_seedSchedules(tx, logger, now);
          if (phaseResults.E2.errors > 0) {
            throw new Error(
              `Phase E-prime had ${phaseResults.E2.errors} errors — aborting`,
            );
          }

          // Snapshot inside the tx so we see the final state.
          inTxSnapshot = await snapshotAllItems(tx);

          // Anomaly assertions — same as the existing script.
          const toolItem = inTxSnapshot.get(ANOMALY_TOOL_ID);
          if (toolItem) {
            if (toolItem.categoryType !== ITEM_CATEGORY_TYPE.TOOL) {
              throw new Error(
                `Anomaly TOOL item ${ANOMALY_TOOL_ID} has type ${toolItem.categoryType}`,
              );
            }
            if (Math.abs(toolItem.monthlyConsumption) > FLOAT_EPSILON) {
              throw new Error(
                `Anomaly TOOL item ${ANOMALY_TOOL_ID} mc=${toolItem.monthlyConsumption} (expected 0)`,
              );
            }
          } else {
            logger.warn(`Anomaly TOOL ${ANOMALY_TOOL_ID} not found`);
          }

          const rareItem = inTxSnapshot.get(ANOMALY_RARE_ID);
          if (rareItem && !Number.isFinite(rareItem.monthlyConsumption)) {
            throw new Error(
              `Anomaly RARE item ${ANOMALY_RARE_ID} produced non-finite mc`,
            );
          }

          if (flags.dryRun) {
            logger.warn(`Dry-run requested — rolling back transaction`);
            throw new DryRunRollback();
          }

          return inTxSnapshot;
        },
        { timeout: 900_000, maxWait: 60_000 },
      );
      afterSnapshots = txResult;
    } catch (err) {
      if (err instanceof DryRunRollback) {
        afterSnapshots = inTxSnapshot ?? beforeSnapshots;
        logger.warn(`Dry-run rollback complete. Diff CSV reflects what WOULD happen.`);
      } else {
        throw err;
      }
    }

    if (!afterSnapshots) afterSnapshots = beforeSnapshots;

    // Build diff rows.
    const diffRows: DiffRow[] = [];
    for (const [id, before] of beforeSnapshots) {
      const after = afterSnapshots.get(id) ?? before;
      const changedFields = diffSnapshots(before, after);
      const notes = notesByItem.get(id) ?? [];
      diffRows.push({
        before,
        after,
        changed: changedFields.length > 0,
        changedFields,
        notes,
      });
    }

    const outDir = path.resolve(__dirname, '..', '..', 'scripts', 'output');
    const stamp = isoDateStamp() + (flags.dryRun ? '-dryrun' : '');
    const mainCsv = path.join(outDir, `inventory-migration-${stamp}.csv`);
    const maskCsv = path.join(outDir, `inventory-migration-mask-${stamp}.csv`);
    const snapCsv = path.join(outDir, `inventory-migration-snapshots-${stamp}.csv`);

    await writeMainCsv(mainCsv, diffRows);
    await writeMaskCsv(maskCsv, maskChanges);
    await writeSnapshotsCsv(snapCsv, snapshotStats);

    const total = diffRows.length;
    const changed = diffRows.filter(r => r.changed).length;
    const byCat = new Map<string, { total: number; changed: number }>();
    for (const r of diffRows) {
      const k = r.after.categoryName ?? '(no category)';
      const e = byCat.get(k) ?? { total: 0, changed: 0 };
      e.total++;
      if (r.changed) e.changed++;
      byCat.set(k, e);
    }

    console.log('\n=============== INVENTORY DEEP MIGRATION SUMMARY ===============');
    console.log(`Mode:                ${flags.dryRun ? 'DRY-RUN (rolled back)' : 'COMMITTED'}`);
    console.log(`Total items:         ${total}`);
    console.log(`Changed items:       ${changed} (${total > 0 ? Math.round((changed / total) * 100) : 0}%)`);
    console.log(`\nPhase results:`);
    console.log(`  A categorize:      ${phaseResults.A?.assigned ?? 0} new, ${phaseResults.A?.reassigned ?? 0} re-cat, ${phaseResults.A?.alreadyCategorized ?? 0} unchanged, ${phaseResults.A?.missing ?? 0} missing`);
    console.log(`  B mask migration:  ${maskChanges.length} activities halved`);
    console.log(`  C snapshots:       ${snapshotStats.reduce((s, x) => s + x.monthsCreated, 0)} rows on ${snapshotStats.length} items, ${snapshotStats.reduce((s, x) => s + x.monthsSkippedVacation, 0)} vacation-months skipped`);
    console.log(`  D phantom cleanup: ${phaseResults.D ?? 0} items reset`);
    console.log(`  A2 mask supplier:  ${phaseResults.A2?.updated ?? 0} mask(s) assigned to Adere`);
    console.log(`  G supplier backfill: ${phaseResults.G?.backfilled ?? 0} orders backfilled, ${phaseResults.G?.ambiguous ?? 0} ambiguous, ${phaseResults.G?.noHint ?? 0} no-hint`);
    console.log(`  H doubling flags:  ${phaseResults.H?.candidates ?? 0} candidates (see notes column — no auto-action)`);
    console.log(`  J cent/unit flags: ${phaseResults.J?.candidates ?? 0} candidates (see notes column — no auto-action)`);
    console.log(`  E recompute:       ${phaseResults.E?.processed ?? 0} items (${phaseResults.E?.errors ?? 0} errors)`);
    console.log(`  F abc/xyz:         ${phaseResults.F?.classified ?? 0} classified, ${phaseResults.F?.xyzPopulated ?? 0} got XYZ`);
    console.log(`  E' recompute:      ${phaseResults.E2?.processed ?? 0} items (${phaseResults.E2?.errors ?? 0} errors) — rp/max with real ABC/XYZ`);
    console.log(`  I schedule seeds:  ${phaseResults.I?.created ?? 0} created, ${phaseResults.I?.wiped ?? 0} wiped pre-run, ${phaseResults.I?.emptyMembership ?? 0} empty`);
    console.log(`\nBy category (after):`);
    for (const [cat, c] of [...byCat.entries()].sort((a, b) => b[1].total - a[1].total)) {
      console.log(`  ${cat.padEnd(20)} total=${String(c.total).padStart(4)}  changed=${String(c.changed).padStart(4)}`);
    }
    console.log(`\nCSVs written:`);
    console.log(`  Main:      ${mainCsv}`);
    console.log(`  Masks:     ${maskCsv}`);
    console.log(`  Snapshots: ${snapCsv}`);
    console.log(`\nWall time:  ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    console.log('=================================================================\n');
  } catch (err) {
    exitCode = 1;
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`\nMigration FAILED — transaction rolled back:\n  ${msg}\n`);
    if (err instanceof Error && err.stack) {
      logger.error(err.stack);
    }
  } finally {
    try {
      await app.close();
    } catch (err) {
      logger.warn(
        `Ignored teardown error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return exitCode;
}

process.on('unhandledRejection', () => {
  // Background sockets (whatsapp, redis) may emit benign noise during teardown.
});

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
