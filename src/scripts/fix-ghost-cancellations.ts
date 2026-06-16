/**
 * One-off: reconcile NFS-e documents that our system marked CANCELLED but are actually
 * still active at the prefeitura (the "ghost cancellations": 3097, 3098, 3099 — cancellation
 * requests REJEITADO by the fiscal). Runs the real syncCancellationStatus() so each ghost is
 * corrected to its true Elotech state (CANCEL_REJECTED + the rejection message), validating
 * the reconciler logic at the same time.
 *
 * Run: npx ts-node -r tsconfig-paths/register src/scripts/fix-ghost-cancellations.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { ElotechOxyNfseService } from '../modules/integrations/nfse/elotech-oxy-nfse.service';

const GHOST_NUMBERS = [3097, 3098, 3099];

async function main(): Promise<void> {
  const logger = new Logger('FixGhostCancellations');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const elotech = app.get(ElotechOxyNfseService);

    const docs = await prisma.nfseDocument.findMany({
      where: { nfseNumber: { in: GHOST_NUMBERS } },
      select: { id: true, nfseNumber: true, elotechNfseId: true, status: true },
      orderBy: { nfseNumber: 'asc' },
    });

    logger.log(`Found ${docs.length} ghost candidate(s): ${docs.map(d => d.nfseNumber).join(', ')}`);

    for (const doc of docs) {
      logger.log(`\n── NF ${doc.nfseNumber} (elotechId ${doc.elotechNfseId}) — local before: ${doc.status}`);
      const result = await elotech.syncCancellationStatus(doc.id);
      logger.log(
        `   reconciled → status=${result.status} requestStatus=${result.requestStatus ?? 'N/A'}` +
          (result.rejectionMessage ? `\n   rejection: ${result.rejectionMessage.replace(/\n/g, ' ')}` : ''),
      );
    }

    // Show final state
    const after = await prisma.nfseDocument.findMany({
      where: { nfseNumber: { in: GHOST_NUMBERS } },
      select: {
        nfseNumber: true,
        status: true,
        cancelRequestId: true,
        cancelRequestStatus: true,
        cancelRejectionMessage: true,
      },
      orderBy: { nfseNumber: 'asc' },
    });
    logger.log('\n=== FINAL STATE ===');
    for (const d of after) {
      logger.log(
        `NF ${d.nfseNumber}: status=${d.status} reqId=${d.cancelRequestId} reqStatus=${d.cancelRequestStatus} ` +
          `msg="${(d.cancelRejectionMessage ?? '').replace(/\n/g, ' ').slice(0, 90)}"`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
