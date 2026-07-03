/**
 * One-time refresh of BankTransaction.topMatchScore for all unresolved DEBIT
 * transactions, using the current candidate scorer. topMatchScore is a snapshot
 * written at import/daily-job time and had gone stale (NULL for ~130 pending
 * rows), so the Extrato list showed just "Pendente" even when the detail page had
 * a 30%+ candidate. This recomputes it in bulk so the list is immediately correct;
 * going forward the detail-view write-back + daily job keep it fresh.
 *
 * Read-only w.r.t. matches (only updates the topMatchScore column). Safe to re-run.
 *
 * Run: NODE_ENV=production npx ts-node -r tsconfig-paths/register src/scripts/refresh-topmatchscore.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import {
  ReconciliationMatcherService,
  TOP_MATCH_SCORE_BADGE_FLOOR,
} from '../modules/financial/reconciliation/reconciliation-matcher.service';

async function main(): Promise<void> {
  const logger = new Logger('RefreshTopMatchScore');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const prisma = app.get(PrismaService);
    const matcher = app.get(ReconciliationMatcherService);

    const txs = await prisma.bankTransaction.findMany({
      where: {
        type: 'DEBIT',
        reconciliationStatus: { in: ['PENDING', 'PARTIAL'] },
      },
      select: { id: true, topMatchScore: true },
      orderBy: { postedAt: 'desc' },
    });
    logger.log(`Recomputing topMatchScore for ${txs.length} unresolved debit transactions…`);

    let changed = 0;
    let withScore = 0;
    let processed = 0;
    for (const tx of txs) {
      let top: number | null = null;
      try {
        const candidates = await matcher.getCandidatesForTransaction(tx.id);
        // Badge floor: the candidate list now includes weak proximity notes for
        // manual reconciliation, but the extrato chip only lights up for a
        // genuinely promising best candidate.
        const best = candidates.length ? candidates[0].confidence : null;
        top = best != null && best >= TOP_MATCH_SCORE_BADGE_FLOOR ? Math.round(best) : null;
      } catch (e) {
        logger.warn(`  tx ${tx.id}: candidate computation failed — ${(e as Error).message}`);
      }
      if (top !== tx.topMatchScore) {
        await prisma.bankTransaction.update({
          where: { id: tx.id },
          data: { topMatchScore: top },
        });
        changed++;
      }
      if (top != null) withScore++;
      processed++;
      if (processed % 50 === 0) logger.log(`  …${processed}/${txs.length}`);
    }

    logger.log(
      `Done. Processed ${processed}, updated ${changed}, now ${withScore} carry a score (≥30% candidate).`,
    );
  } finally {
    await app.close();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
