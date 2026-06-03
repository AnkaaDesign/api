/**
 * run-matcher-now.ts
 * One-shot script to trigger ReconciliationMatcherService.matchAll() directly,
 * bypassing the daily scheduler. Useful after a backfill that populates new
 * FiscalDocumentOrderCode rows that would otherwise only be picked up at 4am.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/run-matcher-now.ts
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ReconciliationMatcherService } from '../modules/financial/reconciliation/reconciliation-matcher.service';

async function main(): Promise<void> {
  const logger = new Logger('RunMatcherNow');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const matcher = app.get(ReconciliationMatcherService);
    logger.log('Running reconciliation matcher for all PENDING NF transactions...');
    const matched = await matcher.matchAll();
    logger.log(`Done. matched=${matched}`);
  } catch (err) {
    logger.error(`Matcher failed: ${err instanceof Error ? err.stack : err}`);
    exitCode = 1;
  } finally {
    await app.close();
    process.exitCode = exitCode;
  }
}

void main();
