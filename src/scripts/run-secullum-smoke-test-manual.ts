/**
 * run-secullum-smoke-test-manual.ts
 * ---------------------------------------------------------------------------
 * One-off: triggers a manual Secullum smoke test run in-process (bypassing
 * HTTP admin auth) and prints the full check-by-check result, so the
 * feriado/funcionário reliability fixes (2026-07-03) can be verified without
 * waiting for the next 06:00/12:00 SP cron.
 *
 * Run:  npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/run-secullum-smoke-test-manual.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { SecullumSmokeTestScheduler } from '../modules/integrations/secullum/smoke-test/smoke-test.scheduler';
import { PrismaService } from '../modules/common/prisma/prisma.service';

async function main(): Promise<void> {
  const logger = new Logger('RunSecullumSmokeTestManual');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const scheduler = app.get(SecullumSmokeTestScheduler);
    const prisma = app.get(PrismaService);

    logger.log('Triggering manual Secullum smoke test run...');
    const { runId } = await scheduler.triggerManualRun(null, false);

    const run = await prisma.secullumSmokeTestRun.findUnique({
      where: { id: runId },
      include: { checks: { orderBy: { order: 'asc' } } },
    });

    if (!run) {
      throw new Error(`Run ${runId} not found after completion`);
    }

    console.log('\n=== RUN SUMMARY ===');
    console.log(JSON.stringify({
      id: run.id,
      trigger: run.trigger,
      status: run.status,
      passCount: run.passCount,
      failCount: run.failCount,
      skipCount: run.skipCount,
      durationMs: run.durationMs,
    }, null, 2));

    console.log('\n=== CHECKS ===');
    for (const c of run.checks) {
      const mark = c.status === 'PASS' ? 'OK  ' : c.status === 'SKIP' ? 'SKIP' : 'FAIL';
      console.log(`[${mark}] ${c.checkKey.padEnd(30)} ${c.label}${c.errorMessage ? ' -- ' + c.errorMessage : ''}`);
    }

    if (run.failCount > 0) exitCode = 1;
  } catch (err) {
    exitCode = 1;
    logger.error('Manual smoke test run failed', err instanceof Error ? err.stack : String(err));
  } finally {
    await app.close();
    process.exit(exitCode);
  }
}

main();
