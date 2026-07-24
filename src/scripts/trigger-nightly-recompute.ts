// One-off: run the authoritative nightly recompute NOW (classification +
// reorderPoint/maxQuantity/reorderQuantity) so freshly-changed inputs
// (snapshot backfill, vacation-month exclusion, winsorization, matrix tweaks,
// coverage overrides) take effect without waiting for the 02:30 cron.
//
// This is the SAME code the cron runs (InventoryCronService.runNightlyRecompute)
// — it uses the vacation-excluded + winsorized σ/CV series, unlike stock:correct
// which builds its own classification inputs. Reads/derives only; the only
// writes are to Item metric fields (never moves inventory).
//
//   NODE_ENV=production pnpm ts-node -r tsconfig-paths/register \
//     --transpile-only src/scripts/trigger-nightly-recompute.ts

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { InventoryCronService } from '../modules/inventory/services/inventory-cron.service';

async function main(): Promise<number> {
  const logger = new Logger('trigger-nightly-recompute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const cron = app.get(InventoryCronService);
    const result = await cron.runNightlyRecompute();
    console.log(`Nightly recompute done: ${JSON.stringify(result)}`);
    return 0;
  } catch (error) {
    logger.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) logger.error(error.stack);
    return 1;
  } finally {
    try {
      await app.close();
    } catch {
      /* swallow teardown noise */
    }
  }
}

process.on('unhandledRejection', () => {
  /* no-op */
});

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
