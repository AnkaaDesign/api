/**
 * backfill-fiscal-doc-order-links.ts
 * ---------------------------------------------------------------------------
 * Resolves existing FiscalDocumentOrderCode rows to their purchase Order and
 * populates the Order↔NF backbone (FiscalDocumentOrderCode.orderId + the
 * FiscalDocument.orders M2M) so a reconciled NF can flow back to its order.
 *
 * The `#Ped:` code is the SUPPLIER'S own sales-order reference (e.g. Farben's
 * "C34673"), not our Order.orderNumber — there is no deterministic join, so this
 * reuses SiegIngestionService.resolveOrderLinksForDocument, a CONSERVATIVE
 * heuristic that only links on a confident, unique match (supplier CNPJ raiz +
 * value within 1% + date within 60 days + uniqueness + single-code docs). Rows
 * without a confident match are left null. Fully idempotent — an already-resolved
 * code is skipped, so re-running only fills in newly-matchable rows.
 *
 * Run in dev:
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/backfill-fiscal-doc-order-links.ts
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { SiegIngestionService } from '../modules/integrations/sieg/sieg-ingestion.service';

async function main(): Promise<void> {
  const logger = new Logger('FiscalDocOrderLinkBackfill');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const prisma = app.get(PrismaService);
    const ingestion = app.get(SiegIngestionService);

    // Every fiscal document that carries at least one order code.
    const docs = await prisma.fiscalDocument.findMany({
      where: { orderCodes: { some: {} } },
      select: { id: true, accessKey: true, _count: { select: { orderCodes: true } } },
    });

    const totalCodes = await prisma.fiscalDocumentOrderCode.count();
    const alreadyResolved = await prisma.fiscalDocumentOrderCode.count({
      where: { orderId: { not: null } },
    });

    logger.log(
      `Scanning ${docs.length} document(s) carrying ${totalCodes} order code(s) ` +
        `(${alreadyResolved} already resolved).`,
    );

    let resolvedNow = 0;
    let linkedDocs = 0;
    for (const doc of docs) {
      const n = await ingestion.resolveOrderLinksForDocument(doc.id);
      if (n > 0) {
        resolvedNow += n;
        linkedDocs += 1;
        logger.log(`  · ${doc.accessKey} — resolved ${n} code(s) → order linked.`);
      }
    }

    const resolvedTotal = await prisma.fiscalDocumentOrderCode.count({
      where: { orderId: { not: null } },
    });

    logger.log(
      `Done. resolved ${resolvedTotal} of ${totalCodes} code(s) ` +
        `(+${resolvedNow} newly this run, ${linkedDocs} doc(s) linked to an order).`,
    );
  } catch (err) {
    logger.error(`Backfill failed: ${err instanceof Error ? err.stack : err}`);
    exitCode = 1;
  } finally {
    await app.close();
    process.exitCode = exitCode;
  }
}

void main();
