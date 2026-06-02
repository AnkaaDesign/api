/**
 * reprocess-fiscal-categories.ts
 * ---------------------------------------------------------------------------
 * Re-runs the item-category classifier over EVERY FiscalDocumentItem after a
 * change to the classification rules (the new NCM → subcategory map, the fixed
 * keyword overrides, and the supplier-root priors).
 *
 * It calls ItemCategoryClassifierService.reclassifyAllItems(), which:
 *   - rebuilds the lexicon fresh,
 *   - classifies each line through the new precedence
 *     (uniCode → alias → NCM → supplier prior → fuzzy → keyword → emitter),
 *   - writes FiscalDocumentItem.categoryId / categoryConfidence / categorySource,
 *   - PRESERVES MANUAL per-item categorizations (never overwrites a human choice),
 *   - self-trains the alias map on deterministic (confidence-100) uniCode hits.
 *
 * It does NOT touch BankTransaction category tags — those are re-derived by
 * deriveForTransaction on the next "Verificar" of each matched transaction.
 *
 * Idempotent: re-running converges to the same per-line categories. Read-only
 * w.r.t. fiscal-document structure (only the three cached category columns
 * change). Logs coverage (lines with a category) before and after.
 *
 * Run in dev:   npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/reprocess-fiscal-categories.ts
 * Run in prod:  NODE_ENV=production node dist/scripts/reprocess-fiscal-categories.js
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { ItemCategoryClassifierService } from '../modules/financial/reconciliation/item-category-classifier.service';
import { ncmTableSize } from '../modules/financial/reconciliation/ncm-category-map';

async function main(): Promise<void> {
  const logger = new Logger('ReprocessFiscalCategories');
  logger.log(
    `Starting fiscal-category reprocess (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'})`,
  );

  const ncm = ncmTableSize();
  logger.log(
    `NCM map loaded: ${ncm.exact} exact (8-digit) + ${ncm.heading6} headings (6-digit) + ` +
      `${ncm.chapter4} chapters (4-digit) = ${ncm.exact + ncm.heading6 + ncm.chapter4} keys`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const classifier = app.get(ItemCategoryClassifierService);

    const startedAt = Date.now();
    const stats = await classifier.reclassifyAllItems((done, total) => {
      logger.log(`  …classified ${done}/${total} lines`);
    });
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);

    const pct = (n: number) =>
      stats.total > 0 ? `${((100 * n) / stats.total).toFixed(1)}%` : '0%';

    logger.log('--------------------------------------------------------------');
    logger.log(`Total fiscal-document lines:     ${stats.total}`);
    logger.log(`Coverage BEFORE (had category):  ${stats.before} (${pct(stats.before)})`);
    logger.log(`Coverage AFTER  (has category):  ${stats.after} (${pct(stats.after)})`);
    logger.log(`Lines re-categorized (changed):  ${stats.updated}`);
    logger.log(`MANUAL lines preserved:          ${stats.skippedManual}`);
    logger.log(`Delta coverage:                  ${stats.after - stats.before}`);
    logger.log(`Elapsed:                         ${secs}s`);
    logger.log('--------------------------------------------------------------');
    logger.log('Done. BankTransaction tags refresh on the next "Verificar".');
  } catch (err) {
    exitCode = 1;
    logger.error(`Reprocess failed: ${err instanceof Error ? err.stack : err}`);
  } finally {
    await app.close();
  }
  process.exit(exitCode);
}

void main();
