// One-off: (re)build ConsumptionSnapshot rows for a month range, reusing the
// SAME aggregation as the nightly cron (InventoryCronService.buildSnapshotForItemMonth
// — no algorithm duplicated). Reads Activity only; NEVER moves inventory.
//
// Primary use: the entire ConsumptionSnapshot table is missing May 2026 (index
// 4) — a single skipped monthly-cron run — which leaves ~113 scheduled items at
// 5 months and therefore below XYZ_MIN_MONTHS=6 (xyzCategory stays null). One
// May-2026 pass over all active items unblocks them.
//
//   Preview:  ... rebuild-consumption-snapshots.ts --from 2026-05 --to 2026-05 --dry
//   Apply:    NODE_ENV=production pnpm ts-node -r tsconfig-paths/register \
//               --transpile-only src/scripts/rebuild-consumption-snapshots.ts \
//               --from 2026-05 --to 2026-05
//
// Flags: --from YYYY-MM (default 2026-05), --to YYYY-MM (default = --from),
//        --scheduled-only (limit to items in active OrderSchedules), --dry.
//
// Idempotent (upsert on itemId_year_month); iterate months ascending so each
// month's seasonal factor builds on already-written earlier rows.

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { InventoryCronService } from '../modules/inventory/services/inventory-cron.service';

function parseMonth(arg: string | undefined, fallback: { y: number; m: number }): { y: number; m: number } {
  if (!arg) return fallback;
  const [y, mm] = arg.split('-').map(Number);
  if (!y || !mm || mm < 1 || mm > 12) throw new Error(`Bad month "${arg}", expected YYYY-MM`);
  return { y, m: mm - 1 }; // 0-indexed month (JS getMonth convention)
}

function monthsAscending(from: { y: number; m: number }, to: { y: number; m: number }): Array<{ y: number; m: number }> {
  const out: Array<{ y: number; m: number }> = [];
  let cur = from.y * 12 + from.m;
  const end = to.y * 12 + to.m;
  while (cur <= end) {
    out.push({ y: Math.floor(cur / 12), m: cur % 12 });
    cur++;
  }
  return out;
}

async function main(): Promise<number> {
  const logger = new Logger('rebuild-consumption-snapshots');
  const argv = process.argv;
  const dryRun = argv.includes('--dry');
  const scheduledOnly = argv.includes('--scheduled-only');
  const getFlag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const from = parseMonth(getFlag('--from'), { y: 2026, m: 4 }); // default May 2026
  const to = parseMonth(getFlag('--to'), from);
  const months = monthsAscending(from, to);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const cron = app.get(InventoryCronService);

    let itemIds: string[];
    if (scheduledOnly) {
      const schedules = await prisma.orderSchedule.findMany({
        where: { isActive: true },
        select: { items: true },
      });
      const ids = new Set<string>();
      for (const s of schedules) for (const id of s.items ?? []) ids.add(id);
      const active = await prisma.item.findMany({
        where: { id: { in: [...ids] }, isActive: true },
        select: { id: true },
      });
      itemIds = active.map(i => i.id);
    } else {
      const active = await prisma.item.findMany({ where: { isActive: true }, select: { id: true } });
      itemIds = active.map(i => i.id);
    }

    const monthLabels = months.map(m => `${m.y}-${String(m.m + 1).padStart(2, '0')}`).join(', ');
    console.log(
      `${dryRun ? '[DRY RUN] ' : ''}Rebuilding snapshots for ${itemIds.length} ${scheduledOnly ? 'scheduled ' : 'active '}items × months [${monthLabels}]`,
    );

    let written = 0;
    for (const { y, m } of months) {
      if (dryRun) {
        console.log(`  would build ${y}-${String(m + 1).padStart(2, '0')} for ${itemIds.length} items`);
        continue;
      }
      // Batch to bound DB concurrency, mirroring the cron.
      const batchSize = 50;
      for (let i = 0; i < itemIds.length; i += batchSize) {
        const batch = itemIds.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async id => {
            try {
              await cron.buildSnapshotForItemMonth(id, y, m);
              written++;
            } catch (err) {
              logger.error(`build failed ${id} ${y}-${m + 1}: ${err instanceof Error ? err.message : 'Unknown'}`);
            }
          }),
        );
      }
      console.log(`  built ${y}-${String(m + 1).padStart(2, '0')}`);
    }

    console.log(`\nDone. ${dryRun ? '(dry run — no writes)' : `snapshots upserted=${written}`}.`);
    return 0;
  } catch (error) {
    logger.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) logger.error(error.stack);
    return 1;
  } finally {
    try {
      await app.close();
    } catch {
      /* swallow teardown noise from background sockets */
    }
  }
}

process.on('unhandledRejection', () => {
  /* no-op: terminal noise from background sockets */
});

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
