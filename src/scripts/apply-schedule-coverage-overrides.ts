// One-off: set per-item targetCoverageDays for every item that belongs to an
// active OrderSchedule, then recompute its stock metrics via the SAME engine
// the nightly cron uses (ItemRecomputeService — no algorithm re-implemented).
//
//   Farben-supplier schedules  -> 60 days  (~2× monthly usage target)
//   All other schedules        -> 45 days  (~1.5× monthly usage target)
//
// The override makes maxQuantity = max(reorderPoint, avgDaily × days × seasonal),
// so both the low-stock recommendation (reorderQuantity) and the order schedule
// (which now fills up to maxQuantity) converge on the same per-item target.
//
// Idempotent: re-running produces the same end state. Does NOT move inventory.
//
//   Run:  NODE_ENV=production pnpm ts-node -r tsconfig-paths/register \
//           --transpile-only src/scripts/apply-schedule-coverage-overrides.ts
//
// Pass --dry to preview without writing.

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { ItemRecomputeService } from '../modules/inventory/services/item-recompute.service';

const FARBEN_DAYS = 60; // ~2× monthly usage
const OTHER_DAYS = 45; // ~1.5× monthly usage

async function main(): Promise<number> {
  const logger = new Logger('apply-schedule-coverage-overrides');
  const dryRun = process.argv.includes('--dry');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const recompute = app.get(ItemRecomputeService);

    const schedules = await prisma.orderSchedule.findMany({
      where: { isActive: true },
      select: { id: true, name: true, items: true },
    });

    // Resolve each item's target days. An item in ANY Farben schedule gets the
    // Farben (higher) value; otherwise the "other" value.
    const daysByItem = new Map<string, number>();
    for (const s of schedules) {
      const isFarben = (s.name ?? '').trim().toLowerCase().startsWith('farben');
      const days = isFarben ? FARBEN_DAYS : OTHER_DAYS;
      for (const itemId of s.items ?? []) {
        const current = daysByItem.get(itemId);
        // Farben wins ties (take the max so a shared item keeps the bigger buffer).
        daysByItem.set(itemId, current == null ? days : Math.max(current, days));
      }
    }

    const itemIds = [...daysByItem.keys()];
    console.log(
      `${schedules.length} active schedules → ${itemIds.length} distinct items ` +
        `(${[...daysByItem.values()].filter(d => d === FARBEN_DAYS).length} @${FARBEN_DAYS}d, ` +
        `${[...daysByItem.values()].filter(d => d === OTHER_DAYS).length} @${OTHER_DAYS}d)`,
    );

    // Only touch active items; report skipped ones.
    const items = await prisma.item.findMany({
      where: { id: { in: itemIds }, isActive: true },
      select: {
        id: true,
        name: true,
        quantity: true,
        reorderPoint: true,
        maxQuantity: true,
        reorderQuantity: true,
        monthlyConsumption: true,
        targetCoverageDays: true,
        stockModel: true,
      },
    });

    let updated = 0;
    let recomputed = 0;
    const rows: string[] = [];

    for (const item of items) {
      const days = daysByItem.get(item.id)!;
      const beforeMax = item.maxQuantity ?? 0;
      const beforeRq = item.reorderQuantity ?? 0;

      if (!dryRun) {
        await prisma.item.update({
          where: { id: item.id },
          data: { targetCoverageDays: days } as any,
        });
        updated++;
        try {
          await recompute.recomputeItemMetrics(item.id);
          recomputed++;
        } catch (err) {
          logger.error(
            `recompute failed for ${item.name} (${item.id}): ${
              err instanceof Error ? err.message : 'Unknown'
            }`,
          );
        }
      }

      const after = await prisma.item.findUnique({
        where: { id: item.id },
        select: { reorderPoint: true, maxQuantity: true, reorderQuantity: true },
      });
      rows.push(
        `${days}d | ${item.name.slice(0, 34).padEnd(34)} | mc=${Number(item.monthlyConsumption).toFixed(1).padStart(7)} ` +
          `| stock=${(item.quantity ?? 0).toFixed(0).padStart(5)} ` +
          `| max ${beforeMax.toFixed(0).padStart(5)}→${(after?.maxQuantity ?? 0).toFixed(0).padStart(5)} ` +
          `| rp ${(item.reorderPoint ?? 0).toFixed(0).padStart(4)}→${(after?.reorderPoint ?? 0).toFixed(0).padStart(4)} ` +
          `| reorderQty ${beforeRq.toFixed(0).padStart(5)}→${(after?.reorderQuantity ?? 0).toFixed(0).padStart(5)}`,
      );
    }

    rows.sort();
    console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Per-item result (days | name | mc | stock | maxQuantity | reorderPoint | reorderQty):\n${rows.join('\n')}`);
    console.log(
      `\nDone. ${dryRun ? '(dry run — no writes)' : `updated=${updated}, recomputed=${recomputed}`}, ` +
        `matched items=${items.length}${items.length < itemIds.length ? ` (${itemIds.length - items.length} inactive/missing skipped)` : ''}.`,
    );

    return 0;
  } catch (error) {
    logger.error(
      `FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
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
