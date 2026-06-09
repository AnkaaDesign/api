/**
 * One-off bulk sync of the ITEM_DERIVED TransactionCategory mirror against the
 * current ItemCategory tree. Creates/updates one ITEM_DERIVED reconciliation
 * category per ItemCategory (carrying name, accountingType and an `item-<slug>`
 * slug) and cleans up mirrors whose source ItemCategory no longer exists —
 * archiving those still referenced by history, deleting the rest outright.
 *
 * The runtime listener (item-category.changed / item-category.deleted) keeps the
 * mirror in sync going forward; this script reconciles any drift / backfills the
 * initial set. It is fully idempotent — re-running re-writes the same values.
 *
 * Run in dev:   npx ts-node src/scripts/sync-transaction-category-mirror.ts
 * Run in prod:  NODE_ENV=production node dist/scripts/sync-transaction-category-mirror.js
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { TransactionCategoryService } from '../modules/financial/reconciliation/transaction-category.service';

async function main(): Promise<void> {
  const logger = new Logger('TransactionCategoryMirrorSync');
  logger.log(
    `Starting ITEM_DERIVED transaction-category mirror sync (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'})`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const categories = app.get(TransactionCategoryService);
    const result = await categories.syncAllItemCategoryMirrors();
    logger.log(
      `Done. created=${result.created} updated=${result.updated} ` +
        `deactivated=${result.deactivated} deleted=${result.deleted} unchanged=${result.unchanged}`,
    );
  } catch (err) {
    exitCode = 1;
    new Logger('TransactionCategoryMirrorSync').error(`Mirror sync failed: ${err}`);
  } finally {
    await app.close();
    process.exit(exitCode);
  }
}

void main();
