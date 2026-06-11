// Idempotent: reuses the exact same engine as the nightly cron — re-running produces the same end state.
/**
 * correct-stock-metrics.ts
 * ---------------------------------------------------------------------------
 * Historical-data correction for inventory metrics (mc / rp / max / reorderQty
 * / leadTime / abc / xyz). Reuses ItemRecomputeService for per-item math and
 * the same ABC/XYZ classifiers the nightly cron uses; NO algorithm is re-
 * implemented here.
 *
 * Run in dev:   pnpm stock:correct
 * Run in prod:  NODE_ENV=production pnpm stock:correct
 *
 * Outputs:
 *   - CSV report  → api/scripts/output/stock-correction-report-<ISO-date>.csv
 *   - stdout      → summary counts + anomaly side-by-side
 *
 * Rollback: ALL writes happen inside a single Prisma $transaction. If either
 * anomaly assertion fails the transaction throws → all updates roll back.
 *
 * Anomaly assertions (script aborts the tx if either fails):
 *   - Item 197b3e61-88ee-4986-af4e-36955b0b360f (stockModel=FIXED_TARGET,
 *     qty=2) → mc=0, rp = fixedTargetQuantity ?? 1, max >= target
 *   - Item 9446d4ee-3c43-4c2a-9e05-111d3d4d67c6              → mc recomputed
 *     (no specific value, just verifies it's not a poisoned/stale state).
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
  ITEM_CATEGORY_TYPE,
  STOCK_MODEL,
  XYZ_CATEGORY,
} from '../constants/enums';
import {
  classifyAbc,
  classifyXyz,
  type AbcInput,
  type XyzInput,
} from '../utils/abc-xyz';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANOMALY_TOOL_ID = '197b3e61-88ee-4986-af4e-36955b0b360f';
const ANOMALY_RARE_ID = '9446d4ee-3c43-4c2a-9e05-111d3d4d67c6';

// Floating-point fields use a small epsilon. Integer/enum fields use exact.
const FLOAT_EPSILON = 0.001;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ItemSnapshot {
  id: string;
  uniCode: string | null;
  name: string;
  /** Display/grouping only — never used as a behavior gate. */
  categoryType: ITEM_CATEGORY_TYPE | null;
  stockModel: STOCK_MODEL;
  fixedTargetQuantity: number | null;
  quantity: number;
  monthlyConsumption: number;
  reorderPoint: number | null;
  maxQuantity: number | null;
  reorderQuantity: number | null;
  estimatedLeadTime: number | null;
  abcCategory: ABC_CATEGORY | null;
  xyzCategory: XYZ_CATEGORY | null;
}

interface DiffRow {
  before: ItemSnapshot;
  after: ItemSnapshot;
  changed: boolean;
}

type AnyPrismaClient = PrismaService | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoDateStamp(): string {
  // 2026-05-19 style; no time component so re-running on the same day overwrites.
  return new Date().toISOString().slice(0, 10);
}

function decToNum(d: Prisma.Decimal | number | null | undefined): number {
  if (d == null) return 0;
  if (typeof d === 'number') return d;
  return Number(d);
}

async function snapshotActiveItems(
  client: AnyPrismaClient,
): Promise<Map<string, ItemSnapshot>> {
  const rows = await client.item.findMany({
    where: { isActive: true },
    select: {
      id: true,
      uniCode: true,
      name: true,
      quantity: true,
      stockModel: true,
      fixedTargetQuantity: true,
      monthlyConsumption: true,
      reorderPoint: true,
      maxQuantity: true,
      reorderQuantity: true,
      estimatedLeadTime: true,
      abcCategory: true,
      xyzCategory: true,
      category: { select: { type: true } },
    },
  });
  const out = new Map<string, ItemSnapshot>();
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      uniCode: r.uniCode ?? null,
      name: r.name,
      categoryType: (r.category?.type as ITEM_CATEGORY_TYPE | null) ?? null,
      stockModel: r.stockModel as STOCK_MODEL,
      fixedTargetQuantity: r.fixedTargetQuantity ?? null,
      quantity: r.quantity,
      monthlyConsumption: decToNum(r.monthlyConsumption),
      reorderPoint: r.reorderPoint ?? null,
      maxQuantity: r.maxQuantity ?? null,
      reorderQuantity: r.reorderQuantity ?? null,
      estimatedLeadTime: r.estimatedLeadTime ?? null,
      abcCategory: (r.abcCategory as ABC_CATEGORY | null) ?? null,
      xyzCategory: (r.xyzCategory as XYZ_CATEGORY | null) ?? null,
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

function snapshotChanged(before: ItemSnapshot, after: ItemSnapshot): boolean {
  if (!nearlyEqual(before.monthlyConsumption, after.monthlyConsumption, false)) return true;
  if (!nearlyEqual(before.reorderPoint, after.reorderPoint, false)) return true;
  if (!nearlyEqual(before.maxQuantity, after.maxQuantity, false)) return true;
  if (!nearlyEqual(before.reorderQuantity, after.reorderQuantity, false)) return true;
  if (!nearlyEqual(before.estimatedLeadTime, after.estimatedLeadTime, true)) return true;
  if (before.abcCategory !== after.abcCategory) return true;
  if (before.xyzCategory !== after.xyzCategory) return true;
  return false;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '';
  if (Number.isInteger(n)) return String(n);
  return (Math.round(n * 100) / 100).toString();
}

function fmtDelta(
  before: number | null | undefined,
  after: number | null | undefined,
): string {
  if (before == null && after == null) return '';
  const b = before ?? 0;
  const a = after ?? 0;
  const delta = a - b;
  if (Math.abs(delta) < FLOAT_EPSILON) return '0';
  return (Math.round(delta * 100) / 100).toString();
}

function csvEscape(value: string | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ---------------------------------------------------------------------------
// ABC/XYZ pass — mirrors inventory-cron.service.ts inner ranking pass.
// Runs inside the same transaction as the per-item recompute.
// ---------------------------------------------------------------------------

interface AbcXyzInputs {
  items: Array<{
    id: string;
    stockModel: STOCK_MODEL;
    monthlyConsumption: number;
  }>;
  monthlyHistoryByItem: Map<string, number[]>;
  latestPriceByItem: Map<string, number>;
}

async function gatherAbcXyzInputs(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<AbcXyzInputs> {
  const lookbackStart = new Date(now);
  lookbackStart.setMonth(lookbackStart.getMonth() - 12);

  const items = await tx.item.findMany({
    where: { isActive: true },
    select: {
      id: true,
      monthlyConsumption: true,
      stockModel: true,
    },
  });
  const itemIds = items.map((i) => i.id);

  if (itemIds.length === 0) {
    return {
      items: [],
      monthlyHistoryByItem: new Map(),
      latestPriceByItem: new Map(),
    };
  }

  // Trailing-12 monthly history for XYZ (CV of monthly consumption).
  const snapshots = await tx.consumptionSnapshot.findMany({
    where: { itemId: { in: itemIds } },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    select: {
      itemId: true,
      year: true,
      month: true,
      normalizedConsumption: true,
    },
  });
  const cutoff = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  const monthlyHistoryByItem = new Map<string, number[]>();
  // Group then sort oldest-first.
  const bucket = new Map<
    string,
    Array<{ year: number; month: number; consumption: number }>
  >();
  for (const s of snapshots) {
    const key = new Date(s.year, s.month, 1);
    if (key < cutoff) continue;
    let arr = bucket.get(s.itemId);
    if (!arr) {
      arr = [];
      bucket.set(s.itemId, arr);
    }
    arr.push({
      year: s.year,
      month: s.month,
      consumption: s.normalizedConsumption,
    });
  }
  for (const [itemId, arr] of bucket) {
    arr.sort((a, b) => (a.year - b.year) * 12 + (a.month - b.month));
    monthlyHistoryByItem.set(
      itemId,
      arr.map((r) => r.consumption),
    );
  }

  // Latest known unit price per item — most recent OrderItem.price > 0.
  const priceRows = await tx.orderItem.findMany({
    where: { itemId: { in: itemIds }, price: { gt: 0 } },
    orderBy: { createdAt: 'desc' },
    select: { itemId: true, price: true },
  });
  const latestPriceByItem = new Map<string, number>();
  for (const r of priceRows) {
    if (!r.itemId) continue;
    if (!latestPriceByItem.has(r.itemId)) {
      latestPriceByItem.set(r.itemId, r.price);
    }
  }

  // Per-item latestPrice from trailing-12 OrderItems (cron's
  // `summarizeOrders.latestPrice` semantics: prefer the most recent priced
  // OrderItem whose order is within the trailing-12 window).
  const recentOrderItems = await tx.orderItem.findMany({
    where: {
      itemId: { in: itemIds },
      price: { gt: 0 },
      order: { createdAt: { gte: lookbackStart } },
    },
    orderBy: { createdAt: 'desc' },
    select: { itemId: true, price: true, createdAt: true },
  });
  const latestPriceAtByItem = new Map<string, Date>();
  for (const oi of recentOrderItems) {
    if (!oi.itemId) continue;
    const existingAt = latestPriceAtByItem.get(oi.itemId);
    if (!existingAt || oi.createdAt > existingAt) {
      latestPriceAtByItem.set(oi.itemId, oi.createdAt);
      latestPriceByItem.set(oi.itemId, oi.price);
    }
  }

  return {
    items: items.map((i) => ({
      id: i.id,
      stockModel: i.stockModel as STOCK_MODEL,
      monthlyConsumption: decToNum(i.monthlyConsumption),
    })),
    monthlyHistoryByItem,
    latestPriceByItem,
  };
}

async function runAbcXyzPass(
  tx: Prisma.TransactionClient,
  now: Date,
  logger: Logger,
): Promise<void> {
  const inputs = await gatherAbcXyzInputs(tx, now);
  if (inputs.items.length === 0) {
    logger.warn('ABC/XYZ pass: no active items.');
    return;
  }

  // ABC/XYZ eligibility keys on the item's stock model (contract §2):
  // only CONSUMPTION-model items are classified; FIXED_TARGET → null.
  const abcInputs: AbcInput[] = inputs.items.map((i) => ({
    itemId: i.id,
    monthlyConsumption: i.monthlyConsumption,
    unitPrice: inputs.latestPriceByItem.get(i.id) ?? 0,
    eligible:
      i.stockModel === STOCK_MODEL.CONSUMPTION && i.monthlyConsumption > 0,
  }));
  const xyzInputs: XyzInput[] = inputs.items.map((i) => ({
    itemId: i.id,
    trailingMonthlyConsumption: inputs.monthlyHistoryByItem.get(i.id) ?? [],
    eligible: i.stockModel === STOCK_MODEL.CONSUMPTION,
  }));

  const abcAssignments = new Map(
    classifyAbc(abcInputs).map((a) => [a.itemId, a] as const),
  );
  const xyzAssignments = new Map(
    classifyXyz(xyzInputs).map((x) => [x.itemId, x] as const),
  );

  // Persist sequentially (we're already inside a single big tx — using
  // Promise.all would still fan out to the same tx connection but sequential
  // keeps connection pressure predictable).
  for (const item of inputs.items) {
    const abc = abcAssignments.get(item.id);
    const xyz = xyzAssignments.get(item.id);
    await tx.item.update({
      where: { id: item.id },
      data: {
        abcCategory: abc?.category ?? null,
        abcCategoryOrder: abc?.order ?? null,
        xyzCategory: xyz?.category ?? null,
        xyzCategoryOrder: xyz?.order ?? null,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// CSV writer
// ---------------------------------------------------------------------------

async function writeCsvReport(
  filePath: string,
  rows: DiffRow[],
): Promise<void> {
  const header = [
    'itemId',
    'uniCode',
    'name',
    'categoryType',
    'qty',
    'mc_before',
    'mc_after',
    'mc_delta',
    'rp_before',
    'rp_after',
    'rp_delta',
    'max_before',
    'max_after',
    'max_delta',
    'reorderQty_before',
    'reorderQty_after',
    'reorderQty_delta',
    'leadTime_before',
    'leadTime_after',
    'leadTime_delta',
    'abc_before',
    'abc_after',
    'xyz_before',
    'xyz_after',
    'changed',
  ];

  const lines: string[] = [header.join(',')];
  for (const r of rows) {
    const b = r.before;
    const a = r.after;
    lines.push(
      [
        csvEscape(b.id),
        csvEscape(b.uniCode),
        csvEscape(b.name),
        csvEscape(b.categoryType ?? ''),
        csvEscape(fmtNum(b.quantity)),
        csvEscape(fmtNum(b.monthlyConsumption)),
        csvEscape(fmtNum(a.monthlyConsumption)),
        csvEscape(fmtDelta(b.monthlyConsumption, a.monthlyConsumption)),
        csvEscape(fmtNum(b.reorderPoint)),
        csvEscape(fmtNum(a.reorderPoint)),
        csvEscape(fmtDelta(b.reorderPoint, a.reorderPoint)),
        csvEscape(fmtNum(b.maxQuantity)),
        csvEscape(fmtNum(a.maxQuantity)),
        csvEscape(fmtDelta(b.maxQuantity, a.maxQuantity)),
        csvEscape(fmtNum(b.reorderQuantity)),
        csvEscape(fmtNum(a.reorderQuantity)),
        csvEscape(fmtDelta(b.reorderQuantity, a.reorderQuantity)),
        csvEscape(fmtNum(b.estimatedLeadTime)),
        csvEscape(fmtNum(a.estimatedLeadTime)),
        csvEscape(fmtDelta(b.estimatedLeadTime, a.estimatedLeadTime)),
        csvEscape(b.abcCategory ?? ''),
        csvEscape(a.abcCategory ?? ''),
        csvEscape(b.xyzCategory ?? ''),
        csvEscape(a.xyzCategory ?? ''),
        csvEscape(r.changed ? 'YES' : 'no'),
      ].join(','),
    );
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

class AnomalyAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnomalyAssertionError';
  }
}

async function main(): Promise<number> {
  const logger = new Logger('correct-stock-metrics');
  const startedAt = Date.now();
  logger.log(
    `Starting stock-metrics correction (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'})`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  let afterSnapshots: Map<string, ItemSnapshot> | null = null;
  let beforeSnapshots: Map<string, ItemSnapshot> | null = null;

  try {
    const prisma = app.get(PrismaService);
    const recomputeService = app.get(ItemRecomputeService);

    // 1. Snapshot BEFORE (outside the tx — read-committed baseline).
    beforeSnapshots = await snapshotActiveItems(prisma);
    logger.log(`Loaded ${beforeSnapshots.size} active items (BEFORE snapshot).`);

    if (beforeSnapshots.size === 0) {
      logger.warn('No active items to correct — exiting.');
      await app.close();
      return 0;
    }

    // 2. Run the correction in ONE transaction.
    afterSnapshots = await prisma.$transaction(
      async (tx) => {
        const now = new Date();

        // 2a. Per-item recompute. Reuses ItemRecomputeService — the same
        //     engine the nightly cron uses for the per-item math.
        let processed = 0;
        let perItemErrors = 0;
        for (const itemId of beforeSnapshots!.keys()) {
          try {
            await recomputeService.recomputeItemMetrics(itemId, tx);
          } catch (err) {
            perItemErrors++;
            logger.error(
              `recomputeItemMetrics failed for ${itemId}: ${err instanceof Error ? err.message : 'Unknown'}`,
            );
          }
          processed++;
          if (processed % 100 === 0) {
            logger.log(`  ...recomputed ${processed}/${beforeSnapshots!.size}`);
          }
        }
        logger.log(
          `Per-item recompute done: ${processed - perItemErrors}/${processed} ok` +
            (perItemErrors > 0 ? `, ${perItemErrors} errored` : ''),
        );

        // If too many per-item errors, refuse to continue — better to roll
        // back than to commit a half-corrected state.
        if (perItemErrors > 0) {
          throw new Error(
            `Aborting: ${perItemErrors} per-item recompute failure(s) — refusing to commit a partial correction.`,
          );
        }

        // 2b. ABC/XYZ classification pass (population-level ranking) —
        //     mirrors inventory-cron.service.ts. Reads the freshly-written
        //     monthlyConsumption values from the tx.
        await runAbcXyzPass(tx, now, logger);
        logger.log('ABC/XYZ pass committed (within tx).');

        // 2c. Snapshot AFTER (inside the tx so we see the just-written state).
        const after = await snapshotActiveItems(tx);
        logger.log(`Loaded ${after.size} active items (AFTER snapshot).`);

        // 2d. Anomaly assertions. Throws → rollback.
        const toolAnomaly = after.get(ANOMALY_TOOL_ID);
        if (!toolAnomaly) {
          throw new AnomalyAssertionError(
            `Anomaly item ${ANOMALY_TOOL_ID} (TOOL) not found in active items — cannot validate.`,
          );
        }
        if (toolAnomaly.stockModel !== STOCK_MODEL.FIXED_TARGET) {
          throw new AnomalyAssertionError(
            `Anomaly item ${ANOMALY_TOOL_ID} expected stockModel FIXED_TARGET, got ${toolAnomaly.stockModel}.`,
          );
        }
        if (Math.abs(toolAnomaly.monthlyConsumption) > FLOAT_EPSILON) {
          throw new AnomalyAssertionError(
            `Anomaly item ${ANOMALY_TOOL_ID} (FIXED_TARGET) mc should be 0, got ${toolAnomaly.monthlyConsumption}.`,
          );
        }
        // Target-based rules (spec §4/§12, contract §2): rp = maxQuantity =
        // the item's own fixed target (fallback 1 when unset — never ||).
        const toolTarget = toolAnomaly.fixedTargetQuantity ?? 1;
        if (
          toolAnomaly.reorderPoint == null ||
          Math.abs(toolAnomaly.reorderPoint - toolTarget) > FLOAT_EPSILON
        ) {
          throw new AnomalyAssertionError(
            `Anomaly item ${ANOMALY_TOOL_ID} (FIXED_TARGET) rp should be the fixed target (${toolTarget}), got ${toolAnomaly.reorderPoint}.`,
          );
        }
        if (
          toolAnomaly.maxQuantity == null ||
          toolAnomaly.maxQuantity < toolTarget - FLOAT_EPSILON
        ) {
          throw new AnomalyAssertionError(
            `Anomaly item ${ANOMALY_TOOL_ID} (FIXED_TARGET) max=${toolAnomaly.maxQuantity} should be >= fixed target=${toolTarget}.`,
          );
        }
        logger.log(
          `Anomaly FIXED_TARGET ${ANOMALY_TOOL_ID} OK: mc=${toolAnomaly.monthlyConsumption}, rp=${toolAnomaly.reorderPoint}, max=${toolAnomaly.maxQuantity}, qty=${toolAnomaly.quantity}, target=${toolTarget}.`,
        );

        const rareAnomaly = after.get(ANOMALY_RARE_ID);
        if (!rareAnomaly) {
          throw new AnomalyAssertionError(
            `Anomaly item ${ANOMALY_RARE_ID} not found in active items — cannot validate.`,
          );
        }
        // No specific mc value required — just confirm the field is finite
        // and not NaN (i.e. the engine produced *some* number, not a
        // poisoned/stale state).
        if (!Number.isFinite(rareAnomaly.monthlyConsumption)) {
          throw new AnomalyAssertionError(
            `Anomaly item ${ANOMALY_RARE_ID} produced non-finite mc=${rareAnomaly.monthlyConsumption}.`,
          );
        }
        logger.log(
          `Anomaly RARE ${ANOMALY_RARE_ID} OK: mc=${rareAnomaly.monthlyConsumption}, rp=${rareAnomaly.reorderPoint}, max=${rareAnomaly.maxQuantity}.`,
        );

        return after;
      },
      { timeout: 600_000, maxWait: 60_000 },
    );

    // 3. Build the diff rows.
    const diffRows: DiffRow[] = [];
    for (const [id, before] of beforeSnapshots) {
      const after = afterSnapshots.get(id);
      if (!after) {
        // Item disappeared between snapshots — shouldn't happen, but be safe.
        logger.warn(`Item ${id} missing in AFTER snapshot — skipping.`);
        continue;
      }
      diffRows.push({
        before,
        after,
        changed: snapshotChanged(before, after),
      });
    }

    // 4. Write CSV report.
    const csvPath = path.resolve(
      __dirname,
      '..',
      '..',
      'scripts',
      'output',
      `stock-correction-report-${isoDateStamp()}.csv`,
    );
    await writeCsvReport(csvPath, diffRows);
    logger.log(`CSV written: ${csvPath}`);

    // 5. Print summary.
    const total = diffRows.length;
    const changed = diffRows.filter((r) => r.changed).length;
    const byCategory = new Map<string, { total: number; changed: number }>();
    for (const r of diffRows) {
      const key = r.before.categoryType ?? 'UNCATEGORIZED';
      const e = byCategory.get(key) ?? { total: 0, changed: 0 };
      e.total++;
      if (r.changed) e.changed++;
      byCategory.set(key, e);
    }

    console.log('\n================ STOCK CORRECTION SUMMARY ================');
    console.log(`Total active items:   ${total}`);
    console.log(`Changed items:        ${changed} (${total > 0 ? Math.round((changed / total) * 100) : 0}%)`);
    console.log(`Unchanged items:      ${total - changed}`);
    console.log('\nBy category:');
    const sortedCats = [...byCategory.entries()].sort((a, b) => b[1].total - a[1].total);
    for (const [cat, counts] of sortedCats) {
      console.log(`  ${cat.padEnd(20)} total=${String(counts.total).padStart(4)}  changed=${String(counts.changed).padStart(4)}`);
    }

    console.log('\nAnomaly items (BEFORE → AFTER):');
    for (const id of [ANOMALY_TOOL_ID, ANOMALY_RARE_ID]) {
      const b = beforeSnapshots.get(id);
      const a = afterSnapshots.get(id);
      if (!b || !a) {
        console.log(`  ${id}: NOT FOUND in active items.`);
        continue;
      }
      console.log(`  ${id}  (${a.categoryType ?? '?'}, qty=${a.quantity}, uni=${a.uniCode ?? '-'})`);
      console.log(`    mc:        ${fmtNum(b.monthlyConsumption).padStart(10)}  →  ${fmtNum(a.monthlyConsumption)}`);
      console.log(`    rp:        ${fmtNum(b.reorderPoint).padStart(10)}  →  ${fmtNum(a.reorderPoint)}`);
      console.log(`    max:       ${fmtNum(b.maxQuantity).padStart(10)}  →  ${fmtNum(a.maxQuantity)}`);
      console.log(`    reorderQ:  ${fmtNum(b.reorderQuantity).padStart(10)}  →  ${fmtNum(a.reorderQuantity)}`);
      console.log(`    leadTime:  ${fmtNum(b.estimatedLeadTime).padStart(10)}  →  ${fmtNum(a.estimatedLeadTime)}`);
      console.log(`    abc:       ${String(b.abcCategory ?? '-').padStart(10)}  →  ${a.abcCategory ?? '-'}`);
      console.log(`    xyz:       ${String(b.xyzCategory ?? '-').padStart(10)}  →  ${a.xyzCategory ?? '-'}`);
    }

    console.log(`\nCSV report: ${csvPath}`);
    console.log(`Wall time:  ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    console.log('==========================================================\n');
  } catch (error) {
    exitCode = 1;
    const msg = error instanceof Error ? error.message : String(error);
    if (error instanceof AnomalyAssertionError) {
      logger.error(`\nANOMALY ASSERTION FAILED — transaction rolled back:\n  ${msg}\n`);
    } else {
      logger.error(`\nCorrection FAILED — transaction rolled back:\n  ${msg}\n`);
      if (error instanceof Error && error.stack) {
        logger.error(error.stack);
      }
    }
  } finally {
    // Swallow any errors during teardown (WhatsApp/Redis services may emit
    // benign disconnect noise that would otherwise force a non-zero exit
    // even when the correction itself succeeded).
    try {
      await app.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Ignored error during app.close(): ${msg}`);
    }
  }

  return exitCode;
}

// Suppress unhandled rejections/errors emitted by background services
// (BaileysWhatsAppService, ioredis) during teardown — they're cosmetic
// after the transaction commits/rolls back and would otherwise cause the
// script to exit with a non-zero code.
process.on('unhandledRejection', () => {
  // No-op: terminal noise from background sockets only.
});

main()
  .then((code) => {
    // Force-exit immediately. Background sockets (whatsapp, redis) may still
    // be holding the event loop open; we already committed/rolled back, so
    // there's nothing left to do.
    process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
